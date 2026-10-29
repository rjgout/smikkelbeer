// Verify the built runtime with the same container restrictions as Compose.
// Uses isolated disposable data and never configures an external mail provider.
import { execFileSync } from 'node:child_process';
import { randomBytes, createHmac } from 'node:crypto';
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
  const base = 'http://127.0.0.1:' + port;
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
  console.log(
    'Container smoke passed: read-only/non-root startup, migrations, health, HTTPS/CSRF, local bootstrap, MFA, secure cookies, account separation and key permissions.',
  );
} finally {
  if (started) docker('rm', '-f', name);
  docker('volume', 'rm', volume);
}
