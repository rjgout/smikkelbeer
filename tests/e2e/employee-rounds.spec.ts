import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { seed, employeeLogin } from './helpers';
const origin = 'http://127.0.0.1:4173';
function edit(sql: string, ...params: any[]) {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  try {
    return db.prepare(sql).run(...params);
  } finally {
    db.close();
  }
}
test.beforeEach(() => {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  for (const table of [
    'round_creation_requests',
    'menu_sync_jobs',
    'outbox',
    'inbox',
    'orders',
    'rounds',
    'syncs',
    'rate_limits',
  ])
    db.exec('DELETE FROM ' + table);
  db.close();
});
function planned() {
  const s = seed(),
    now = Date.now();
  edit(
    "UPDATE rounds SET status='planned',opens=?,closes=?,sends=?,arrives=? WHERE id=?",
    now + 60000,
    now + 120000,
    now + 180000,
    now + 1800000,
    s.roundId,
  );
  return s;
}
function another(sourceId: string, offset: number, status = 'planned') {
  const id = randomUUID(),
    now = Date.now();
  edit(
    "INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,status,snapshot,digest,payment_mode,test) SELECT ?,?,'2099-11-01',?,?,?,?,?,snapshot,digest,payment_mode,test FROM rounds WHERE id=?",
    id,
    'SB-' + id,
    now + offset,
    now + offset + 60000,
    now + offset + 120000,
    now + offset + 1800000,
    status,
    sourceId,
  );
  return id;
}
test('shows the next planned round in order, its times, test identity and a disabled order button', async ({
  page,
  request,
}) => {
  const s = planned();
  const late = another(s.roundId, 3600000);
  const cancelled = another(s.roundId, 30000, 'cancelled');
  await employeeLogin(page, s.token);
  const card = page.getByRole('region', { name: 'Bestelronde', exact: true });
  await expect(card).toContainText('Binnenkort');
  await expect(card).toContainText('Nog niet geopend');
  await expect(card).toContainText('Bestellen vanaf');
  await expect(card).toContainText('Bestellen tot');
  await expect(card).toContainText('Eten verwacht om');
  await expect(card).toContainText('Testronde');
  await expect(page.getByRole('button', { name: /Bestellen vanaf/ })).toBeDisabled();
  await expect(page.locator('.product-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Bestelling bevestigen/ })).toHaveCount(0);
  const api = await (await page.request.get('/api/employee/rounds')).json();
  expect(api.upcoming.map((r: any) => r.id)).toEqual([s.roundId, late]);
  expect(JSON.stringify(api)).not.toContain(cancelled);
  expect(JSON.stringify(api)).not.toMatch(/snapshot|products|digest|example.invalid/);
  const early = await page.request.post('/api/order', {
    headers: { origin },
    data: { roundId: s.roundId, revision: 0, declined: true, lines: [] },
  });
  expect(early.status()).toBe(409);
  expect((await request.get('/api/employee/rounds')).status()).toBe(401);
  expect((await page.request.get('/api/round/' + s.roundId)).status()).toBe(401);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'artifacts/planned-round-' + page.viewportSize()!.width + '.png',
    fullPage: true,
  });
});
test('opens automatically, preserves an unsaved basket during polling and locks immediately on closure while status is slow', async ({
  page,
}) => {
  const s = planned();
  edit('INSERT INTO favorites(employee_id,product_id) VALUES (?,?)', s.id, '85');
  await page.clock.install();
  await employeeLogin(page, s.token);
  await expect(page.getByRole('button', { name: /Bestellen vanaf/ })).toBeDisabled();
  // Move the actual DB window into its open phase; persisted status deliberately remains planned.
  edit(
    'UPDATE rounds SET opens=?,closes=?,sends=?,arrives=? WHERE id=?',
    Date.now() - 1000,
    Date.now() + 120000,
    Date.now() + 180000,
    Date.now() + 1800000,
    s.roundId,
  );
  await page.clock.fastForward(60000);
  await expect(page.locator('.order-layout')).toBeVisible();
  await expect(page.getByRole('tab', { name: /Snacks/ })).toBeVisible();
  await expect(page.locator('.favorite-card')).toHaveCount(1);
  await page
    .locator('.product-row')
    .filter({ has: page.getByRole('heading', { name: 'Patat', exact: true }) })
    .getByRole('button', { name: 'Patat toevoegen', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Toevoegen/ })
    .click();
  await page.clock.fastForward(30000);
  await expect(page.locator('.cart-item')).toHaveCount(1);
  await page.getByRole('button', { name: 'Bestelling bevestigen' }).click();
  await expect(page.locator('.saved-note')).toContainText('opgeslagen');
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/employee/rounds', async (route) => {
    await held;
    await route.continue();
  });
  edit(
    'UPDATE rounds SET closes=?,sends=? WHERE id=?',
    Date.now() - 1,
    Date.now() + 60000,
    s.roundId,
  );
  another(s.roundId, 3600000);
  await page.clock.fastForward(125000);
  await expect(page.locator('.order-layout')).toHaveCount(0);
  const stale = await page.request.post('/api/order', {
    headers: { origin },
    data: { roundId: s.roundId, revision: 1, declined: true, lines: [] },
  });
  expect(stale.status()).toBe(409);
  release();
  await page.unrouteAll({ behavior: 'wait' });
  // Resume triggers one fresh status read after the intentionally held/expired request.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.closed-order')).toContainText('1 × Patat');
  await expect(page.locator('.closed-order')).toContainText('wijzigen is niet meer mogelijk');
  await expect(page.locator('.employee-round-card')).toContainText('Binnenkort');
});
test('refreshes cancellation and shows a friendly empty state without revealing a menu', async ({
  page,
}) => {
  const s = planned();
  await page.clock.install();
  await employeeLogin(page, s.token);
  edit("UPDATE rounds SET status='cancelled' WHERE id=?", s.roundId);
  await page.clock.fastForward(30000);
  await expect(
    page.getByRole('heading', { name: 'Nog geen volgende smikkelronde gepland' }),
  ).toBeVisible();
  await expect(page.locator('.employee-round-card')).toHaveCount(0);
  await expect(page.locator('.product-row')).toHaveCount(0);
});
for (const [mode, message] of [
  ['paused', 'Je uitnodigingen zijn gepauzeerd'],
  ['away', 'als afwezig geregistreerd'],
  ['skipped', 'Je slaat de uitnodigingen voor deze ronde over'],
])
  test(`explains ${mode} participation without altering stored preferences`, async ({ page }) => {
    const s = planned();
    const preferences = {
      confirmations: false,
      participation: mode === 'skipped' ? 'normal' : mode,
      from: '2000-01-01',
      until: '2099-12-31',
      skipRound: mode === 'skipped' ? s.roundId : '',
    };
    edit('UPDATE employees SET preferences=? WHERE id=?', JSON.stringify(preferences), s.id);
    await employeeLogin(page, s.token);
    await expect(page.locator('.participation-note')).toContainText(message);
    const data = await (await page.request.get('/api/employee')).json();
    expect(data.profile.preferences).toEqual(preferences);
    await page.getByRole('button', { name: 'Mijn profiel', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Deze ronde geen uitnodigingen meer' }),
    ).toHaveCount(1);
  });

test('pauses hidden-tab polling, refreshes on return and preserves unsaved profile fields', async ({
  page,
}) => {
  const s = planned();
  await page.clock.install();
  await employeeLogin(page, s.token);
  await page.getByRole('button', { name: 'Mijn profiel', exact: true }).click();
  await page.getByLabel('Voornaam', { exact: true }).fill('BeerLokaal');
  let polls = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/employee/rounds')) polls++;
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const before = polls;
  await page.clock.fastForward(120000);
  expect(polls).toBe(before);
  edit(
    'UPDATE rounds SET opens=?,closes=?,sends=?,arrives=? WHERE id=?',
    Date.now() - 1000,
    Date.now() + 60000,
    Date.now() + 120000,
    Date.now() + 1800000,
    s.roundId,
  );
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => polls).toBeGreaterThan(before);
  await expect(page.getByLabel('Voornaam', { exact: true })).toHaveValue('BeerLokaal');
  await page.getByRole('button', { name: 'Menukaart', exact: true }).click();
  await expect(page.locator('.order-layout')).toBeVisible();
});

test('does not miss an opening when the initial response arrives after its scheduled boundary', async ({
  page,
}) => {
  const s = planned();
  edit('UPDATE rounds SET opens=? WHERE id=?', Date.now() + 5000, s.roundId);
  await page.clock.install();
  let reached!: () => void, release!: () => void;
  const fetched = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route('**/api/employee', async (route) => {
    if (!first) return route.continue();
    first = false;
    const response = await route.fetch();
    const data = await response.json();
    expect(data.timeline.upcoming[0].id).toBe(s.roundId);
    reached();
    await held;
    await route.fulfill({ json: data });
  });
  const login = employeeLogin(page, s.token);
  await fetched;
  edit('UPDATE rounds SET opens=? WHERE id=?', Date.now() - 1000, s.roundId);
  await page.clock.fastForward(6000);
  release();
  await login;
  await page.clock.fastForward(1000);
  await expect(page.locator('.order-layout')).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });
});
