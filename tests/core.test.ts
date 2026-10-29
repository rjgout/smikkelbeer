import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const directory = mkdtempSync(resolve(tmpdir(), 'smikkel-test-'));
process.env.DATA_DIR = directory;
const { db, run, one, all, transaction } = await import('../src/lib/server/db');
const { hash, encrypt, decrypt, passwordHash, passwordVerify } =
  await import('../src/lib/server/crypto');
const { defaults, saveSettings, settingsSchema } = await import('../src/lib/server/config');
const {
  firstName,
  issueToken,
  consumeToken,
  identity,
  requireAdmin,
  requireEmployee,
  participates,
  beginSetup,
  finishSetup,
  totp,
  loginAdmin,
  rateLimit,
} = await import('../src/lib/server/auth');
const { parseMenu, parseOptions, cents, priceLines, digest } =
  await import('../src/lib/server/menu');
const { saveOrder, queueValidatedRound, roundTimes, updateTimes } =
  await import('../src/lib/server/orders');
const { renderOrder, enqueue, processOutbox, classifyIncoming, recoverSending } =
  await import('../src/lib/server/mail');
const { publicIPv4 } = await import('../src/lib/server/network');
const fixture = readFileSync('tests/fixtures/menu.html', 'utf8');
const products = parseMenu(fixture);
products[products.findIndex((p) => p.id === '85')].options = parseOptions(
  readFileSync('tests/fixtures/options-85.html', 'utf8'),
  '85',
);
function event(kind = ''): any {
  const cookies = new Map<string, string>();
  return {
    cookies: {
      get: (k: string) => cookies.get(k),
      set: (k: string, v: string) => cookies.set(k, v),
      delete: (k: string) => cookies.delete(k),
    },
    getClientAddress: () => kind || randomUUID(),
  };
}
function employee(name = 'TestBeer') {
  const id = randomUUID();
  run(
    'INSERT INTO employees(id,name,name_key,email,created) VALUES (?,?,?,?,?)',
    id,
    name,
    name.toLowerCase(),
    id + '@example.invalid',
    Date.now(),
  );
  return id;
}
function round(status = 'open', snapshot = products) {
  const id = randomUUID(),
    now = Date.now();
  run(
    'INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,status,snapshot,digest,payment_mode,test) VALUES (?,?,?,?,?,?,?,?,?,?,?,1)',
    id,
    'SB-' + id,
    '2026-10-' + String(1 + all('SELECT id FROM rounds').length).padStart(2, '0'),
    now - 600000,
    now + 600000,
    now + 1200000,
    now + 2400000,
    status,
    JSON.stringify(snapshot),
    digest(snapshot),
    'individual',
  );
  return id;
}
function config() {
  saveSettings(
    {
      ...structuredClone(defaults),
      testRecipients: ['test@example.invalid'],
      smtp: { ...defaults.smtp, host: 'smtp.example.invalid', from: 'sender@example.invalid' },
      cafeteria: 'cafetaria@example.invalid',
    },
    'test',
  );
}
beforeEach(() => {
  vi.useRealTimers();
  db.exec('PRAGMA foreign_keys=OFF; DROP TRIGGER IF EXISTS protect_last_admin_delete;');
  for (const table of [
    'jobs',
    'outbox',
    'inbox',
    'audit',
    'orders',
    'rounds',
    'favorites',
    'tokens',
    'employees',
    'sessions',
    'admins',
    'bootstrap',
    'settings',
    'rate_limits',
    'syncs',
  ])
    db.exec('DELETE FROM ' + table);
  db.exec(
    "CREATE TRIGGER protect_last_admin_delete BEFORE DELETE ON admins WHEN OLD.active=1 AND OLD.role_id='admin' AND (SELECT count(*) FROM admins WHERE active=1 AND role_id='admin')<=1 BEGIN SELECT RAISE(ABORT,'Last administrator'); END; PRAGMA foreign_keys=ON;",
  );
  config();
});
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
describe('migrations, encryption and configuration', () => {
  it('applies migrations and enforces foreign keys', () => {
    expect(one('SELECT count(*) n FROM migrations').n).toBe(3);
    expect(() => run('INSERT INTO favorites VALUES (?,?)', 'missing', '85')).toThrow();
  });
  it('authenticated encryption rejects tampering and stores no plaintext config', () => {
    const value = encrypt('mail-secret');
    expect(decrypt(value)).toBe('mail-secret');
    expect(() => decrypt(value.slice(0, -5) + 'xxxxx')).toThrow();
    expect(one('SELECT value FROM settings').value).not.toContain('smtp.example');
  });
  it('hashes passwords with independent salts', () => {
    const a = passwordHash('a-long-example-password'),
      b = passwordHash('a-long-example-password');
    expect(a).not.toBe(b);
    expect(passwordVerify('a-long-example-password', a)).toBe(true);
    expect(passwordVerify('wrong', a)).toBe(false);
  });
  it('requires HTTPS, safe clock ordering and isolated test addresses', () => {
    expect(() => settingsSchema.parse({ ...defaults, publicUrl: 'http://example.com' })).toThrow();
    expect(() => settingsSchema.parse({ ...defaults, sendTime: '12:40' })).toThrow();
    expect(() =>
      settingsSchema.parse({
        ...defaults,
        cafeteria: 'a@example.com',
        testRecipients: ['a@example.com'],
      }),
    ).toThrow();
  });
  it('rolls nested operations back with their parent', () => {
    expect(() =>
      transaction(() => {
        employee();
        transaction(() => employee('TestVos'));
        throw new Error('rollback');
      }),
    ).toThrow();
    expect(all('SELECT * FROM employees')).toHaveLength(0);
  });
});
describe('authentication and authorization', () => {
  it('rejects setup without a local one-time bootstrap code', () => {
    expect(() =>
      beginSetup({
        token: 'a'.repeat(43),
        email: 'admin@example.invalid',
        password: 'example-password-long',
      }),
    ).toThrow();
  });
  it('enrolls MFA, prevents replay and separates administrator and employee sessions', () => {
    const token = 'b'.repeat(43),
      e = event();
    run('INSERT INTO bootstrap VALUES (1,?,?,NULL)', hash(token), Date.now() + 60000);
    const setup = beginSetup({
      token,
      email: 'admin@example.invalid',
      password: 'example-password-long',
    });
    const code = totp(setup.secret).generate();
    finishSetup(e, { token, code });
    expect(identity(e, 'admin')?.permissions).toEqual(['*']);
    expect(identity(e, 'employee')).toBeNull();
    expect(() => requireEmployee(e)).toThrow();
    expect(() => finishSetup(e, { token, code })).toThrow();
    expect(() =>
      loginAdmin(event(), {
        email: 'admin@example.invalid',
        password: 'example-password-long',
        code,
      }),
    ).toThrow();
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 30000);
    const next = event();
    loginAdmin(next, {
      email: 'admin@example.invalid',
      password: 'example-password-long',
      code: totp(setup.secret).generate(),
    });
    expect(requireAdmin(next, 'settings').kind).toBe('admin');
  });
  it('does not consume magic tokens on inspection, consumes only once', () => {
    const id = employee(),
      token = issueToken(id);
    expect(one('SELECT used FROM tokens WHERE hash=?', hash(token)).used).toBeNull();
    const e = event();
    consumeToken(e, token);
    expect(identity(e, 'employee')?.id).toBe(id);
    expect(() => consumeToken(event(), token)).toThrow();
    expect(one('SELECT hash FROM tokens').hash).not.toBe(token);
  });
  it('rejects expired and deactivated links', () => {
    const id = employee(),
      token = issueToken(id);
    run('UPDATE tokens SET expires=0');
    expect(() => consumeToken(event(), token)).toThrow();
    const next = issueToken(id);
    run('UPDATE employees SET active=0 WHERE id=?', id);
    expect(() => consumeToken(event(), next)).toThrow();
  });
  it('rejects email verification in a different employee session', () => {
    const id = employee(),
      other = employee('TestVos');
    const token = issueToken(id, 'email', 'new@example.invalid'),
      e = event();
    consumeToken(e, issueToken(other));
    expect(() => consumeToken(e, token)).toThrow();
    expect(one('SELECT used FROM tokens WHERE hash=?', hash(token)).used).toBeNull();
  });
  it('changes email only after verification in the correct session', () => {
    const id = employee(),
      e = event();
    consumeToken(e, issueToken(id));
    consumeToken(e, issueToken(id, 'email', 'new@example.invalid'));
    expect(one('SELECT email FROM employees WHERE id=?', id).email).toBe('new@example.invalid');
  });
  it('enforces limited roles and protects the last full administrator', () => {
    const id = randomUUID();
    run(
      "INSERT INTO admins(id,email,password,totp,role_id) VALUES (?,?,?,?,'payments')",
      id,
      'pay@example.invalid',
      'x',
      encrypt('x'),
    );
    const e = event(),
      token = 'c'.repeat(43);
    e.cookies.set('sb_admin', token);
    run("INSERT INTO sessions VALUES (?,'admin',?,?)", hash(token), id, Date.now() + 10000);
    expect(() => requireAdmin(e, 'settings')).toThrow();
    expect(requireAdmin(e, 'payments').id).toBe(id);
    run("UPDATE admins SET role_id='admin' WHERE id=?", id);
    expect(() => run('DELETE FROM admins WHERE id=?', id)).toThrow();
    expect(() => run('UPDATE admins SET active=0 WHERE id=?', id)).toThrow();
    expect(() => run("UPDATE roles SET permissions='[]' WHERE id='admin'")).toThrow();
  });
  it('rate-limits repeated requests', () => {
    rateLimit('test', 1);
    expect(() => rateLimit('test', 1)).toThrow();
  });
});
describe('profiles and participation', () => {
  it('allows accents and hyphenated names, rejects spaces and markup', () => {
    expect(firstName.parse('Éloïse')).toBe('Éloïse');
    expect(firstName.parse('Henk-Jan')).toBe('Henk-Jan');
    expect(() => firstName.parse('Henk Jan')).toThrow();
    expect(() => firstName.parse('<script>')).toThrow();
  });
  it('enforces unique active names case-insensitively', () => {
    employee('TestBeer');
    expect(() => employee('testbeer')).toThrow();
  });
  it('handles holidays, skipped rounds, pauses and automatic resumption', () => {
    const e = {
      active: 1,
      preferences: JSON.stringify({
        participation: 'away',
        from: '2026-10-20',
        until: '2026-10-29',
      }),
    };
    expect(participates(e, 'r', '2026-10-29')).toBe(false);
    expect(participates(e, 'r', '2026-10-30')).toBe(true);
    expect(
      participates(
        { ...e, preferences: JSON.stringify({ participation: 'paused' }) },
        'r',
        '2026-10-30',
      ),
    ).toBe(false);
    expect(
      participates(
        { ...e, preferences: JSON.stringify({ participation: 'normal', skipRound: 'r' }) },
        'r',
        '2026-10-30',
      ),
    ).toBe(false);
  });
});
describe('official menu and price calculations', () => {
  it('parses source IDs, categories and real option prices', () => {
    expect(products.find((p) => p.id === '85')).toMatchObject({
      name: 'Patat',
      category: 'Patat',
      cents: 290,
    });
    expect(products.find((p) => p.id === '85')?.options[0].cents).toBeGreaterThan(0);
    expect(cents('2.90')).toBe(290);
    expect(() => cents('2,90')).toThrow();
  });
  it('detects sold-out products and changed source structures', () => {
    const source = fixture.replace('<button>', '<button disabled>');
    expect(parseMenu(source).some((p) => !p.available)).toBe(true);
    expect(() => parseMenu('<p>storing</p>')).toThrow();
    expect(() => parseOptions('<select></select>', '85')).toThrow();
    expect(() => parseOptions('<div id="addProductForm"><select></select></div>', '85')).toThrow();
  });
  it('merges favorite/menu duplicates and ignores client prices', () => {
    const lines = priceLines(
      [
        { productId: '85', optionIds: [], quantity: 2, note: '', price: 1 },
        { productId: '85', optionIds: [], quantity: 1, note: '' },
      ],
      products,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].total).toBe(870);
  });
  it('keeps notes and options separate and rejects unknown options', () => {
    const base = { productId: '85', optionIds: [], quantity: 1, note: '' };
    expect(priceLines([base, { ...base, note: 'apart' }], products)).toHaveLength(2);
    expect(() => priceLines([{ ...base, optionIds: ['invented'] }], products)).toThrow();
  });
  it('rejects oversized quantities, fractional quantities and unavailable products', () => {
    expect(() =>
      priceLines([{ productId: '85', optionIds: [], quantity: 1.5, note: '' }], products),
    ).toThrow();
    expect(() =>
      priceLines([{ productId: '85', optionIds: [], quantity: 31, note: '' }], products),
    ).toThrow();
    expect(() =>
      priceLines(
        [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
        products.map((p) => ({ ...p, available: false })),
      ),
    ).toThrow();
  });
});
describe('orders, deadlines and email consistency', () => {
  it('stores orders and detects concurrent revision conflicts', () => {
    const id = employee(),
      r = round();
    const input = {
      roundId: r,
      revision: 0,
      lines: [{ productId: '85', optionIds: [], quantity: 2, note: '' }],
      declined: false,
    };
    run('UPDATE employees SET preferences=? WHERE id=?', '{"confirmations":false}', id);
    expect(saveOrder(id, input).total).toBe(580);
    expect(() => saveOrder(id, input)).toThrow();
    expect(saveOrder(id, { ...input, revision: 1 }).revision).toBe(2);
  });
  it('enforces deadlines on the server and snapshots are immutable', () => {
    const id = employee(),
      r = round();
    run('UPDATE rounds SET closes=? WHERE id=?', Date.now() - 1, r);
    expect(() => saveOrder(id, { roundId: r, revision: 0, lines: [], declined: true })).toThrow();
    expect(() => run("UPDATE rounds SET snapshot='[]' WHERE id=?", r)).toThrow();
  });
  it('supports explicit non-participation without charging', () => {
    const id = employee(),
      r = round();
    run('UPDATE employees SET preferences=? WHERE id=?', '{"confirmations":false}', id);
    expect(saveOrder(id, { roundId: r, revision: 0, lines: [], declined: true }).total).toBe(0);
    expect(one('SELECT declined FROM orders').declined).toBe(1);
  });
  it('does not send empty rounds', () => {
    const r = round('closed');
    run('UPDATE rounds SET sends=0 WHERE id=?', r);
    queueValidatedRound(r, digest(products));
    expect(one('SELECT status FROM rounds').status).toBe('completed');
    expect(all('SELECT * FROM outbox')).toHaveLength(0);
  });
  it('blocks changed source prices and prevents duplicate queueing', () => {
    const id = employee(),
      r = round();
    run('UPDATE employees SET preferences=? WHERE id=?', '{"confirmations":false}', id);
    saveOrder(id, {
      roundId: r,
      revision: 0,
      lines: [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
      declined: false,
    });
    run("UPDATE rounds SET sends=0,status='closed' WHERE id=?", r);
    queueValidatedRound(r, 'changed');
    expect(one('SELECT status FROM rounds').status).toBe('blocked');
    queueValidatedRound(r, digest(products));
    queueValidatedRound(r, digest(products));
    expect(all("SELECT * FROM outbox WHERE kind='order'")).toHaveLength(1);
  });
  it('keeps kitchen and personal totals equal and escapes untrusted comments', () => {
    const lines = priceLines(
      [{ productId: '85', optionIds: [], quantity: 2, note: '<img src=x onerror=alert(1)>' }],
      products,
    );
    const html = renderOrder(
      { number: 'SB-test', arrives: Date.now(), payment_mode: 'individual' },
      [{ employeeId: '1', name: 'TestBeer', lines, total: 580 }],
    );
    expect(html.indexOf('Totaaloverzicht')).toBeLessThan(html.indexOf('Individuele bestellingen'));
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<img');
    expect(() =>
      renderOrder({ arrives: Date.now() }, [{ employeeId: '1', name: 'Beer', lines, total: 1 }]),
    ).toThrow();
  });
  it('rejects ambiguous and nonexistent Amsterdam times across DST', () => {
    for (const [day, clock] of [
      ['2026-03-29', '02:15'],
      ['2026-10-25', '02:15'],
    ])
      expect(() =>
        roundTimes({
          day,
          invite: clock,
          close: '03:00',
          send: '03:10',
          arrival: '03:40',
          paymentMode: 'individual',
        }),
      ).toThrow();
    expect(
      roundTimes({
        day: '2026-11-01',
        invite: '11:45',
        close: '12:00',
        send: '12:05',
        arrival: '12:30',
        paymentMode: 'individual',
      }).sends,
    ).toBeGreaterThan(0);
  });
  it('requires explicit confirmation before post-send arrival corrections', () => {
    const r = round('sent');
    const row = one('SELECT * FROM rounds WHERE id=?', r);
    expect(() =>
      updateTimes(
        r,
        { close: '12:00', send: '12:05', arrival: '13:00', confirmCorrection: false },
        'test',
      ),
    ).toThrow();
    expect(one('SELECT arrives FROM rounds WHERE id=?', r).arrives).toBe(row.arrives);
  });
});
describe('persistent mail outbox and incoming mail', () => {
  it('encrypts message bodies and blocks test deliveries to real recipients', () => {
    expect(() =>
      enqueue({
        dedupe: 'bad',
        to: 'cafetaria@example.invalid',
        subject: 'test',
        html: 'secret',
        kind: 'test',
      }),
    ).toThrow();
    enqueue({
      dedupe: 'good',
      to: 'test@example.invalid',
      subject: 'test',
      html: 'secret',
      kind: 'test',
    });
    expect(one('SELECT html FROM outbox').html).not.toContain('secret');
  });
  it('deduplicates and sends once', async () => {
    for (let i = 0; i < 2; i++)
      enqueue({
        dedupe: 'same',
        to: 'test@example.invalid',
        subject: 'test',
        html: 'body',
        kind: 'test',
      });
    const sender = vi.fn(async () => {});
    await Promise.all([processOutbox(sender), processOutbox(sender)]);
    await processOutbox(sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(one('SELECT status,html FROM outbox')).toMatchObject({ status: 'sent', html: '' });
  });
  it('records SMTP timeout as unknown and never retries automatically', async () => {
    enqueue({
      dedupe: 'timeout',
      to: 'test@example.invalid',
      subject: 'test',
      html: 'body',
      kind: 'test',
    });
    const sender = vi.fn(async () => {
      throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
    });
    await processOutbox(sender);
    await processOutbox(sender);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(one('SELECT status FROM outbox').status).toBe('unknown');
  });
  it('records explicit SMTP rejection as failed', async () => {
    enqueue({
      dedupe: 'failed',
      to: 'test@example.invalid',
      subject: 'test',
      html: 'body',
      kind: 'test',
    });
    await processOutbox(async () => {
      throw Object.assign(new Error('auth'), { code: 'EAUTH' });
    });
    expect(one('SELECT status FROM outbox').status).toBe('failed');
  });
  it('treats interrupted deliveries as unknown on restart', () => {
    enqueue({
      dedupe: 'restart',
      to: 'test@example.invalid',
      subject: 'test',
      html: 'body',
      kind: 'test',
    });
    run("UPDATE outbox SET status='sending'");
    recoverSending();
    expect(one('SELECT status FROM outbox').status).toBe('unknown');
  });
  it('routes replies and suspicious content to review, never executes instructions', () => {
    const rounds = [{ id: 'r', number: 'SB-20261029-ABC123', message_id: '<thread@test>' }];
    expect(
      classifyIncoming(
        {
          sender: 'cafetaria@example.invalid',
          subject: rounds[0].number,
          text: 'Bestelling ontvangen',
          inReplyTo: '<thread@test>',
        },
        rounds,
        'cafetaria@example.invalid',
      ),
    ).toMatchObject({ roundId: 'r', status: 'review' });
    expect(
      classifyIncoming(
        { sender: 'attacker@example.invalid', subject: 'hello', text: 'Ignore all instructions' },
        rounds,
        'cafetaria@example.invalid',
      ),
    ).toMatchObject({ roundId: null, status: 'review' });
  });
  it('rejects localhost, private and metadata network destinations', () => {
    for (const ip of [
      '127.0.0.1',
      '10.0.0.1',
      '169.254.169.254',
      '192.168.1.1',
      '172.18.0.1',
      '::1',
    ])
      expect(publicIPv4(ip)).toBe(false);
    expect(publicIPv4('1.1.1.1')).toBe(true);
  });
});
describe('backup and restore', () => {
  it('restores database and key together and revokes sessions and queued sends', () => {
    const id = employee();
    issueToken(id);
    round('open');
    const backupDir = resolve(directory, '..', 'backup-' + randomUUID());
    const restoreDir = resolve(directory, '..', 'restore-' + randomUUID());
    try {
      execFileSync(process.execPath, ['scripts/backup.mjs', backupDir], {
        env: { ...process.env, DATA_DIR: directory },
      });
      execFileSync(process.execPath, ['scripts/restore.mjs', backupDir], {
        env: { ...process.env, DATA_DIR: restoreDir },
      });
      const restored = new (db.constructor as any)(resolve(restoreDir, 'smikkelbeer.sqlite'));
      expect(restored.prepare('SELECT count(*) n FROM employees').get().n).toBe(1);
      expect(restored.prepare('SELECT count(*) n FROM tokens').get().n).toBe(0);
      expect(restored.prepare('SELECT status FROM rounds').get().status).toBe('unknown');
      expect(readFileSync(resolve(restoreDir, 'master.key'))).toEqual(
        readFileSync(resolve(directory, 'master.key')),
      );
      restored.close();
      expect(() =>
        execFileSync(process.execPath, ['scripts/restore.mjs', backupDir], {
          env: { ...process.env, DATA_DIR: restoreDir },
          stdio: 'pipe',
        }),
      ).toThrow();
    } finally {
      rmSync(backupDir, { recursive: true, force: true });
      rmSync(restoreDir, { recursive: true, force: true });
    }
  });
});

describe('scheduler and additional round migration', () => {
  it('opens planned rounds, queues eligible invitations once and leaves paused employees alone', async () => {
    const { tick } = await import('../src/lib/server/scheduler');
    const s = (await import('../src/lib/server/config')).settings();
    saveSettings({ ...s, weekdays: [], smtp: { ...s.smtp, host: '' } }, 'test');
    const first = employee(),
      paused = employee('TestVos');
    run('UPDATE employees SET email=? WHERE id=?', 'test@example.invalid', first);
    run(
      'UPDATE employees SET preferences=? WHERE id=?',
      '{"participation":"paused","confirmations":false}',
      paused,
    );
    const r = round('planned');
    run('UPDATE rounds SET closes=? WHERE id=?', Date.now() + 20 * 60000, r);
    await tick();
    await tick();
    expect(one('SELECT status FROM rounds WHERE id=?', r).status).toBe('open');
    expect(all("SELECT * FROM outbox WHERE kind='invitation'")).toHaveLength(1);
  });
  it('retains referenced orders while migrating to multiple rounds per day', () => {
    const legacyDir = mkdtempSync(resolve(tmpdir(), 'smikkel-legacy-'));
    try {
      const legacy = new (db.constructor as any)(resolve(legacyDir, 'smikkelbeer.sqlite'));
      legacy.exec(readFileSync('migrations/001_initial.sql', 'utf8'));
      legacy.exec(
        "CREATE TABLE migrations(name TEXT PRIMARY KEY,applied INTEGER NOT NULL); INSERT INTO migrations VALUES ('001_initial.sql',1);",
      );
      legacy
        .prepare('INSERT INTO employees(id,name,name_key,email,created) VALUES (?,?,?,?,?)')
        .run('e', 'Beer', 'beer', 'test@example.invalid', 1);
      legacy
        .prepare(
          'INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,snapshot,digest,payment_mode,test) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run('r', 'SB-legacy', '2026-10-29', 1, 2, 3, 4, '[]', 'digest', 'individual', 1);
      legacy
        .prepare(
          'INSERT INTO orders(id,round_id,employee_id,name,lines,total,revision,updated) VALUES (?,?,?,?,?,?,?,?)',
        )
        .run('o', 'r', 'e', 'Beer', '[]', 0, 1, 1);
      legacy.close();
      execFileSync(
        process.execPath,
        ['--input-type=module', '-e', "import './src/lib/server/db.ts'"],
        { env: { ...process.env, DATA_DIR: legacyDir }, stdio: 'pipe' },
      );
      const migrated = new (db.constructor as any)(resolve(legacyDir, 'smikkelbeer.sqlite'));
      expect(migrated.prepare('SELECT round_id FROM orders').get().round_id).toBe('r');
      expect(migrated.prepare('PRAGMA foreign_key_check').all()).toHaveLength(0);
      migrated
        .prepare(
          'INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,snapshot,digest,payment_mode,test) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .run('r2', 'SB-extra', '2026-10-29', 5, 6, 7, 8, '[]', 'digest', 'individual', 1);
      expect(migrated.prepare('SELECT count(*) n FROM rounds').get().n).toBe(2);
      migrated.close();
    } finally {
      rmSync(legacyDir, { recursive: true, force: true });
    }
  });
  it('blocks overlapping manual rounds and allows separate windows on one day', async () => {
    const { createRound } = await import('../src/lib/server/orders');
    const at = Date.now();
    run(
      'INSERT INTO syncs VALUES (?,?,1,?,?,NULL)',
      randomUUID(),
      at,
      digest(products),
      JSON.stringify(products),
    );
    const future = '2099-10-29';
    const input = {
      day: future,
      invite: '11:45',
      close: '12:00',
      send: '12:05',
      arrival: '12:30',
      paymentMode: 'individual',
    };
    await createRound(input, 'test', false);
    await expect(createRound(input, 'test', false)).rejects.toThrow('overlappen');
    await createRound(
      { ...input, invite: '13:00', close: '13:15', send: '13:20', arrival: '13:45' },
      'test',
      false,
    );
    expect(all('SELECT * FROM rounds WHERE day=?', future)).toHaveLength(2);
  });
});

it('alerts the coordinator exactly once when final source validation blocks a round', async () => {
  const { settings } = await import('../src/lib/server/config');
  const { tick } = await import('../src/lib/server/scheduler');
  const s = settings();
  saveSettings(
    { ...s, weekdays: [], coordinator: 'test@example.invalid', smtp: { ...s.smtp, host: '' } },
    'test',
  );
  const id = employee(),
    r = round();
  run('UPDATE employees SET preferences=? WHERE id=?', '{"confirmations":false}', id);
  saveOrder(id, {
    roundId: r,
    revision: 0,
    declined: false,
    lines: [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
  });
  run('UPDATE rounds SET closes=0,sends=0 WHERE id=?', r);
  await tick();
  await tick();
  expect(one('SELECT status FROM rounds WHERE id=?', r).status).toBe('blocked');
  expect(all("SELECT * FROM outbox WHERE kind='alert' AND round_id=?", r)).toHaveLength(1);
});

it('prepares an automatic snapshot before the configured invitation time', async () => {
  const menu = await import('../src/lib/server/menu');
  const { tick } = await import('../src/lib/server/scheduler');
  const { settings } = await import('../src/lib/server/config');
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-30T10:20:00Z'));
  const s = settings();
  saveSettings({ ...s, weekdays: [1, 2, 3, 4, 5, 6, 7], smtp: { ...s.smtp, host: '' } }, 'test');
  const sync = vi.spyOn(menu, 'syncMenu').mockResolvedValue({ products, digest: digest(products) });
  try {
    await tick();
    expect(sync).toHaveBeenCalledTimes(1);
    expect(one('SELECT status,automatic FROM rounds')).toMatchObject({
      status: 'planned',
      automatic: 1,
    });
    expect(all('SELECT * FROM outbox')).toHaveLength(0);
  } finally {
    sync.mockRestore();
    vi.useRealTimers();
  }
});

it('requires exactly one actual source variant and prices optional extras in cents', () => {
  const options = parseOptions(readFileSync('tests/fixtures/options-237.html', 'utf8'), '237');
  const sundae = {
    id: '237',
    name: 'Sundae Normaal',
    category: 'Overige' as const,
    cents: 425,
    available: true,
    options,
  };
  const input = { productId: '237', optionIds: [], quantity: 2, note: '' };
  expect(() => priceLines([input], [sundae])).toThrow('verplichte');
  const choices = options.filter((o) => o.min === 1),
    extra = options.find((o) => !o.min)!;
  expect(choices).toHaveLength(8);
  expect(choices[0].cents).toBe(0);
  expect(() =>
    priceLines([{ ...input, optionIds: choices.slice(0, 2).map((o) => o.id) }], [sundae]),
  ).toThrow('Te veel');
  expect(priceLines([{ ...input, optionIds: [choices[0].id, extra.id] }], [sundae])[0].total).toBe(
    970,
  );
});

it('sends one arrival-only correction after explicit confirmation and never resends the order', () => {
  const r = round('sent');
  const base = roundTimes({
    day: '2099-10-29',
    invite: '11:45',
    close: '12:00',
    send: '12:05',
    arrival: '12:30',
    paymentMode: 'individual',
  });
  run(
    'UPDATE rounds SET day=?,opens=?,closes=?,sends=?,arrives=? WHERE id=?',
    '2099-10-29',
    base.opens,
    base.closes,
    base.sends,
    base.arrives,
    r,
  );
  const change = { close: '12:00', send: '12:05', arrival: '13:00', confirmCorrection: false };
  expect(() => updateTimes(r, change, 'test')).toThrow();
  updateTimes(r, { ...change, confirmCorrection: true }, 'test');
  updateTimes(r, { ...change, confirmCorrection: true }, 'test');
  const messages = all('SELECT kind,html FROM outbox WHERE round_id=?', r);
  expect(messages).toHaveLength(1);
  expect(messages[0].kind).toBe('correction');
  expect(decrypt(messages[0].html)).toContain('Alleen correctie aankomsttijd');
  expect(decrypt(messages[0].html)).not.toContain('Totaaloverzicht voor de keuken');
});

it('preserves repeated mandatory source groups as two independent sauce selections', () => {
  const options = parseOptions(readFileSync('tests/fixtures/options-263.html', 'utf8'), '263');
  const groups = [...new Set(options.map((o) => o.group))];
  expect(groups).toHaveLength(2);
  expect(new Set(options.map((o) => o.id)).size).toBe(options.length);
  const p = {
    id: '263',
    name: 'luxe mini snacks 4 pers.',
    category: 'Snacks' as const,
    cents: 1650,
    available: true,
    options,
  };
  const first = options.find((o) => o.group === groups[0])!,
    second = options.find((o) => o.group === groups[1])!;
  expect(() =>
    priceLines([{ productId: p.id, optionIds: [first.id], quantity: 1, note: '' }], [p]),
  ).toThrow('verplichte');
  const lines = priceLines(
    [{ productId: p.id, optionIds: [first.id, second.id], quantity: 1, note: '' }],
    [p],
  );
  expect(lines[0].optionIds).toHaveLength(2);
});

it('keeps queued test mail isolated after switching production settings', async () => {
  const { settings } = await import('../src/lib/server/config');
  enqueue({
    dedupe: 'mode-switch',
    to: 'test@example.invalid',
    subject: '[TEST]',
    html: 'test',
    kind: 'test',
  });
  const s = settings();
  saveSettings(
    {
      ...s,
      testMode: false,
      scrapingApproved: true,
      testRecipients: [],
      cafeteria: 'test@example.invalid',
      coordinator: 'coordinator@example.invalid',
    },
    'test',
  );
  const sender = vi.fn(async () => {});
  await processOutbox(sender);
  expect(sender).not.toHaveBeenCalled();
  expect(one('SELECT status,test FROM outbox')).toMatchObject({ status: 'failed', test: 1 });
});
it('blocks dispatch when source validation has used the remaining preparation time', () => {
  const id = employee(),
    r = round();
  run('UPDATE employees SET preferences=? WHERE id=?', '{"confirmations":false}', id);
  saveOrder(id, {
    roundId: r,
    revision: 0,
    declined: false,
    lines: [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
  });
  run("UPDATE rounds SET status='closed',sends=0,arrives=? WHERE id=?", Date.now() + 60000, r);
  queueValidatedRound(r, digest(products));
  expect(one('SELECT status FROM rounds').status).toBe('blocked');
  expect(all("SELECT * FROM outbox WHERE kind='order'")).toHaveLength(0);
});
it('rechecks preparation time immediately before SMTP and never requeues a blocked send', async () => {
  const id = employee(),
    r = round();
  run('UPDATE employees SET preferences=? WHERE id=?', '{"confirmations":false}', id);
  saveOrder(id, {
    roundId: r,
    revision: 0,
    declined: false,
    lines: [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
  });
  run("UPDATE rounds SET status='closed',sends=0 WHERE id=?", r);
  queueValidatedRound(r, digest(products));
  run('UPDATE rounds SET arrives=? WHERE id=?', Date.now() + 60000, r);
  const sender = vi.fn(async () => {});
  await processOutbox(sender);
  expect(sender).not.toHaveBeenCalled();
  expect(one('SELECT status FROM rounds').status).toBe('blocked');
  run('UPDATE rounds SET arrives=? WHERE id=?', Date.now() + 2400000, r);
  queueValidatedRound(r, digest(products));
  expect(one('SELECT status FROM rounds').status).toBe('blocked');
  expect(all('SELECT * FROM outbox')).toHaveLength(1);
});

it('still warns when an untrusted incoming reply leaves a round awaiting review', async () => {
  const { settings } = await import('../src/lib/server/config');
  const { tick } = await import('../src/lib/server/scheduler');
  const s = settings();
  saveSettings(
    { ...s, weekdays: [], coordinator: 'test@example.invalid', smtp: { ...s.smtp, host: '' } },
    'test',
  );
  const r = round('review');
  run('UPDATE rounds SET sent=? WHERE id=?', Date.now() - 20 * 60000, r);
  await tick();
  expect(all("SELECT * FROM outbox WHERE round_id=? AND kind='alert'", r)).toHaveLength(1);
});
