import { test, expect, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { adminLogin } from './helpers';
const root = 'http://127.0.0.1:4173';
test.beforeEach(() => {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  db.exec('DELETE FROM rate_limits');
  db.close();
});
function job() {
  const now = Date.now();
  return {
    id: randomUUID(),
    status: 'queued',
    phase: 'queued',
    purpose: 'menu',
    processed: 0,
    total: 213,
    currentProductId: null,
    createdAt: now,
    startedAt: null,
    updatedAt: now,
    finishedAt: null,
    error: null,
    syncId: null,
    resultRoundId: null,
  };
}
async function mockJob(page: Page, initial: any = null) {
  let current = initial;
  let starts = 0;
  let polls = 0;
  let failStatus = false;
  let failStart = false;
  await page.route('**/api/admin', async (route) => {
    const response = await route.fetch();
    if (!response.ok()) return route.fulfill({ response });
    const data = await response.json();
    data.syncStatus = { job: current, lastSuccess: null, nextAllowedAt: 0 };
    await route.fulfill({ json: data });
  });
  await page.route('**/api/menu/sync', async (route) => {
    starts++;
    current = current || job();
    if (failStart)
      return route.fulfill({
        status: 524,
        contentType: 'text/html',
        headers: { 'cf-ray': 'test-start-AMS' },
        body: '<html>Cloudflare timeout private-error</html>',
      });
    return route.fulfill({ status: 202, json: { job: current, reused: false } });
  });
  await page.route('**/api/menu/sync/status*', async (route) => {
    polls++;
    if (failStatus)
      return route.fulfill({
        status: 524,
        contentType: 'text/html',
        headers: { 'cf-ray': 'test-poll-AMS' },
        body: '<html>private-error</html>',
      });
    return route.fulfill({
      json: {
        job: current,
        lastSuccess:
          current?.status === 'succeeded' ? { id: current.syncId, at: Date.now() } : null,
        nextAllowedAt: 0,
      },
    });
  });
  return {
    get current() {
      return current;
    },
    get starts() {
      return starts;
    },
    get polls() {
      return polls;
    },
    set current(value: any) {
      current = value;
    },
    set failStatus(value: boolean) {
      failStatus = value;
    },
    set failStart(value: boolean) {
      failStart = value;
    },
  };
}
test('follows a long-running sync beyond a Cloudflare timeout, survives reload and does not start twice', async ({
  page,
}) => {
  await adminLogin(page);
  const state = await mockJob(page);
  await page.reload();
  await page.clock.install();
  await page.getByRole('button', { name: 'Menukaart', exact: true }).click();
  await page.getByRole('button', { name: 'Menukaart synchroniseren', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Synchronisatie loopt…', exact: true }),
  ).toBeDisabled();
  expect(state.starts).toBe(1);
  state.current = {
    ...state.current,
    status: 'running',
    phase: 'options',
    processed: 80,
    startedAt: Date.now(),
  };
  await page.clock.fastForward(130000);
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '80');
  await page.reload();
  await page.getByRole('button', { name: 'Menukaart', exact: true }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '80');
  expect(state.starts).toBe(1);
  state.current = {
    ...state.current,
    status: 'succeeded',
    phase: 'complete',
    processed: 213,
    finishedAt: Date.now(),
    syncId: randomUUID(),
  };
  await page.getByRole('button', { name: 'Status opnieuw ophalen' }).click();
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '213');
  await expect(
    page.getByRole('button', { name: 'Menukaart synchroniseren', exact: true }),
  ).toBeEnabled();
  expect(state.starts).toBe(1);
});
test('shows a Dutch Cloudflare diagnostic, recovers polling and retains the actual server task', async ({
  page,
}) => {
  await adminLogin(page);
  const current = { ...job(), status: 'running', phase: 'options', processed: 99 };
  const state = await mockJob(page, current);
  await page.reload();
  await page.getByRole('button', { name: 'Menukaart', exact: true }).click();
  state.failStatus = true;
  await page.getByRole('button', { name: 'Status opnieuw ophalen' }).click();
  await expect(page.locator('.sync-progress')).toContainText('HTTP 524');
  await expect(page.locator('.sync-progress')).toContainText('test-poll-AMS');
  await expect(page.locator('.sync-progress')).not.toContainText('private-error');
  state.failStatus = false;
  await page.getByRole('button', { name: 'Status opnieuw ophalen' }).click();
  await expect(page.locator('.sync-progress')).not.toContainText('HTTP 524');
  await expect(page.getByRole('progressbar')).toHaveAttribute('value', '99');
  expect(state.starts).toBe(0);
});
test('recovers an accepted task when the start response is replaced by a Cloudflare error', async ({
  page,
}) => {
  await adminLogin(page);
  const state = await mockJob(page);
  await page.reload();
  await page.getByRole('button', { name: 'Menukaart', exact: true }).click();
  state.failStart = true;
  await page.getByRole('button', { name: 'Menukaart synchroniseren', exact: true }).click();
  await expect(page.locator('.sync-progress')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Synchronisatie loopt…', exact: true }),
  ).toBeDisabled();
  expect(state.starts).toBe(1);
  expect(state.polls).toBeGreaterThan(0);
});
test('displays persistent interruption diagnostics after restart and protects the real status API', async ({
  page,
}) => {
  await adminLogin(page);
  const state = await mockJob(page, {
    ...job(),
    status: 'interrupted',
    phase: 'options',
    processed: 101,
    finishedAt: Date.now(),
    error: {
      code: 'PROCESS_INTERRUPTED',
      message: 'De synchronisatie is onderbroken door een herstart. Start na de wachttijd opnieuw.',
      productId: '85',
    },
  });
  await page.reload();
  await page.getByRole('button', { name: 'Menukaart', exact: true }).click();
  await expect(page.locator('.sync-progress')).toContainText('PROCESS_INTERRUPTED');
  await expect(page.locator('.sync-progress')).toContainText('101 van 213');
  expect(state.starts).toBe(0);
  await page.unroute('**/api/menu/sync/status*');
  const status = await page.request.get('/api/menu/sync/status');
  expect(status.status()).toBe(200);
  await page.request.post('/api/logout', { headers: { origin: root }, data: { kind: 'admin' } });
  expect((await page.request.get('/api/menu/sync/status')).status()).toBe(401);
});
