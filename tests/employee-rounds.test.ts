import { it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { roundWindowStatus } from '../src/lib/round-window';
import { roundDay, time } from '../src/lib/client';
const directory = mkdtempSync(resolve(tmpdir(), 'smikkel-employee-rounds-'));
process.env.DATA_DIR = directory;
const { db, one, run } = await import('../src/lib/server/db');
const { hash } = await import('../src/lib/server/crypto');
const { employeeRounds, invitationStatus } = await import('../src/lib/server/employee-rounds');
const { GET, POST } = await import('../src/routes/api/[...path]/+server');
const baseline = new Date('2026-10-30T10:44:00Z').getTime();
const normal = {
  confirmations: false,
  participation: 'normal',
  from: '',
  until: '',
  skipRound: '',
};
const product = {
  id: '85',
  name: 'Patat',
  category: 'Patat',
  cents: 290,
  available: true,
  options: [],
};
function employee(name = 'Beer') {
  const id = randomUUID(),
    token = randomUUID();
  run(
    'INSERT INTO employees(id,name,name_key,email,preferences,created) VALUES (?,?,?,?,?,?)',
    id,
    name,
    name.toLowerCase(),
    id + '@example.invalid',
    JSON.stringify(normal),
    Date.now(),
  );
  run("INSERT INTO sessions VALUES (?,'employee',?,?)", hash(token), id, Date.now() + 3600000);
  return { id, token };
}
function round(offset = 60000, status = 'planned') {
  const id = randomUUID(),
    opens = baseline + offset,
    closes = opens + 15 * 60000;
  const snapshot = JSON.stringify([product]);
  run(
    "INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,status,snapshot,digest,payment_mode,test,issue) VALUES (?,?,?,?,?,?,?,?,?,?,'individual',1,'internal-only')",
    id,
    'SB-' + id,
    DateTime.fromMillis(opens, { zone: 'Europe/Amsterdam' }).toISODate(),
    opens,
    closes,
    closes + 300000,
    closes + 1800000,
    status,
    snapshot,
    hash(snapshot),
  );
  return { id, opens, closes };
}
function event(path: string, token?: string, data: unknown = {}): any {
  const url = new URL('http://localhost/api/' + path);
  return {
    params: { path: path.split('?')[0] },
    url,
    request: new Request(url, {
      method: 'POST',
      headers: { origin: url.origin, 'content-type': 'application/json' },
      body: JSON.stringify(data),
    }),
    cookies: { get: (key: string) => (key === 'sb_employee' ? token : undefined) },
    getClientAddress: () => '127.0.0.1',
  };
}
const order = (id: string, revision = 0) => ({
  roundId: id,
  revision,
  declined: false,
  lines: [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(baseline);
  db.exec(
    'DELETE FROM round_creation_requests; DELETE FROM menu_sync_jobs; DELETE FROM outbox; DELETE FROM inbox; DELETE FROM orders; DELETE FROM rounds; DELETE FROM sessions; DELETE FROM favorites; DELETE FROM tokens; DELETE FROM employees; DELETE FROM audit;',
  );
});
afterEach(() => vi.useRealTimers());
afterAll(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
it('shows planned rounds in opening order, without snapshots, products, internal diagnostics or other people', async () => {
  const e = employee(),
    other = employee('Vos');
  const late = round(120000),
    first = round(),
    cancelled = round(30000, 'cancelled');
  const state = await (await GET(event('employee', e.token))).json();
  expect(state.round).toBeNull();
  expect(state.timeline.upcoming.map((r: any) => r.id)).toEqual([first.id, late.id]);
  expect(state.timeline.upcoming[0]).toMatchObject({
    windowStatus: 'upcoming',
    test: 1,
    opens: first.opens,
  });
  const thin = await (await GET(event('employee/rounds?employeeId=' + other.id, e.token))).json();
  expect(thin.upcoming.map((r: any) => r.id)).toEqual([first.id, late.id]);
  expect(JSON.stringify(thin)).not.toMatch(
    /snapshot|products|digest|payment_link|internal-only|example.invalid/,
  );
  expect(JSON.stringify(thin)).not.toContain(cancelled.id);
  expect(state.profile.id).toBe(e.id);
});
it('rejects all early ordering and opens exactly on time without waiting for a scheduler tick', async () => {
  const e = employee(),
    r = round();
  await expect(POST(event('order', e.token, order(r.id)))).rejects.toMatchObject({ status: 409 });
  vi.setSystemTime(r.opens - 1);
  expect(employeeRounds(e.id).active).toBeNull();
  await expect(POST(event('order', e.token, order(r.id)))).rejects.toMatchObject({ status: 409 });
  vi.setSystemTime(r.opens);
  const state = await (await GET(event('employee', e.token))).json();
  expect(state.round.id).toBe(r.id);
  expect(state.round.products).toEqual([product]);
  expect(state.timeline.active.windowStatus).toBe('open');
  expect((await POST(event('order', e.token, order(r.id)))).status).toBe(200);
  expect(one('SELECT status FROM rounds WHERE id=?', r.id).status).toBe('planned');
});
it('closes exactly at the deadline, keeps only the employee’s own summary and shows the next planned round', async () => {
  const e = employee(),
    other = employee('Vos'),
    r = round(-60000, 'open'),
    next = round(3600000);
  expect((await POST(event('order', e.token, order(r.id)))).status).toBe(200);
  const alien = {
    ...order(r.id),
    lines: [{ ...order(r.id).lines[0], note: 'private-other-order' }],
  };
  await POST(event('order', other.token, alien));
  vi.setSystemTime(r.closes - 1);
  expect((await POST(event('order', e.token, order(r.id, 1)))).status).toBe(200);
  vi.setSystemTime(r.closes);
  await expect(POST(event('order', e.token, order(r.id, 2)))).rejects.toMatchObject({
    status: 409,
  });
  const state = await (await GET(event('employee', e.token))).json();
  expect(state.round).toBeNull();
  expect(state.timeline.recent.round.windowStatus).toBe('closed');
  expect(state.timeline.recent.order.total).toBe(290);
  expect(state.timeline.upcoming[0].id).toBe(next.id);
  expect(JSON.stringify(state)).not.toContain('private-other-order');
  expect(state.history).toHaveLength(1);
});
it.each(['cancelled', 'blocked', 'closed', 'queued', 'sent', 'unknown', 'completed'])(
  'never opens a %s round, even inside its calendar window',
  async (status) => {
    const e = employee(),
      r = round(-1000, status);
    expect(employeeRounds(e.id).active).toBeNull();
    await expect(POST(event('order', e.token, order(r.id)))).rejects.toMatchObject({ status: 409 });
  },
);
it.each([
  [{ ...normal, participation: 'paused' }, 'paused'],
  [{ ...normal, participation: 'away', from: '2026-10-30', until: '2026-10-30' }, 'away'],
  [{ ...normal, participation: 'away', from: '2026-10-01', until: '2026-10-29' }, 'normal'],
])('explains participation %j without changing preferences', async (preferences, code) => {
  const e = employee(),
    r = round();
  run('UPDATE employees SET preferences=? WHERE id=?', JSON.stringify(preferences), e.id);
  expect(employeeRounds(e.id).upcoming[0]!.participation.code).toBe(code);
  expect(one('SELECT preferences FROM employees WHERE id=?', e.id).preferences).toBe(
    JSON.stringify(preferences),
  );
  expect(
    invitationStatus({ ...normal, skipRound: r.id }, { id: r.id, day: '2026-10-30' }).code,
  ).toBe('skipped');
});
it('allows an explicit order while invitations are paused, without changing the stored choice', async () => {
  const e = employee(),
    r = round(-1000);
  const preferences = { ...normal, participation: 'paused' };
  run('UPDATE employees SET preferences=? WHERE id=?', JSON.stringify(preferences), e.id);
  expect((await POST(event('order', e.token, order(r.id)))).status).toBe(200);
  expect(JSON.parse(one('SELECT preferences FROM employees WHERE id=?', e.id).preferences)).toEqual(
    preferences,
  );
});
it('returns an empty state and no round details without an active employee session', async () => {
  const e = employee();
  expect(employeeRounds(e.id)).toMatchObject({ active: null, upcoming: [], recent: null });
  round();
  await expect(GET(event('employee/rounds'))).rejects.toMatchObject({ status: 401 });
  run('UPDATE employees SET active=0 WHERE id=?', e.id);
  await expect(GET(event('employee/rounds', e.token))).rejects.toMatchObject({ status: 401 });
});
it.each([
  ['2026-03-29T01:15:00Z', '03:15', 'zondag 29 maart 2026'],
  ['2026-10-25T00:15:00Z', '02:15', 'zondag 25 oktober 2026'],
  ['2026-10-25T01:15:00Z', '02:15', 'zondag 25 oktober 2026'],
  ['2026-10-29T23:15:00Z', '00:15', 'vrijdag 30 oktober 2026'],
])('uses Amsterdam calendar dates and absolute boundaries for %s', (iso, clock, day) => {
  const opens = new Date(iso).getTime();
  const r = { status: 'planned', opens, closes: opens + 60000 };
  expect(roundWindowStatus(r, opens - 1)).toBe('upcoming');
  expect(roundWindowStatus(r, opens)).toBe('open');
  expect(roundWindowStatus(r, opens + 60000)).toBe('closed');
  expect(time(opens)).toBe(clock);
  expect(roundDay(opens)).toBe(day);
});
