import { error, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { TOTP, Secret } from 'otpauth';
import { randomUUID } from 'node:crypto';
import { one, run, transaction, audit } from './db';
import { hash, randomToken, passwordHash, passwordVerify, encrypt, decrypt } from './crypto';
import { settings } from './config';
export const permissions = [
  'rounds',
  'employees',
  'menu',
  'mail',
  'payments',
  'settings',
  'roles',
  'audit',
  'diagnostics',
] as const;
export const firstName = z
  .string()
  .normalize()
  .min(1)
  .max(50)
  .regex(/^\p{L}[\p{L}\p{M}]*(?:-[\p{L}\p{M}]+)*$/u, 'Gebruik één voornaam zonder spaties');
export const email = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export type Identity = {
  id: string;
  kind: 'admin' | 'employee';
  permissions: string[];
  name: string;
};
export function rateLimit(key: string, limit = 8, windowMs = 900000) {
  const now = Date.now();
  const row = one(
    'INSERT INTO rate_limits VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN excluded.expires ELSE expires END RETURNING count',
    hash(key),
    now + windowMs,
    now,
    now,
  );
  if (row.count > limit) error(429, 'Te veel verzoeken. Probeer het later opnieuw.');
}
export function identity(event: RequestEvent, kind: 'admin' | 'employee'): Identity | null {
  const token = event.cookies.get('sb_' + kind);
  if (!token) return null;
  const row = one(
    'SELECT * FROM sessions WHERE hash=? AND kind=? AND expires>?',
    hash(token),
    kind,
    Date.now(),
  );
  if (!row) return null;
  if (kind === 'admin') {
    const a = one(
      'SELECT a.id,a.email,r.permissions FROM admins a JOIN roles r ON r.id=a.role_id WHERE a.id=? AND a.active=1',
      row.user_id,
    );
    return a ? { id: a.id, kind, name: a.email, permissions: JSON.parse(a.permissions) } : null;
  }
  const e = one('SELECT id,name FROM employees WHERE id=? AND active=1', row.user_id);
  return e ? { ...e, kind, permissions: [] } : null;
}
export function requireAdmin(event: RequestEvent, permission?: string) {
  const a = identity(event, 'admin');
  if (!a) error(401, 'Log in als beheerder');
  if (permission && !a.permissions.includes('*') && !a.permissions.includes(permission))
    error(403, 'Geen rechten voor deze actie');
  return a;
}
export function requireEmployee(event: RequestEvent) {
  const e = identity(event, 'employee');
  if (!e) error(401, 'Log in als medewerker');
  return e;
}
export function session(event: RequestEvent, kind: 'admin' | 'employee', id: string) {
  const old = event.cookies.get('sb_' + kind);
  if (old) run('DELETE FROM sessions WHERE hash=?', hash(old));
  const token = randomToken();
  const seconds = kind === 'admin' ? 3600 : 8 * 3600;
  run('INSERT INTO sessions VALUES (?,?,?,?)', hash(token), kind, id, Date.now() + seconds * 1000);
  event.cookies.set('sb_' + kind, token, {
    path: '/',
    httpOnly: true,
    secure: !import.meta.env.DEV,
    sameSite: 'strict',
    maxAge: seconds,
  });
}
export function logout(event: RequestEvent, kind: 'admin' | 'employee') {
  const token = event.cookies.get('sb_' + kind);
  if (token) run('DELETE FROM sessions WHERE hash=?', hash(token));
  event.cookies.delete('sb_' + kind, { path: '/' });
}
export function totp(secret: string) {
  return new TOTP({
    issuer: 'Smikkelbeer',
    label: 'Beheer',
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  });
}
export function verifyTotp(admin: any, code: string) {
  const delta = totp(decrypt(admin.totp)).validate({ token: code, window: 1 });
  if (delta === null) error(401, 'Ongeldige inloggegevens');
  const step = Math.floor(Date.now() / 30000) + delta;
  if (step <= admin.last_step) error(401, 'Code al gebruikt; wacht op een nieuwe code');
  return step;
}
const dummy = passwordHash(randomToken());
export function loginAdmin(event: RequestEvent, input: unknown) {
  const v = z
    .object({ email, password: z.string().max(256), code: z.string().regex(/^\d{6}$/) })
    .parse(input);
  rateLimit('admin:' + event.getClientAddress(), 8);
  rateLimit('admin-email:' + v.email, 8);
  const a = one('SELECT * FROM admins WHERE email=? AND active=1', v.email);
  const valid = passwordVerify(v.password, a?.password || dummy);
  if (!a || !valid) error(401, 'Ongeldige inloggegevens');
  transaction(() => {
    const fresh = one('SELECT * FROM admins WHERE id=?', a.id);
    const step = verifyTotp(fresh, v.code);
    run('UPDATE admins SET last_step=? WHERE id=?', step, a.id);
    session(event, 'admin', a.id);
    audit(a.id, 'auth.login');
  });
}
export function beginSetup(input: unknown) {
  const v = z
    .object({ token: z.string().length(43), email, password: z.string().min(14).max(128) })
    .parse(input);
  return transaction(() => {
    if (one('SELECT id FROM admins LIMIT 1')) error(409, 'Installatie voltooid');
    const b = one(
      'SELECT * FROM bootstrap WHERE id=1 AND token_hash=? AND expires>?',
      hash(v.token),
      Date.now(),
    );
    if (!b) error(403, 'Ongeldige installatiecode');
    if (b.pending)
      error(409, 'MFA-koppeling reeds gestart; maak lokaal een nieuwe installatiecode');
    const secret = new Secret({ size: 20 }).base32;
    run(
      'UPDATE bootstrap SET pending=? WHERE id=1',
      encrypt(JSON.stringify({ email: v.email, password: passwordHash(v.password), secret })),
    );
    return { secret, uri: totp(secret).toString() };
  });
}
export function finishSetup(event: RequestEvent, input: unknown) {
  const v = z
    .object({ token: z.string().length(43), code: z.string().regex(/^\d{6}$/) })
    .parse(input);
  transaction(() => {
    if (one('SELECT id FROM admins LIMIT 1')) error(409, 'Installatie voltooid');
    const b = one(
      'SELECT * FROM bootstrap WHERE id=1 AND token_hash=? AND expires>?',
      hash(v.token),
      Date.now(),
    );
    if (!b?.pending) error(403, 'Ongeldige installatiecode');
    const p = JSON.parse(decrypt(b.pending));
    const delta = totp(p.secret).validate({ token: v.code, window: 1 });
    if (delta === null) error(400, 'Ongeldige MFA-code');
    const id = randomUUID();
    run(
      'INSERT INTO admins (id,email,password,totp,last_step,role_id) VALUES (?,?,?,?,?,?)',
      id,
      p.email,
      p.password,
      encrypt(p.secret),
      Math.floor(Date.now() / 30000) + delta,
      'admin',
    );
    run('DELETE FROM bootstrap');
    session(event, 'admin', id);
    audit(id, 'setup.complete');
  });
}
export function issueToken(employeeId: string, purpose = 'login', payload: string | null = null) {
  const token = randomToken();
  run(
    'INSERT INTO tokens VALUES (?,?,?,?,?,NULL)',
    hash(token),
    employeeId,
    purpose,
    payload,
    Date.now() + settings().tokenMinutes * 60000,
  );
  return token;
}
export function consumeToken(event: RequestEvent, token: string) {
  transaction(() => {
    const row = one(
      'UPDATE tokens SET used=? WHERE hash=? AND used IS NULL AND expires>? RETURNING *',
      Date.now(),
      hash(token),
      Date.now(),
    );
    if (!row) error(400, 'Deze link is verlopen of gebruikt. Vraag een nieuwe aan.');
    const e = one('SELECT * FROM employees WHERE id=? AND active=1', row.employee_id);
    if (!e) error(403, 'Account niet beschikbaar');
    if (row.purpose === 'email') {
      const current = requireEmployee(event);
      if (current.id !== e.id) error(403, 'Bevestig vanuit je eigen sessie');
      run('UPDATE employees SET email=? WHERE id=?', row.payload, e.id);
      audit(e.id, 'profile.email_verified');
    } else if (row.purpose !== 'login') error(400, 'Onbekende link');
    session(event, 'employee', e.id);
  });
}
export function participates(employee: any, roundId: string, day: string) {
  const p = JSON.parse(employee.preferences);
  return (
    employee.active === 1 &&
    p.participation !== 'paused' &&
    p.skipRound !== roundId &&
    !(p.participation === 'away' && p.from <= day && p.until >= day)
  );
}
