import { test, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, createCipheriv, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TOTP, Secret } from 'otpauth';
import { load } from 'cheerio';
const root = 'http://127.0.0.1:4173';
function seed() {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  db.exec('PRAGMA busy_timeout=5000');
  const id = randomUUID(),
    token = randomBytes(32).toString('base64url'),
    hash = (s: string) => createHash('sha256').update(s).digest('hex');
  db.prepare(
    'INSERT INTO employees(id,name,name_key,email,preferences,created) VALUES (?,?,?,?,?,?)',
  ).run(
    id,
    'Beer-' + id.replaceAll(/[^a-z]/g, '').slice(0, 10),
    'beer-' + id,
    id + '@example.invalid',
    '{"confirmations":false,"participation":"normal","from":"","until":"","skipRound":""}',
    Date.now(),
  );
  db.prepare("INSERT INTO tokens VALUES (?,?,'login',NULL,?,NULL)").run(
    hash(token),
    id,
    Date.now() + 900000,
  );
  let round = db
    .prepare("SELECT id FROM rounds WHERE status='open' AND closes>?")
    .get(Date.now()) as any;
  if (!round) {
    const $ = load(readFileSync('tests/fixtures/menu.html', 'utf8'));
    const products: any[] = [];
    $('.dish').each((_, el) => {
      const p = $(el);
      products.push({
        id: p.attr('data-productid'),
        name: p.attr('data-productnaam')?.trim(),
        category: /patat/i.test(p.attr('data-productcategorie') || '')
          ? 'Patat'
          : /snack/i.test(p.attr('data-productcategorie') || '')
            ? 'Snacks'
            : 'Overige',
        cents: Math.round(Number(p.attr('data-prijs')) * 100),
        available: true,
        options: [],
      });
    });
    products.push(JSON.parse(readFileSync('tests/fixtures/sundae.json', 'utf8')));
    const snapshot = JSON.stringify(products);
    round = { id: randomUUID() };
    db.prepare(
      "INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,status,snapshot,digest,payment_mode,test) VALUES (?,?,?,?,?,?,?,'open',?,?,'individual',1)",
    ).run(
      round.id,
      'SB-E2E',
      '2026-10-29',
      Date.now() - 1000,
      Date.now() + 3600000,
      Date.now() + 3660000,
      Date.now() + 5460000,
      snapshot,
      hash(snapshot),
    );
  }
  db.close();
  return { id, token, roundId: round.id };
}
function seedAdmin(role = 'admin') {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  db.exec('PRAGMA busy_timeout=5000');
  const id = randomUUID(),
    email = id + '@example.invalid',
    password = 'example-password-long',
    salt = randomBytes(16).toString('hex'),
    secret = new Secret({ size: 20 });
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', readFileSync('.e2e-data/master.key'), iv);
  const body = Buffer.concat([cipher.update(secret.base32, 'utf8'), cipher.final()]);
  const encrypted = [iv, cipher.getAuthTag(), body].map((v) => v.toString('base64url')).join('.');
  db.prepare('INSERT INTO admins(id,email,password,totp,role_id) VALUES (?,?,?,?,?)').run(
    id,
    email,
    salt +
      ':' +
      scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString(
        'hex',
      ),
    encrypted,
    role,
  );
  db.close();
  return {
    email,
    password,
    code: new TOTP({ issuer: 'Smikkelbeer', label: 'Beheer', secret }).generate(),
  };
}
async function employeeLogin(page: any, token: string) {
  await page.goto('/login#' + token);
  await page.getByRole('button', { name: 'Bevestigen en doorgaan' }).click();
  await expect(page.getByRole('heading', { name: /Hoi Beer/ })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/employee-' + page.viewportSize().width + '.png',
    fullPage: true,
  });
}
async function adminLogin(page: any, role = 'admin') {
  const a = seedAdmin(role);
  await page.goto('/admin');
  await page.getByLabel('E-mailadres', { exact: true }).fill(a.email);
  await page.getByLabel('Wachtwoord', { exact: true }).fill(a.password);
  await page.getByLabel('Authenticatorcode').fill(a.code);
  await page.getByRole('button', { name: 'Veilig inloggen' }).click();
  await expect(page.getByRole('heading', { name: 'Overzicht', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/admin-' + page.viewportSize().width + '.png',
    fullPage: true,
  });
}
test('public website and neutral request response', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Goed werk verdient/ })).toBeVisible();
  await page.getByLabel('Je e-mailadres').fill(randomUUID() + '@example.invalid');
  await page.getByRole('button', { name: /Stuur mij/ }).click();
  await expect(page.getByRole('status')).toContainText('Als dit adres geregistreerd is');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('scanner GET and CSRF attempts do not consume a one-time token', async ({ page, request }) => {
  const s = seed();
  const r = await request.get('/login#' + s.token);
  expect(r.status()).toBe(200);
  expect(r.headers()['referrer-policy']).toBe('no-referrer');
  expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
  const denied = await request.post('/api/link/consume', { data: { token: s.token } });
  expect(denied.status()).toBe(403);
  await employeeLogin(page, s.token);
  const replay = await page.request.post('/api/link/consume', {
    headers: { origin: root },
    data: { token: s.token },
  });
  expect(replay.status()).toBe(400);
  expect(page.url()).not.toContain(s.token);
});
test('favorites, category search, basket, confirmation, changes and profile', async ({ page }) => {
  const s = seed();
  await employeeLogin(page, s.token);
  await page.getByRole('button', { name: 'Bewaar Patat als favoriet', exact: true }).click();
  await expect(page.locator('.favorite-card')).toHaveCount(1);
  await page.getByRole('tab', { name: /Snacks/ }).click();
  await page.getByRole('searchbox').fill('geen-resultaat');
  await expect(page.locator('.favorite-card')).toHaveCount(1);
  await expect(page.locator('.product-row')).toHaveCount(0);
  await page.getByRole('tab', { name: /Patat/ }).click();
  await page
    .locator('.product-row')
    .filter({ has: page.getByRole('heading', { name: 'Patat', exact: true }) })
    .getByRole('button', { name: 'Patat toevoegen', exact: true })
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Toevoegen/ })
    .click();
  await page.getByRole('button', { name: 'Bestelling bevestigen' }).click();
  await expect(page.getByRole('status')).toContainText('bevestigd');
  await expect(page.locator('.saved-note')).toContainText('opgeslagen');
  await page.getByRole('button', { name: 'Meer', exact: true }).click();
  await page.getByRole('button', { name: 'Bestelling bijwerken' }).click();
  await expect(page.getByRole('status')).toContainText('bevestigd');
  await page.getByRole('button', { name: 'Mijn bestellingen', exact: true }).click();
  await expect(page.locator('.history-card')).toContainText('2 × Patat');
  await page
    .locator('.employee-nav')
    .getByRole('button', { name: 'Mijn profiel', exact: true })
    .click();
  await page.getByRole('combobox', { name: 'Deelname', exact: true }).selectOption('away');
  await page.getByLabel('Van', { exact: true }).fill('2026-11-01');
  await page.getByLabel('Tot en met', { exact: true }).fill('2026-11-10');
  await page.getByRole('button', { name: 'Profiel opslaan' }).click();
  await expect(page.getByRole('status')).toContainText('profiel is opgeslagen');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('simultaneous token consumption and order updates have one winner', async ({ request }) => {
  const s = seed();
  const links = await Promise.all([
    request.post('/api/link/consume', { headers: { origin: root }, data: { token: s.token } }),
    request.post('/api/link/consume', { headers: { origin: root }, data: { token: s.token } }),
  ]);
  expect(links.map((r) => r.status()).sort()).toEqual([200, 400]);
  const payload = {
    roundId: s.roundId,
    revision: 0,
    declined: false,
    lines: [{ productId: '85', optionIds: [], quantity: 1, note: '' }],
  };
  const saves = await Promise.all([
    request.post('/api/order', { headers: { origin: root }, data: payload }),
    request.post('/api/order', { headers: { origin: root }, data: payload }),
  ]);
  expect(saves.map((r) => r.status()).sort()).toEqual([200, 409]);
});
test('administrator MFA login, responsive dashboard and settings', async ({ page }) => {
  await adminLogin(page);
  await page.getByRole('button', { name: 'Instellingen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Algemeen & veilige testmodus' })).toBeVisible();
  await expect(page.getByLabel('Veilige testmodus (standaard aan)')).toBeChecked();
  await expect(page.getByLabel('Nieuw wachtwoord', { exact: true }).first()).toHaveValue('');
  await page.getByRole('button', { name: 'Bestelrondes', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nieuwe bestelronde' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
test('payment role cannot access employee accounts or system settings', async ({ page }) => {
  await adminLogin(page, 'payments');
  await expect(page.getByRole('button', { name: 'Instellingen', exact: true })).toHaveCount(0);
  const denied = await page.request.post('/api/settings', { headers: { origin: root }, data: {} });
  expect(denied.status()).toBe(403);
  const employee = await page.request.get('/api/employee');
  expect(employee.status()).toBe(401);
  await page.getByRole('button', { name: 'Betalingen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Terugbetalingen' })).toBeVisible();
});

test('source-required variants must be explicitly chosen before adding to the basket', async ({
  page,
}) => {
  const s = seed();
  await employeeLogin(page, s.token);
  await page.getByRole('tab', { name: /Overige/ }).click();
  await page.getByRole('button', { name: 'Sundae Normaal toevoegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: /Toevoegen/ })).toBeDisabled();
  await dialog
    .getByRole('combobox', { name: 'Sundaes (verplicht)' })
    .selectOption({ label: 'Aardbei' });
  await dialog.getByRole('button', { name: /Toevoegen/ }).click();
  await page.getByRole('button', { name: 'Bestelling bevestigen' }).click();
  await expect(page.getByRole('status')).toContainText('bevestigd');
  await expect(page.locator('.basket-total')).toContainText('4,25');
});
