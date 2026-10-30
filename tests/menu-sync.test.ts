import { it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const directory = mkdtempSync(resolve(tmpdir(), 'smikkel-sync-'));
process.env.DATA_DIR = directory;
const { db, one, all, run } = await import('../src/lib/server/db');
const { defaults, saveSettings, settings } = await import('../src/lib/server/config');
const { hash } = await import('../src/lib/server/crypto');
const { enqueueMenuSync, menuSyncStatus, claimMenuSyncJob, recoverMenuSyncJobs } =
  await import('../src/lib/server/menu-jobs');
const { parseMenu, digest, latestMenu, processMenuSyncJobs } =
  await import('../src/lib/server/menu');
const { POST, GET } = await import('../src/routes/api/[...path]/+server');
const fixture = readFileSync('tests/fixtures/menu.html', 'utf8');
const products = parseMenu(fixture);
const emptyOptions = '<div id="addProductForm"><form></form></div>';
function source(menu = fixture) {
  return {
    read: vi.fn(async (path: string) => (path === '/' ? menu : emptyOptions)),
    delay: vi.fn(async (ms: number) => {
      expect(ms).toBeGreaterThanOrEqual(1000);
    }),
  };
}
function approved() {
  saveSettings({ ...structuredClone(defaults), weekdays: [], scrapingApproved: true }, 'test');
}
function admin(role = 'admin') {
  const id = randomUUID(),
    token = randomUUID();
  run(
    'INSERT INTO admins(id,email,password,totp,role_id) VALUES (?,?,?,?,?)',
    id,
    id + '@example.invalid',
    'test-not-a-password',
    'test-not-a-secret',
    role,
  );
  run("INSERT INTO sessions VALUES (?,'admin',?,?)", hash(token), id, Date.now() + 3600000);
  return { id, token };
}
function event(path: string, token?: string, data: unknown = {}): any {
  const url = new URL('http://localhost/api/' + path),
    [route] = path.split('?');
  return {
    params: { path: route },
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: url.origin },
      body: JSON.stringify(data),
    }),
    cookies: { get: (key: string) => (key === 'sb_admin' ? token : undefined) },
    getClientAddress: () => '127.0.0.1',
  };
}
function oldSuccess() {
  const id = randomUUID();
  run(
    'INSERT INTO syncs VALUES (?,?,1,?,?,NULL)',
    id,
    Date.now() - 120000,
    digest(products),
    JSON.stringify(products),
  );
  return id;
}
async function advance() {
  await Promise.resolve();
  await Promise.resolve();
}
beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new Error('External network is disabled in this test suite');
    }),
  );
  db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER protect_last_admin_delete;');
  for (const table of [
    'round_creation_requests',
    'menu_sync_jobs',
    'outbox',
    'orders',
    'rounds',
    'audit',
    'sessions',
    'admins',
    'settings',
    'syncs',
  ])
    db.exec('DELETE FROM ' + table);
  db.exec(
    "CREATE TRIGGER protect_last_admin_delete BEFORE DELETE ON admins WHEN OLD.active=1 AND OLD.role_id='admin' AND (SELECT count(*) FROM admins WHERE active=1 AND role_id='admin')<=1 BEGIN SELECT RAISE(ABORT,'Last administrator'); END; PRAGMA foreign_keys=ON;",
  );
  approved();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
it('returns HTTP 202 immediately, exposes a separately authorized status and performs no request in the API', async () => {
  const a = admin(),
    response = await POST(event('menu/sync', a.token));
  expect(response.status).toBe(202);
  const data = await response.json();
  expect(data.job.status).toBe('queued');
  expect(response.headers.get('location')).toContain(data.job.id);
  expect(all('SELECT * FROM syncs')).toHaveLength(0);
  const status = await GET(event('menu/sync/status?id=' + data.job.id, a.token));
  const state = await status.json();
  expect(state.job.processed).toBe(0);
  expect(JSON.stringify(state)).not.toMatch(/lease_owner|lease_until|actor|payload|test-not/);
  await expect(GET(event('menu/sync/status'))).rejects.toBeDefined();
  const pay = admin('payments');
  await expect(GET(event('menu/sync/status', pay.token))).rejects.toBeDefined();
  await expect(POST(event('menu/sync', pay.token))).rejects.toBeDefined();
});
it('deduplicates simultaneous starts and enforces a database-wide active-job constraint', () => {
  const jobs = Array.from({ length: 10 }, () => enqueueMenuSync('test'));
  expect(new Set(jobs.map((r) => r.job.id)).size).toBe(1);
  expect(jobs.filter((r) => !r.reused)).toHaveLength(1);
  expect(() =>
    run(
      "INSERT INTO menu_sync_jobs(id,status,actor,purpose,test,delay_ms,created,updated) VALUES (?,'queued','other','menu',1,1000,?,?)",
      randomUUID(),
      Date.now(),
      Date.now(),
    ),
  ).toThrow();
  expect(() => enqueueMenuSync('system', 'menu', null, false)).toThrow('loopt al');
});
it('preserves approval requirements and the one minute cooldown including old synchronization records', () => {
  saveSettings({ ...settings(), scrapingApproved: false }, 'test');
  expect(() => enqueueMenuSync('test')).toThrow('bronvoorwaarden');
  approved();
  oldSuccess();
  run('UPDATE syncs SET at=?', Date.now());
  expect(() => enqueueMenuSync('test')).toThrow('één minuut');
});
it('keeps durable progress visible while a job outlives Cloudflare’s request window', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T11:00:00Z'));
  const largeMenu = Array.from(
    { length: 213 },
    (_, i) =>
      `<div class="dish" id="product${1000 + i}" data-productid="${1000 + i}" data-productnaam="Testproduct" data-productcategorie="Patat" data-prijs="2.90"><button>Toevoegen</button></div>`,
  ).join('');
  const adapter = source(largeMenu);
  adapter.delay = vi.fn(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) as any;
  const a = admin(),
    accepted = await POST(event('menu/sync', a.token)),
    { job } = await accepted.json();
  const work = processMenuSyncJobs(adapter);
  await advance();
  await vi.advanceTimersByTimeAsync(130000);
  const state = await (await GET(event('menu/sync/status?id=' + job.id, a.token))).json();
  expect(state.job.status).toBe('running');
  expect(state.job.processed).toBe(130);
  expect(state.job.total).toBe(213);
  expect(all('SELECT * FROM syncs')).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(83000);
  await work;
  expect(menuSyncStatus().job).toMatchObject({ status: 'succeeded', processed: 213, total: 213 });
  expect(adapter.read).toHaveBeenCalledTimes(214);
  expect(adapter.delay.mock.calls.every((call) => call[0] === 1000)).toBe(true);
  expect(JSON.parse(one('SELECT products FROM syncs WHERE success=1').products)).toHaveLength(213);
  expect(() => enqueueMenuSync('test')).toThrow('één minuut');
});
it('publishes atomically and does not modify successful catalogs or round snapshots on a late parser failure', async () => {
  const previous = oldSuccess(),
    snapshot = one('SELECT products FROM syncs WHERE id=?', previous).products;
  const roundId = randomUUID();
  run(
    "INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,snapshot,digest,payment_mode,test) VALUES (?,?,?,0,1,2,3,?,?,'individual',1)",
    roundId,
    'SB-PRESERVED',
    '2099-01-01',
    snapshot,
    digest(products),
  );
  const job = enqueueMenuSync('test').job,
    adapter = source();
  let reads = 0;
  adapter.read = vi.fn(async (path: string) =>
    path === '/'
      ? fixture
      : ++reads === products.length
        ? '<html>secret-token-in-error</html>'
        : emptyOptions,
  );
  await processMenuSyncJobs(adapter);
  expect(menuSyncStatus(job.id).job).toMatchObject({
    status: 'failed',
    processed: products.length - 1,
    error: { code: 'SOURCE_STRUCTURE' },
  });
  expect(one('SELECT products FROM syncs WHERE id=?', previous).products).toBe(snapshot);
  expect(one('SELECT snapshot FROM rounds WHERE id=?', roundId).snapshot).toBe(snapshot);
  expect(all('SELECT * FROM syncs WHERE success=1')).toHaveLength(1);
  expect(() => latestMenu()).toThrow('mislukt');
  expect(JSON.stringify(menuSyncStatus())).not.toContain('secret-token');
});
it('uses the configured delay even after a settings change and skips unavailable option windows', async () => {
  saveSettings({ ...settings(), syncIntervalMs: 2000 }, 'test');
  enqueueMenuSync('test');
  saveSettings({ ...settings(), syncIntervalMs: 1000 }, 'test');
  const adapter = source(fixture.replace('<button>', '<button disabled>'));
  await processMenuSyncJobs(adapter);
  expect(adapter.delay.mock.calls.every((call) => call[0] === 2000)).toBe(true);
  expect(adapter.read).toHaveBeenCalledTimes(products.length);
  expect(menuSyncStatus().job?.processed).toBe(products.length);
});
it('redacts transport failures and classifies source timeouts without leaking credentials', async () => {
  enqueueMenuSync('test');
  const adapter = source();
  adapter.read = vi.fn(async () => {
    throw Object.assign(new Error('password=secret; https://private.invalid'), {
      name: 'TimeoutError',
    });
  });
  await processMenuSyncJobs(adapter);
  const status = menuSyncStatus();
  expect(status.job?.error?.code).toBe('SOURCE_TIMEOUT');
  expect(JSON.stringify(status)).not.toMatch(/password|private.invalid|secret/);
  expect(one('SELECT error FROM syncs').error).toContain('toegestane tijd');
});
it('stops before further requests if source approval is revoked mid-job', async () => {
  enqueueMenuSync('test');
  const adapter = source();
  adapter.delay = vi.fn(async () => {
    saveSettings({ ...settings(), scrapingApproved: false }, 'test');
  });
  await processMenuSyncJobs(adapter);
  expect(adapter.read).toHaveBeenCalledTimes(1);
  expect(menuSyncStatus().job?.error?.code).toBe('SCRAPING_DISABLED');
});
it('persists a queued job across connections and marks expired running leases interrupted', async () => {
  const previous = oldSuccess(),
    { job } = enqueueMenuSync('test');
  const claimed = claimMenuSyncJob();
  run('UPDATE menu_sync_jobs SET total=213,processed=80 WHERE id=?', job.id);
  const persisted = JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(process.argv[1]);console.log(JSON.stringify(db.prepare('SELECT status,total,processed FROM menu_sync_jobs LIMIT 1').get()));db.close();",
        resolve(directory, 'smikkelbeer.sqlite'),
      ],
      { encoding: 'utf8' },
    ),
  );
  expect(persisted).toMatchObject({ status: 'running', processed: 80, total: 213 });
  recoverMenuSyncJobs();
  expect(menuSyncStatus(job.id).job?.status).toBe('running');
  run('UPDATE menu_sync_jobs SET lease_until=0 WHERE id=?', job.id);
  recoverMenuSyncJobs();
  expect(menuSyncStatus(job.id).job).toMatchObject({
    status: 'interrupted',
    processed: 80,
    error: { code: 'PROCESS_INTERRUPTED' },
  });
  expect(one('SELECT success FROM syncs WHERE id=?', previous).success).toBe(1);
  expect(claimed.lease_owner).toBeTruthy();
  expect(() => enqueueMenuSync('test')).toThrow('één minuut');
});
it('can execute a queued job after restart, and fences a stale worker before publication', async () => {
  enqueueMenuSync('test');
  const adapter = source();
  let release: (value: string) => void = () => {};
  adapter.read = vi.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
  const work = processMenuSyncJobs(adapter);
  await advance();
  run('UPDATE menu_sync_jobs SET lease_until=0');
  recoverMenuSyncJobs();
  release(fixture);
  await work;
  expect(all('SELECT * FROM syncs WHERE success=1')).toHaveLength(0);
  expect(menuSyncStatus().job?.status).toBe('interrupted');
  run('UPDATE menu_sync_jobs SET finished=?', Date.now() - 120000);
  run('UPDATE syncs SET at=?', Date.now() - 120000);
  const next = enqueueMenuSync('test').job;
  await processMenuSyncJobs(source());
  expect(menuSyncStatus(next.id).job?.status).toBe('succeeded');
});
it('creates and rechecks rounds through queued HTTP actions without holding their requests open', async () => {
  const a = admin(),
    input = {
      day: '2099-10-29',
      invite: '11:45',
      close: '12:00',
      send: '12:05',
      arrival: '12:30',
      paymentMode: 'individual',
    };
  const accepted = await POST(
    event('rounds/create', a.token, { ...input, requestId: randomUUID() }),
  );
  expect(accepted.status).toBe(202);
  expect(all('SELECT * FROM rounds')).toHaveLength(0);
  await processMenuSyncJobs(source());
  const job = menuSyncStatus().job!;
  expect(job.status).toBe('succeeded');
  expect(job.resultRoundId).toBeTruthy();
  expect(all('SELECT * FROM rounds')).toHaveLength(1);
  const again = await POST(event('rounds/create', a.token, { ...input, requestId: randomUUID() }));
  expect(again.status).toBe(409);
  expect(all('SELECT * FROM menu_sync_jobs')).toHaveLength(1);
});
it('checks dependent round permissions again after the source is complete', async () => {
  const a = admin('coordinator');
  await POST(
    event('rounds/create', a.token, {
      requestId: randomUUID(),
      day: '2099-10-29',
      invite: '11:45',
      close: '12:00',
      send: '12:05',
      arrival: '12:30',
      paymentMode: 'individual',
    }),
  );
  run("UPDATE admins SET role_id='payments' WHERE id=?", a.id);
  await processMenuSyncJobs(source());
  expect(menuSyncStatus().job?.error?.code).toBe('PERMISSION_REVOKED');
  expect(all('SELECT * FROM rounds')).toHaveLength(0);
  expect(all('SELECT * FROM syncs WHERE success=1')).toHaveLength(1);
});
it('validates status IDs and reports Dutch errors for missing tasks', async () => {
  const a = admin();
  expect((await GET(event('menu/sync/status?id=wrong', a.token))).status).toBe(400);
  expect((await GET(event('menu/sync/status?id=' + randomUUID(), a.token))).status).toBe(404);
});

it('does not tie background work to a disconnected initiating HTTP request', async () => {
  const a = admin(),
    controller = new AbortController(),
    request = event('menu/sync', a.token);
  request.request = new Request(request.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: controller.signal,
  });
  const response = await POST(request);
  expect(response.status).toBe(202);
  controller.abort();
  await processMenuSyncJobs(source());
  expect(menuSyncStatus().job?.status).toBe('succeeded');
});
it('keeps a restored partial job interrupted and preserves progress rather than resuming external requests', () => {
  const { job } = enqueueMenuSync('test');
  claimMenuSyncJob();
  run('UPDATE menu_sync_jobs SET total=213,processed=80 WHERE id=?', job.id);
  const backup = resolve(directory, '..', 'sync-backup-' + randomUUID()),
    destination = resolve(directory, '..', 'sync-restore-' + randomUUID());
  try {
    execFileSync(process.execPath, ['scripts/backup.mjs', backup], {
      env: { ...process.env, DATA_DIR: directory },
    });
    execFileSync(process.execPath, ['scripts/restore.mjs', backup], {
      env: { ...process.env, DATA_DIR: destination },
    });
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import{DatabaseSync}from'node:sqlite';const db=new DatabaseSync(process.argv[1]);console.log(JSON.stringify(db.prepare('SELECT status,processed,error_code,lease_owner FROM menu_sync_jobs LIMIT 1').get()));db.close();",
          resolve(destination, 'smikkelbeer.sqlite'),
        ],
        { encoding: 'utf8' },
      ),
    );
    expect(result).toMatchObject({
      status: 'interrupted',
      processed: 80,
      error_code: 'BACKUP_RESTORED',
      lease_owner: null,
    });
  } finally {
    rmSync(backup, { recursive: true, force: true });
    rmSync(destination, { recursive: true, force: true });
  }
});
it('returns a safe source HTTP diagnostic when Cloudflare HTML is received from the cafetaria', async () => {
  enqueueMenuSync('test');
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('<html>private upstream data</html>', {
          status: 524,
          headers: { 'content-type': 'text/html' },
        }),
    ),
  );
  try {
    await processMenuSyncJobs();
    expect(menuSyncStatus().job?.error).toMatchObject({
      code: 'SOURCE_HTTP',
      message: expect.stringContaining('HTTP 524'),
    });
    expect(JSON.stringify(menuSyncStatus())).not.toContain('private upstream');
  } finally {
    vi.unstubAllGlobals();
  }
});

it('retains a completed catalog when a dependent round expires during source validation', async () => {
  const { roundTimes } = await import('../src/lib/server/orders');
  const input = {
    day: '2099-10-29',
    invite: '11:45',
    close: '12:00',
    send: '12:05',
    arrival: '12:30',
    paymentMode: 'individual' as const,
  };
  const closes = roundTimes(input).closes;
  vi.useFakeTimers();
  vi.setSystemTime(closes - 60000);
  const a = admin();
  await POST(event('rounds/create', a.token, { ...input, requestId: randomUUID() }));
  const adapter = source();
  adapter.delay = vi.fn(async () => {
    vi.setSystemTime(closes + 1000);
  }) as any;
  await processMenuSyncJobs(adapter);
  expect(menuSyncStatus().job?.error?.code).toBe('ROUND_PAST');
  expect(all('SELECT * FROM rounds')).toHaveLength(0);
  expect(latestMenu().products).toHaveLength(products.length);
});
const roundForm = {
  day: '2099-10-29',
  invite: '11:45',
  close: '12:00',
  send: '12:05',
  arrival: '12:30',
  paymentMode: 'individual',
};
it('creates immediately from the latest fresh complete snapshot, preserves options and never calls the source', async () => {
  const { parseOptions } = await import('../src/lib/server/menu');
  const full = structuredClone(products);
  full.find((p) => p.id === '85')!.options = parseOptions(
    readFileSync('tests/fixtures/options-85.html', 'utf8'),
    '85',
  );
  full[1].available = false;
  run(
    'INSERT INTO syncs VALUES (?,?,1,?,?,NULL)',
    randomUUID(),
    Date.now(),
    digest(full),
    JSON.stringify(full),
  );
  const a = admin(),
    requestId = randomUUID();
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      POST(event('rounds/create', a.token, { ...roundForm, requestId })),
    ),
  );
  expect(responses.map((r) => r.status)).toEqual([201, 200, 200, 200, 200]);
  const results = await Promise.all(responses.map((r) => r.json()));
  expect(new Set(results.map((r) => r.roundId)).size).toBe(1);
  expect(results.every((r) => r.job === null)).toBe(true);
  expect(JSON.parse(one('SELECT snapshot FROM rounds').snapshot)).toEqual(full);
  expect(one('SELECT digest FROM rounds').digest).toBe(digest(full));
  expect(all('SELECT * FROM menu_sync_jobs')).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
  const recovered = await (
    await GET(event('rounds/create/status?id=' + requestId, a.token))
  ).json();
  expect(recovered.roundId).toBe(results[0].roundId);
  const other = admin();
  expect((await GET(event('rounds/create/status?id=' + requestId, other.token))).status).toBe(404);
  const conflict = await POST(
    event('rounds/create', a.token, { ...roundForm, requestId, close: '12:01' }),
  );
  expect(conflict.status).toBe(409);
  expect((await conflict.json()).code).toBe('REQUEST_CONFLICT');
});
it.each(['missing', 'stale', 'failed', 'corrupt', 'future'])(
  'requires a separate full background check when the snapshot is %s',
  async (reason) => {
    if (reason !== 'missing') {
      oldSuccess();
      if (reason === 'stale') run('UPDATE syncs SET at=?', Date.now() - 30 * 60000 - 1);
      if (reason === 'failed')
        run(
          'INSERT INTO syncs VALUES (?,?,0,NULL,NULL,?)',
          randomUUID(),
          Date.now() - 60001,
          'Veilige bronfout',
        );
      if (reason === 'corrupt') run("UPDATE syncs SET digest='incorrect'");
      if (reason === 'future') run('UPDATE syncs SET at=?', Date.now() + 60000);
    }
    const a = admin();
    const response = await POST(
      event('rounds/create', a.token, { ...roundForm, requestId: randomUUID() }),
    );
    // Future-dated records also conservatively enforce the existing cooldown.
    expect(response.status).toBe(reason === 'future' ? 429 : 202);
    expect(all('SELECT * FROM rounds')).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    if (response.status === 202) {
      await processMenuSyncJobs(source());
      expect(all('SELECT * FROM rounds')).toHaveLength(1);
    }
  },
);
it('accepts the exact freshness boundary and rejects a corrupt snapshot without silently falling back', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T11:00:00Z'));
  oldSuccess();
  run('UPDATE syncs SET at=?', Date.now() - 30 * 60000);
  const { createRound } = await import('../src/lib/server/orders');
  await createRound(roundForm, 'test');
  expect(all('SELECT * FROM rounds')).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
  run("UPDATE syncs SET digest='wrong'");
  expect(() => latestMenu()).toThrow('integriteit');
});
it('retains approval, permissions, valid dates and time-order checks even on the immediate path', async () => {
  oldSuccess();
  const a = admin();
  const pay = admin('payments');
  await expect(
    POST(event('rounds/create', pay.token, { ...roundForm, requestId: randomUUID() })),
  ).rejects.toBeDefined();
  saveSettings({ ...settings(), scrapingApproved: false }, 'test');
  expect(
    (await POST(event('rounds/create', a.token, { ...roundForm, requestId: randomUUID() }))).status,
  ).toBe(400);
  approved();
  for (const changes of [
    { day: '10/29/2099' },
    { day: '2099-02-30' },
    { send: '12:29' },
    { day: '2099-10-25', invite: '02:15', close: '02:30' },
  ]) {
    const response = await POST(
      event('rounds/create', a.token, { ...roundForm, ...changes, requestId: randomUUID() }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).message).toMatch(/datum|tijd|voorbereiding/);
  }
  expect(all('SELECT * FROM rounds')).toHaveLength(0);
});
it('deduplicates a slow creation across lost responses, durable status reads and completion', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T11:00:00Z'));
  const a = admin(),
    requestId = randomUUID(),
    input = { ...roundForm, requestId };
  const largeMenu = Array.from(
    { length: 213 },
    (_, i) =>
      `<div class="dish" id="product${1000 + i}" data-productid="${1000 + i}" data-productnaam="Testproduct" data-productcategorie="Patat" data-prijs="2.90"><button>Toevoegen</button></div>`,
  ).join('');
  const accepted = await POST(event('rounds/create', a.token, input));
  expect(accepted.status).toBe(202);
  const adapter = source(largeMenu);
  adapter.delay = vi.fn(
    (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  ) as any;
  const work = processMenuSyncJobs(adapter);
  await advance();
  await vi.advanceTimersByTimeAsync(130000);
  const again = await (await POST(event('rounds/create', a.token, input))).json();
  expect(again.reused).toBe(true);
  expect(again.job.processed).toBe(130);
  expect(all('SELECT * FROM menu_sync_jobs')).toHaveLength(1);
  expect(all('SELECT * FROM rounds')).toHaveLength(0);
  const status = await GET(event('rounds/create/status?id=' + requestId, a.token));
  expect((await status.json()).job.id).toBe(again.job.id);
  await vi.advanceTimersByTimeAsync(83000);
  await work;
  const complete = await (await POST(event('rounds/create', a.token, input))).json();
  expect(complete.roundId).toBeTruthy();
  expect(complete.job.status).toBe('succeeded');
  expect(all('SELECT * FROM rounds')).toHaveLength(1);
  expect(adapter.read).toHaveBeenCalledTimes(214);
});
it('performs a new full source check before final dispatch even when a fresh snapshot exists', async () => {
  oldSuccess();
  const a = admin();
  const created = await (
    await POST(event('rounds/create', a.token, { ...roundForm, requestId: randomUUID() }))
  ).json();
  const id = randomUUID();
  run(
    'INSERT INTO employees(id,name,name_key,email,created) VALUES (?,?,?,?,?)',
    id,
    'Beer',
    'beer',
    'beer@example.invalid',
    Date.now(),
  );
  run(
    "INSERT INTO orders(id,round_id,employee_id,name,lines,total,revision,updated) VALUES (?,?,?,'Beer',?,290,1,?)",
    randomUUID(),
    created.roundId,
    id,
    JSON.stringify([{ name: 'Patat', quantity: 1, total: 290, unit: 290, options: [], note: '' }]),
    Date.now(),
  );
  run("UPDATE rounds SET status='closed',closes=0,sends=0 WHERE id=?", created.roundId);
  const response = await POST(event('rounds/recheck', a.token, { id: created.roundId }));
  expect(response.status).toBe(202);
  expect(all("SELECT * FROM outbox WHERE kind='order'")).toHaveLength(0);
  const adapter = source(fixture.replace('data-prijs="2.90"', 'data-prijs="3.90"'));
  await processMenuSyncJobs(adapter);
  expect(adapter.read).toHaveBeenCalledTimes(products.filter((p) => p.available).length + 1);
  expect(one('SELECT status FROM rounds WHERE id=?', created.roundId).status).toBe('blocked');
  expect(all("SELECT * FROM outbox WHERE kind='order'")).toHaveLength(0);
});
it('interrupts safely when a heartbeat cannot renew the database lease', async () => {
  const jobs = await import('../src/lib/server/menu-jobs');
  vi.useFakeTimers();
  enqueueMenuSync('test');
  const adapter = source();
  adapter.read = vi.fn(
    async (path: string, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
  ) as any;
  const renewal = vi.spyOn(jobs, 'renewMenuLease').mockImplementation(() => {
    throw new Error('private database detail');
  });
  try {
    const work = processMenuSyncJobs(adapter);
    await advance();
    await vi.advanceTimersByTimeAsync(10000);
    await work;
    expect(menuSyncStatus().job?.status).toBe('interrupted');
    expect(JSON.stringify(menuSyncStatus())).not.toContain('private database detail');
  } finally {
    renewal.mockRestore();
  }
});
it('records a graceful shutdown as interrupted and never publishes its partial result', async () => {
  const { stopMenuSyncWorker } = await import('../src/lib/server/menu');
  oldSuccess();
  enqueueMenuSync('test');
  const adapter = source();
  adapter.read = vi.fn(
    async (path: string, signal: AbortSignal) =>
      new Promise<string>((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('request aborted')), {
          once: true,
        });
      }),
  ) as any;
  const work = processMenuSyncJobs(adapter);
  await advance();
  stopMenuSyncWorker();
  await work;
  expect(menuSyncStatus().job?.status).toBe('interrupted');
  expect(menuSyncStatus().job?.error?.code).toBe('PROCESS_INTERRUPTED');
  expect(all('SELECT * FROM syncs WHERE success=1')).toHaveLength(1);
});
