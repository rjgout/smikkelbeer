import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { adminLogin } from './helpers';
const origin = 'http://127.0.0.1:4173';
const input = {
  day: '2099-10-29',
  invite: '11:45',
  close: '12:00',
  send: '12:05',
  arrival: '12:30',
  paymentMode: 'individual',
};
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
async function form(page: Page) {
  await page.getByRole('button', { name: 'Bestelrondes', exact: true }).click();
  await page.getByLabel('Datum', { exact: true }).fill(input.day);
}
async function approve(page: Page) {
  const { settings } = await (await page.request.get('/api/admin')).json();
  const response = await page.request.post('/api/settings', {
    headers: { origin },
    data: { ...settings, weekdays: [], scrapingApproved: true },
  });
  expect(response.ok()).toBe(true);
}
function freshMenu() {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  const snapshot = JSON.stringify([
    { id: '85', name: 'Patat', category: 'Patat', cents: 290, available: true, options: [] },
  ]);
  db.prepare('INSERT INTO syncs VALUES (?,?,1,?,?,NULL)').run(
    randomUUID(),
    Date.now(),
    createHash('sha256').update(snapshot).digest('hex'),
    snapshot,
  );
  db.close();
}
test('uses an ISO date even with slash-separated en-CA output and creates a fresh round once after a lost 524 response', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Object.getOwnPropertyDescriptor(Intl.DateTimeFormat.prototype, 'format')!;
    Object.defineProperty(Intl.DateTimeFormat.prototype, 'format', {
      configurable: true,
      get() {
        return this.resolvedOptions().locale === 'en-CA'
          ? () => '10/29/2026'
          : original.get!.call(this);
      },
    });
  });
  await adminLogin(page);
  await approve(page);
  freshMenu();
  await page.getByRole('button', { name: 'Bestelrondes', exact: true }).click();
  const expected = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat('nl-NL', {
      timeZone: 'Europe/Amsterdam',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts();
    const field = (t: string) => parts.find((p) => p.type === t)!.value;
    return `${field('year')}-${field('month')}-${field('day')}`;
  });
  await expect(page.getByLabel('Datum', { exact: true })).toHaveValue(expected);
  await page.getByLabel('Datum', { exact: true }).fill(input.day);
  let starts = 0;
  await page.route('**/api/rounds/create', async (route) => {
    starts++;
    const response = await route.fetch();
    expect(response.status()).toBe(starts === 1 ? 201 : 200);
    await route.fulfill({
      status: 524,
      contentType: 'text/html',
      headers: { 'cf-ray': 'round-start-AMS' },
      body: '<html>private-proxy-content</html>',
    });
  });
  await page.getByRole('button', { name: 'Ronde aanmaken', exact: true }).dblclick();
  await expect(
    page.getByRole('status').filter({ hasText: 'De ronde is aangemaakt' }),
  ).toBeVisible();
  await expect(page.locator('body')).not.toContainText('private-proxy-content');
  await page.getByRole('button', { name: 'Ronde aanmaken', exact: true }).click();
  await expect.poll(() => starts).toBe(2);
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  expect(db.prepare('SELECT count(*) n FROM rounds').get()!.n).toBe(1);
  expect(db.prepare('SELECT count(*) n FROM menu_sync_jobs').get()!.n).toBe(0);
  expect(db.prepare('SELECT count(*) n FROM round_creation_requests').get()!.n).toBe(1);
  db.close();
  await page.reload();
  await form(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'De ronde is aangemaakt' }),
  ).toBeVisible();
  expect(starts).toBe(2);
});
test('tracks stale-menu creation beyond the proxy window and reload, rejecting repeated clicks while work continues', async ({
  page,
}) => {
  await adminLogin(page);
  let current: any = null,
    starts = 0,
    requestId = '';
  await page.route('**/api/admin', async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    data.syncStatus = { job: current, lastSuccess: null, nextAllowedAt: 0 };
    await route.fulfill({ json: data });
  });
  await page.route('**/api/rounds/create', async (route) => {
    starts++;
    requestId = route.request().postDataJSON().requestId;
    current = {
      id: randomUUID(),
      purpose: 'round.create',
      status: 'running',
      phase: 'options',
      processed: 0,
      total: 213,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      startedAt: Date.now(),
      finishedAt: null,
      currentProductId: null,
      resultRoundId: null,
      syncId: null,
      error: null,
    };
    await route.fulfill({ status: 202, json: { requestId, roundId: null, job: current } });
  });
  await page.route('**/api/rounds/create/status*', (route) =>
    route.fulfill({ json: { requestId, roundId: current?.resultRoundId || null, job: current } }),
  );
  await page.route('**/api/menu/sync/status*', (route) =>
    route.fulfill({ json: { job: current, lastSuccess: null, nextAllowedAt: 0 } }),
  );
  await page.reload();
  await form(page);
  await page.clock.install();
  await page.getByRole('button', { name: 'Ronde aanmaken', exact: true }).dblclick();
  await expect(
    page.getByRole('button', { name: 'Broncontrole loopt…', exact: true }),
  ).toBeDisabled();
  expect(starts).toBe(1);
  current.processed = 130;
  await page.clock.fastForward(130000);
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '130');
  await page.reload();
  await form(page);
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '130');
  expect(starts).toBe(1);
  current = {
    ...current,
    status: 'succeeded',
    phase: 'complete',
    processed: 213,
    resultRoundId: randomUUID(),
  };
  await page.getByRole('button', { name: 'Status opnieuw ophalen' }).click();
  await expect(page.getByRole('button', { name: 'Ronde aanmaken', exact: true })).toBeEnabled();
  expect(starts).toBe(1);
});
test('shows Dutch validation errors and cannot create from an invalid or ambiguous date', async ({
  page,
}) => {
  await adminLogin(page);
  await approve(page);
  freshMenu();
  await form(page);
  const bad = await page.request.post('/api/rounds/create', {
    headers: { origin },
    data: { ...input, day: '10/29/2099', requestId: randomUUID() },
  });
  expect(bad.status()).toBe(400);
  expect((await bad.json()).message).toContain('datum');
  await page.getByLabel('Verzenden', { exact: true }).fill('12:29');
  await page.getByRole('button', { name: 'Ronde aanmaken', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'voorbereidingstijd' })).toBeVisible();
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  expect(db.prepare('SELECT count(*) n FROM rounds').get()!.n).toBe(0);
  db.close();
});
