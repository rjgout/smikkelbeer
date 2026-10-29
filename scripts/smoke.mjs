// Verify the built runtime with the same container restrictions as Compose.
// Uses isolated disposable data and never configures an external mail provider.
import { execFileSync } from 'node:child_process';
import { randomBytes, createHmac, randomUUID } from 'node:crypto';
import { strict as assert } from 'node:assert';

const image = process.env.SMIKKEL_SMOKE_IMAGE || 'smikkelbeer:local';
const name = 'smikkelbeer-check-' + randomBytes(5).toString('hex');
const volume = name + '-data';
const docker = (...args) =>
  execFileSync('docker', ['--host=unix:///var/run/docker.sock', ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
let started = false;
try {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--memory=512m',
    '--cpus=1',
    '--read-only',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--user=1000:1000',
    '--tmpfs=/tmp:size=32m,mode=1777',
    '-p',
    '127.0.0.1::3000',
    '-v',
    volume + ':/data',
    '-e',
    'PROTOCOL_HEADER=x-forwarded-proto',
    '-e',
    'HOST_HEADER=x-forwarded-host',
    image,
  );
  started = true;
  const port = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort;
  let base = 'http://127.0.0.1:' + port;
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      if ((await fetch(base + '/api/health')).ok) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(healthy, 'Runtime did not become healthy');
  assert.equal((await fetch(base + '/setup')).status, 400, 'Plain HTTP must be rejected');
  const origin = 'https://smikkelbeer.example';
  const headers = { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'smikkelbeer.example' };
  const req = (path, data, cookie) =>
    fetch(base + '/api/' + path, {
      method: data ? 'POST' : 'GET',
      headers: {
        ...headers,
        ...(data ? { 'content-type': 'application/json', origin } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  assert.equal((await req('admin')).status, 401);
  assert.equal(
    (
      await fetch(base + '/api/setup/begin', {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    403,
  );
  const output = docker('exec', name, '/nodejs/bin/node', 'scripts/bootstrap.mjs');
  const token = output.match(/\n([A-Za-z0-9_-]{43})\n/)?.[1];
  assert(token, 'No bootstrap token');
  const begin = await req('setup/begin', {
    token,
    email: 'runtime-test@example.invalid',
    password: randomBytes(24).toString('base64url'),
  });
  assert.equal(begin.status, 200);
  const enrollment = await begin.json();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of enrollment.secret) bits += alphabet.indexOf(c).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const code = String((mac.readUInt32BE(mac[mac.length - 1] & 15) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  );
  const finish = await req('setup/finish', { token, code });
  assert.equal(finish.status, 200);
  const cookieHeader = finish.headers.get('set-cookie');
  assert(cookieHeader);
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict'])
    assert(cookieHeader.includes(flag), flag + ' missing');
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await req('admin', undefined, cookie)).status, 200);
  assert.equal(
    (await req('employee', undefined, cookie)).status,
    401,
    'Admin must not be an employee',
  );
  assert.equal(
    (await req('setup/finish', { token, code })).status,
    409,
    'Bootstrap must not be reusable',
  );
  assert.equal(
    docker(
      'exec',
      name,
      '/nodejs/bin/node',
      '-e',
      "const s=require('node:fs').statSync('/data/master.key');console.log(s.uid+' '+(s.mode&511).toString(8))",
    ).trim(),
    '1000 600',
  );
  assert.equal(
    docker('exec', name, '/nodejs/bin/node', '-e', 'console.log(process.getuid())').trim(),
    '1000',
  );
  // A quick round creation must remain idempotent even after an actual process restart.
  const snapshot = JSON.stringify([
    { id: '85', name: 'Patat', category: 'Patat', cents: 290, available: true, options: [] },
  ]);
  docker(
    'exec',
    name,
    '/nodejs/bin/node',
    '-e',
    "const{DatabaseSync}=require('node:sqlite');const{createHash}=require('node:crypto');const db=new DatabaseSync('/data/smikkelbeer.sqlite');db.prepare('INSERT INTO syncs VALUES (?,?,1,?,?,NULL)').run(process.argv[1],Date.now(),createHash('sha256').update(process.argv[2]).digest('hex'),process.argv[2]);db.close();",
    randomUUID(),
    snapshot,
  );
  const config = (await (await req('admin', undefined, cookie)).json()).settings;
  assert.equal(
    (await req('settings', { ...config, scrapingApproved: true, weekdays: [] }, cookie)).status,
    200,
  );
  const roundRequest = {
    requestId: randomUUID(),
    day: '2099-10-29',
    invite: '11:45',
    close: '12:00',
    send: '12:05',
    arrival: '12:30',
    paymentMode: 'individual',
  };
  const created = await req('rounds/create', roundRequest, cookie);
  assert.equal(created.status, 201);
  const createdRound = await created.json();
  assert(createdRound.roundId);
  // A real container restart must preserve and interrupt an expired worker lease.
  // The job is already 'running'; it is never eligible for a new source request.
  const interruptedId = randomUUID();
  docker(
    'exec',
    name,
    '/nodejs/bin/node',
    '-e',
    "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/smikkelbeer.sqlite');const now=Date.now();db.prepare(\"INSERT INTO menu_sync_jobs(id,status,phase,actor,purpose,test,delay_ms,processed,total,created,updated,started,lease_owner,lease_until) VALUES (?,'running','options','old-worker','menu',1,1000,80,213,?,?,?,'dead-worker',?)\").run(process.argv[1],now,now,now,now+2000);db.close();",
    interruptedId,
  );
  docker('restart', name);
  // Docker may reassign an ephemeral host port after restart.
  base =
    'http://127.0.0.1:' +
    JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports['3000/tcp'][0].HostPort;
  let recovered = false,
    lastHttp = 0,
    lastState,
    lastEnvelope,
    lastContentType = '',
    lastBodyLength = 0,
    lastParse = '';
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const response = await req('menu/sync/status?id=' + interruptedId, undefined, cookie);
      lastHttp = response.status;
      if (response.ok) {
        lastContentType = response.headers.get('content-type') || '';
        const text = await response.text();
        lastBodyLength = text.length;
        try {
          lastEnvelope = JSON.parse(text);
          lastState = lastEnvelope?.job;
        } catch {
          lastParse = 'invalid-json';
        }
      }
    } catch {}
    if (lastState?.status === 'interrupted') {
      assert.equal(lastState.processed, 80);
      assert.equal(lastState.total, 213);
      assert.equal(lastState.error.code, 'PROCESS_INTERRUPTED');
      recovered = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!recovered) {
    console.log('Status response keys:', Object.keys(lastEnvelope || {}), {
      lastContentType,
      lastBodyLength,
      lastParse,
    });
    console.log(
      'Stored sync state:',
      docker(
        'exec',
        name,
        '/nodejs/bin/node',
        '-e',
        "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/data/smikkelbeer.sqlite');console.log(JSON.stringify(db.prepare('SELECT status,processed,total,lease_until,error_code FROM menu_sync_jobs LIMIT 1').get()));db.close();",
      ).trim(),
    );
  }
  assert(
    recovered,
    'Interrupted background sync was not recovered after container restart (HTTP ' +
      lastHttp +
      ', state ' +
      lastState?.status +
      ')',
  );
  const repeated = await req('rounds/create', roundRequest, cookie);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).roundId, createdRound.roundId);
  assert.equal(
    (
      await (
        await req('rounds/create/status?id=' + roundRequest.requestId, undefined, cookie)
      ).json()
    ).roundId,
    createdRound.roundId,
  );
  console.log(
    'Container smoke passed: read-only/non-root startup, migrations, health, HTTPS/CSRF, local bootstrap, MFA, secure cookies, account separation, key permissions and persistent sync recovery and idempotent round creation after container restart.',
  );
} finally {
  if (started) docker('rm', '-f', name);
  docker('volume', 'rm', volume);
}
