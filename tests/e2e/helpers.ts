import { expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, createHash, createCipheriv, scryptSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TOTP, Secret } from 'otpauth';
import { load } from 'cheerio';
export function seed() {
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
export function seedAdmin(role = 'admin') {
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
export async function employeeLogin(page: any, token: string) {
  await page.goto('/login#' + token);
  await page.getByRole('button', { name: 'Bevestigen en doorgaan' }).click();
  await expect(page.getByRole('heading', { name: /Hoi Beer/ })).toBeVisible();
  await page.screenshot({
    path: 'artifacts/employee-' + page.viewportSize().width + '.png',
    fullPage: true,
  });
}
export async function adminLogin(page: any, role = 'admin') {
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
