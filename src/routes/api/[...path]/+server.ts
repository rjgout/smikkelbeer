import { json, error, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { all, one, run, transaction, audit } from '#lib/server/db';
import {
  identity,
  requireAdmin,
  requireEmployee,
  loginAdmin,
  logout,
  beginSetup,
  finishSetup,
  consumeToken,
  rateLimit,
  firstName,
  email,
  issueToken,
  permissions,
} from '#lib/server/auth';
import { settings, publicSettings, saveSettings } from '#lib/server/config';
import { requestRoundCreation, roundCreationStatus } from '#lib/server/round-creation';
import { syncHistory } from '#lib/server/menu';
import { MenuSyncError, enqueueMenuSync, menuSyncStatus } from '#lib/server/menu-jobs';
import { invite, enqueue, escape, renderOrder, pollInbox } from '#lib/server/mail';
import { saveOrder, updateTimes, queueValidatedRound, frozenOrders } from '#lib/server/orders';
import { passwordHash, encrypt } from '#lib/server/crypto';
import { Secret } from 'otpauth';
const preferenceSchema = z
  .object({
    confirmations: z.boolean(),
    participation: z.enum(['normal', 'away', 'paused']),
    from: z.string().max(10),
    until: z.string().max(10),
    skipRound: z.string().max(40),
  })
  .superRefine((p, c) => {
    if (
      p.participation === 'away' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(p.until) ||
        p.until < p.from)
    )
      c.addIssue({ code: 'custom', message: 'Kies een geldige afwezigheidsperiode' });
  });
async function body(event: RequestEvent) {
  const reader = event.request.body?.getReader();
  if (!reader) return {};
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 65536) {
      await reader.cancel();
      error(413, 'Verzoek te groot');
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    error(400, 'Ongeldige JSON');
  }
}
function dashboard(e: RequestEvent) {
  const a = requireAdmin(e);
  const can = (p: string) => a.permissions.includes('*') || a.permissions.includes(p);
  const rounds =
    can('rounds') || can('payments')
      ? all(
          'SELECT id,number,day,opens,closes,sends,arrives,status,payment_mode,payment_link,test,issue,revision FROM rounds ORDER BY day DESC LIMIT 60',
        )
      : [];
  return {
    admin: a,
    rounds,
    employees: can('employees')
      ? all('SELECT id,name,email,active,preferences FROM employees ORDER BY name').map((x) => ({
          ...x,
          preferences: JSON.parse(x.preferences),
        }))
      : [],
    orders:
      can('rounds') || can('payments')
        ? all(
            'SELECT id,round_id,employee_id,name,total,paid,declined FROM orders ORDER BY updated DESC LIMIT 1000',
          )
        : [],
    roles: can('roles')
      ? all('SELECT * FROM roles').map((x) => ({ ...x, permissions: JSON.parse(x.permissions) }))
      : [],
    admins: can('roles') ? all('SELECT id,email,role_id,active FROM admins') : [],
    permissions: can('roles') ? permissions : [],
    syncs: can('menu') ? syncHistory() : [],
    syncStatus: can('menu') || can('rounds') ? menuSyncStatus() : null,
    mail: can('mail')
      ? all(
          'SELECT id,round_id,recipient,subject,kind,status,created,error FROM outbox ORDER BY created DESC LIMIT 100',
        )
      : [],
    inbox: can('mail') ? all('SELECT * FROM inbox ORDER BY at DESC LIMIT 50') : [],
    audit: can('audit') ? all('SELECT * FROM audit ORDER BY id DESC LIMIT 200') : [],
    settings: can('settings') ? publicSettings() : null,
    diagnostics: can('diagnostics')
      ? {
          database: one('PRAGMA quick_check'),
          mailConfigured: !!settings().smtp.host,
          imapConfigured: settings().imap.enabled,
          sourceApproved: settings().scrapingApproved,
          testMode: settings().testMode,
          integrity: 'Beveiligingsreview en externe acceptatietests blijven vereist',
        }
      : null,
  };
}
export async function GET(event: RequestEvent) {
  const path = event.params.path;
  if (path === 'health') {
    one('SELECT 1');
    return json({ status: 'ok' });
  }
  if (path === 'session')
    return json({ employee: identity(event, 'employee'), admin: identity(event, 'admin') });
  if (path === 'employee') {
    const e = requireEmployee(event);
    const profile = one('SELECT id,name,email,preferences FROM employees WHERE id=?', e.id);
    const round = one(
      "SELECT id,number,day,closes,sends,arrives,status,snapshot,payment_mode,payment_link FROM rounds WHERE status='open' AND opens<=? AND closes>? ORDER BY opens DESC LIMIT 1",
      Date.now(),
      Date.now(),
    );
    return json({
      profile: { ...profile, preferences: JSON.parse(profile.preferences) },
      round: round ? { ...round, products: JSON.parse(round.snapshot), snapshot: undefined } : null,
      favorites: all('SELECT product_id FROM favorites WHERE employee_id=?', e.id).map(
        (x) => x.product_id,
      ),
      order: round
        ? one('SELECT * FROM orders WHERE round_id=? AND employee_id=?', round.id, e.id)
        : null,
      history: all(
        'SELECT o.id,o.name,o.lines,o.total,o.paid,o.declined,o.updated,r.number,r.day,r.payment_mode,r.payment_link FROM orders o JOIN rounds r ON r.id=o.round_id WHERE o.employee_id=? ORDER BY o.updated DESC LIMIT 50',
        e.id,
      ),
      lastSync: one('SELECT at,success FROM syncs ORDER BY at DESC LIMIT 1'),
    });
  }
  if (path === 'admin') return json(dashboard(event));
  if (path === 'rounds/create/status') {
    const a = requireAdmin(event, 'rounds');
    const id = event.url.searchParams.get('id');
    if (!z.uuid().safeParse(id).success)
      return json({ message: 'Ongeldige rondeaanvraag-ID.' }, { status: 400 });
    const state = roundCreationStatus(a.id, id!);
    if (!state)
      return json(
        {
          message:
            'Deze rondeaanvraag is nog niet geregistreerd. Probeer opnieuw met hetzelfde aanvraag-ID.',
        },
        { status: 404 },
      );
    return json(state);
  }
  if (path === 'menu/sync/status') {
    const admin = requireAdmin(event);
    if (!admin.permissions.some((p) => ['*', 'menu', 'rounds'].includes(p)))
      error(403, 'Geen rechten om synchronisaties te bekijken');
    const id = event.url.searchParams.get('id') || undefined;
    if (id && !z.uuid().safeParse(id).success)
      return json({ message: 'Ongeldige synchronisatie-ID.' }, { status: 400 });
    const state = menuSyncStatus(id);
    if (id && !state.job)
      return json({ message: 'Deze synchronisatietaak bestaat niet.' }, { status: 404 });
    return json(state);
  }
  if (path?.startsWith('round/')) {
    requireAdmin(event, 'rounds');
    const r = one('SELECT * FROM rounds WHERE id=?', path.slice(6));
    if (!r) error(404);
    return json({ round: r, orders: frozenOrders(r.id), html: renderOrder(r, frozenOrders(r.id)) });
  }
  error(404, 'Onbekend endpoint');
}
export async function POST(event: RequestEvent) {
  try {
    return await post(event);
  } catch (e) {
    if (e instanceof MenuSyncError)
      return json(
        { message: e.message, code: e.code, retryAfter: e.retryAfter },
        {
          status: e.httpStatus,
          headers: e.retryAfter ? { 'Retry-After': String(e.retryAfter) } : {},
        },
      );
    if (e instanceof z.ZodError)
      return json({ message: e.issues.map((i) => i.message).join('; ') }, { status: 400 });
    if (e && typeof e === 'object' && 'status' in e) throw e;
    const message = e instanceof Error ? e.message : '';
    if (/UNIQUE/.test(message))
      return json({ message: 'Deze naam, dit adres of deze datum bestaat al.' }, { status: 409 });
    if (/FOREIGN KEY|Last administrator|System role/.test(message))
      return json(
        { message: 'Wijziging geblokkeerd om accounts en systeemrollen te beschermen.' },
        { status: 409 },
      );
    if (message && !/SQLITE|database|ENOENT|SELECT|INSERT|UPDATE/.test(message))
      return json({ message: message.slice(0, 300) }, { status: 400 });
    return json(
      { message: 'Actie mislukt. Controleer de invoer en diagnostiek.' },
      { status: 400 },
    );
  }
}
async function post(event: RequestEvent) {
  const p = event.params.path,
    v = await body(event);
  if (p === 'admin/login') {
    loginAdmin(event, v);
    return json({ ok: true });
  }
  if (p === 'setup/begin' || p === 'setup/finish') {
    rateLimit('setup:' + event.getClientAddress(), 10);
    if (p === 'setup/begin') return json(beginSetup(v));
    finishSetup(event, v);
    return json({ ok: true });
  }
  if (p === 'logout') {
    const kind = z.enum(['admin', 'employee']).parse(v.kind);
    logout(event, kind);
    return json({ ok: true });
  }
  if (p === 'link/request') {
    rateLimit('link-ip:' + event.getClientAddress(), 10);
    const address = email.parse(v.email);
    rateLimit('link-address:' + address, 3);
    const employee = one('SELECT * FROM employees WHERE email=? AND active=1', address);
    if (employee) {
      try {
        invite(employee, 'request:' + randomUUID());
      } catch {
        /* neutral response including restricted test mode */
      }
    }
    return json({ message: 'Als dit adres geregistreerd is, ontvang je een link.' });
  }
  if (p === 'link/consume') {
    rateLimit('consume:' + event.getClientAddress(), 20);
    consumeToken(event, z.string().length(43).parse(v.token));
    return json({ ok: true });
  }
  if (p === 'profile') {
    const e = requireEmployee(event);
    const input = z.object({ name: firstName, preferences: preferenceSchema }).parse(v);
    run(
      'UPDATE employees SET name=?,name_key=?,preferences=? WHERE id=?',
      input.name,
      input.name.toLocaleLowerCase('nl-NL'),
      JSON.stringify(input.preferences),
      e.id,
    );
    audit(e.id, 'profile.update');
    return json({ ok: true });
  }
  if (p === 'profile/email') {
    const e = requireEmployee(event);
    rateLimit('email-change:' + e.id, 3);
    const address = email.parse(v.email);
    if (one('SELECT id FROM employees WHERE email=?', address))
      error(400, 'Adres niet beschikbaar');
    transaction(() => {
      const token = issueToken(e.id, 'email', address);
      enqueue({
        dedupe: 'email-change:' + randomUUID(),
        to: address,
        subject: 'Smikkelbeer · bevestig je nieuwe e-mailadres',
        html: `<p>Bevestig vanuit je ingelogde browser: <a href="${escape(settings().publicUrl)}/login#${token}">Nieuw adres bevestigen</a></p>`,
        kind: 'verification',
      });
    });
    return json({ ok: true });
  }
  if (p === 'favorite') {
    const e = requireEmployee(event);
    const i = z.object({ productId: z.string().regex(/^\d+$/), favorite: z.boolean() }).parse(v);
    if (i.favorite) run('INSERT OR IGNORE INTO favorites VALUES (?,?)', e.id, i.productId);
    else run('DELETE FROM favorites WHERE employee_id=? AND product_id=?', e.id, i.productId);
    return json({ ok: true });
  }
  if (p === 'order') return json(saveOrder(requireEmployee(event).id, v));
  if (p === 'settings') {
    const a = requireAdmin(event, 'settings');
    saveSettings(v, a.id);
    return json({ ok: true });
  }
  if (p === 'employees/create') {
    const a = requireAdmin(event, 'employees'),
      i = z.object({ name: firstName, email }).parse(v);
    const id = randomUUID();
    run(
      'INSERT INTO employees(id,name,name_key,email,created) VALUES (?,?,?,?,?)',
      id,
      i.name,
      i.name.toLocaleLowerCase('nl-NL'),
      i.email,
      Date.now(),
    );
    audit(a.id, 'employee.create', id);
    return json({ id });
  }
  if (p === 'employees/update') {
    const a = requireAdmin(event, 'employees'),
      i = z.object({ id: z.string().uuid(), active: z.boolean(), name: firstName }).parse(v);
    transaction(() => {
      run(
        'UPDATE employees SET active=?,name=?,name_key=? WHERE id=?',
        i.active ? 1 : 0,
        i.name,
        i.name.toLocaleLowerCase('nl-NL'),
        i.id,
      );
      if (!i.active) {
        run("DELETE FROM sessions WHERE kind='employee' AND user_id=?", i.id);
        run('UPDATE tokens SET used=? WHERE employee_id=? AND used IS NULL', Date.now(), i.id);
      }
      audit(a.id, 'employee.update', i.id);
    });
    return json({ ok: true });
  }
  if (p === 'employees/invite' || p === 'employees/revoke') {
    const a = requireAdmin(event, 'employees');
    const id = z.string().uuid().parse(v.id);
    const employee = one('SELECT * FROM employees WHERE id=? AND active=1', id);
    if (!employee) error(404);
    if (p.endsWith('revoke')) {
      run('UPDATE tokens SET used=? WHERE employee_id=? AND used IS NULL', Date.now(), id);
      run("DELETE FROM sessions WHERE kind='employee' AND user_id=?", id);
    } else invite(employee, 'admin-invite:' + randomUUID());
    audit(a.id, p, id);
    return json({ ok: true });
  }
  if (p === 'menu/sync') {
    const a = requireAdmin(event, 'menu');
    const result = enqueueMenuSync(a.id);
    return json(result, {
      status: 202,
      headers: { Location: '/api/menu/sync/status?id=' + result.job.id, 'Retry-After': '2' },
    });
  }
  if (p === 'rounds/create') {
    const a = requireAdmin(event, 'rounds');
    const result = requestRoundCreation(v, a.id);
    return json(result, {
      status: result.job ? 202 : result.reused ? 200 : 201,
      headers: {
        Location: '/api/rounds/create/status?id=' + result.requestId,
        ...(result.job ? { 'Retry-After': '2' } : {}),
      },
    });
  }
  if (p === 'rounds/times') {
    const a = requireAdmin(event, 'rounds');
    updateTimes(z.string().uuid().parse(v.id), v, a.id);
    return json({ ok: true });
  }
  if (p === 'rounds/cancel') {
    const a = requireAdmin(event, 'rounds');
    const id = z.string().uuid().parse(v.id);
    transaction(() => {
      const r = one('SELECT * FROM rounds WHERE id=?', id);
      if (!r || !['planned', 'open', 'closed', 'blocked'].includes(r.status))
        error(409, 'Reeds verstuurde of onzekere bestelling kan niet worden geannuleerd');
      run("UPDATE rounds SET status='cancelled' WHERE id=?", id);
      audit(a.id, 'round.cancel', id);
    });
    return json({ ok: true });
  }
  if (p === 'rounds/recheck') {
    const a = requireAdmin(event, 'rounds');
    const id = z.string().uuid().parse(v.id);
    const r = one('SELECT * FROM rounds WHERE id=?', id);
    if (!r || !['closed', 'blocked'].includes(r.status) || Date.now() < r.sends)
      error(409, 'De ronde is niet gereed voor een nieuwe broncontrole');
    if (!frozenOrders(id).length) {
      queueValidatedRound(id, r.digest);
      return json({ ok: true });
    }
    const result = enqueueMenuSync(a.id, 'round.validate', { roundId: id }, false);
    audit(a.id, 'round.recheck', id);
    return json(result, {
      status: 202,
      headers: { Location: '/api/menu/sync/status?id=' + result.job.id, 'Retry-After': '2' },
    });
  }
  if (p === 'rounds/resolve') {
    const a = requireAdmin(event, 'rounds');
    const i = z
      .object({
        id: z.string().uuid(),
        outcome: z.enum(['sent', 'confirmed', 'completed']),
        confirmed: z.literal(true),
        note: z.string().min(10).max(500),
      })
      .parse(v);
    const r = one('SELECT * FROM rounds WHERE id=?', i.id);
    if (!r || !['unknown', 'sent', 'review', 'confirmed'].includes(r.status))
      error(409, 'Geen te beoordelen verzending');
    run('UPDATE rounds SET status=?,issue=NULL WHERE id=?', i.outcome, i.id);
    audit(a.id, 'round.manual_resolution', i.id, { outcome: i.outcome, note: i.note });
    return json({ ok: true });
  }
  if (p === 'payments') {
    const a = requireAdmin(event, 'payments');
    const i = z.object({ id: z.string().uuid(), paid: z.boolean() }).parse(v);
    run('UPDATE orders SET paid=? WHERE id=?', i.paid ? 1 : 0, i.id);
    audit(a.id, 'payment.manual', i.id, { paid: i.paid });
    return json({ ok: true });
  }
  if (p === 'roles') {
    const a = requireAdmin(event, 'roles');
    if (!a.permissions.includes('*')) error(403, 'Alleen volledige beheerders beheren rollen');
    const i = z
      .object({
        name: z.string().min(2).max(80),
        permissions: z.array(z.enum(permissions)).max(permissions.length),
      })
      .parse(v);
    const id = randomUUID();
    run('INSERT INTO roles VALUES (?,?,?,0)', id, i.name, JSON.stringify(i.permissions));
    audit(a.id, 'role.create', id);
    return json({ id });
  }
  if (p === 'roles/update' || p === 'roles/delete') {
    const a = requireAdmin(event, 'roles');
    if (!a.permissions.includes('*')) error(403, 'Alleen volledige beheerders beheren rollen');
    const id = z.string().uuid().parse(v.id);
    if (p.endsWith('delete')) run('DELETE FROM roles WHERE id=? AND system=0', id);
    else {
      const i = z
        .object({
          name: z.string().min(2).max(80),
          permissions: z.array(z.enum(permissions)).max(permissions.length),
        })
        .parse(v);
      run(
        'UPDATE roles SET name=?,permissions=? WHERE id=? AND system=0',
        i.name,
        JSON.stringify(i.permissions),
        id,
      );
    }
    audit(a.id, p, id);
    return json({ ok: true });
  }
  if (p === 'payments/round') {
    const a = requireAdmin(event, 'payments');
    const i = z
      .object({
        id: z.string().uuid(),
        mode: z.enum(['individual', 'advance']),
        link: z.union([
          z.literal(''),
          z
            .url()
            .refine(
              (s) =>
                new URL(s).protocol === 'https:' && !new URL(s).username && !new URL(s).password,
            ),
        ]),
      })
      .parse(v);
    run('UPDATE rounds SET payment_mode=?,payment_link=? WHERE id=?', i.mode, i.link, i.id);
    audit(a.id, 'payment.round_settings', i.id);
    return json({ ok: true });
  }
  if (p === 'admins/create') {
    const a = requireAdmin(event, 'roles');
    if (!a.permissions.includes('*')) error(403);
    const i = z
      .object({ email, password: z.string().min(14).max(128), roleId: z.string().max(80) })
      .parse(v);
    if (!one('SELECT id FROM roles WHERE id=?', i.roleId)) error(400);
    const secret = new Secret({ size: 20 }).base32;
    const id = randomUUID();
    run(
      'INSERT INTO admins(id,email,password,totp,role_id) VALUES (?,?,?,?,?)',
      id,
      i.email,
      passwordHash(i.password),
      encrypt(secret),
      i.roleId,
    );
    audit(a.id, 'admin.create', id);
    return json({
      id,
      secret,
      message:
        'Deel dit geheim via een afzonderlijk veilig kanaal. MFA is verplicht bij de eerste login.',
    });
  }
  if (p === 'admins/update') {
    const a = requireAdmin(event, 'roles');
    if (!a.permissions.includes('*')) error(403);
    const i = z
      .object({ id: z.string().uuid(), roleId: z.string().max(80), active: z.boolean() })
      .parse(v);
    transaction(() => {
      run('UPDATE admins SET active=?,role_id=? WHERE id=?', i.active ? 1 : 0, i.roleId, i.id);
      run("DELETE FROM sessions WHERE kind='admin' AND user_id=?", i.id);
      audit(a.id, 'admin.update', i.id);
    });
    return json({ ok: true });
  }
  if (p === 'mail/test') {
    const a = requireAdmin(event, 'mail');
    const to = email.parse(v.email);
    enqueue({
      dedupe: 'test:' + randomUUID(),
      to,
      subject: '[TEST] Smikkelbeer verbindingstest',
      html: '<p>De SMTP-verbinding van Smikkelbeer werkt.</p>',
      kind: 'test',
      test: true,
    });
    audit(a.id, 'mail.test');
    return json({ ok: true });
  }
  if (p === 'mail/poll') {
    requireAdmin(event, 'mail');
    await pollInbox();
    return json({ ok: true });
  }
  if (p === 'mail/retry') {
    const a = requireAdmin(event, 'mail');
    const id = z.string().uuid().parse(v.id);
    const row = one('SELECT * FROM outbox WHERE id=?', id);
    if (!row || row.status !== 'failed' || row.kind === 'order')
      error(409, 'Alleen zeker mislukte niet-bestelmails kunnen opnieuw worden klaargezet');
    run("UPDATE outbox SET status='pending',error=NULL WHERE id=?", id);
    audit(a.id, 'mail.retry', id);
    return json({ ok: true });
  }
  if (p === 'diagnostics/simulate') {
    const a = requireAdmin(event, 'diagnostics');
    if (!settings().testMode) error(403, 'Alleen in testmodus');
    requireAdmin(event, 'rounds');
    const id = z.string().uuid().parse(v.id);
    const r = one("SELECT * FROM rounds WHERE id=? AND test=1 AND status='open'", id);
    if (!r) error(400, 'Selecteer een open testronde');
    transaction(() => {
      for (const [n, name] of ['TestBeer', 'TestVos'].entries()) {
        const employeeId = randomUUID();
        run(
          'INSERT INTO employees(id,name,name_key,email,preferences,created) VALUES (?,?,?,?,?,?)',
          employeeId,
          name + id.slice(0, 4),
          name.toLowerCase() + id.slice(0, 4),
          `simulation-${employeeId}@example.invalid`,
          '{"confirmations":false,"participation":"paused"}',
          Date.now(),
        );
        const products = JSON.parse(r.snapshot);
        const product = products.find((p: any) => p.available);
        if (!product) error(400, 'Geen bronproducten beschikbaar');
        saveOrder(employeeId, {
          roundId: id,
          revision: 0,
          declined: false,
          lines: [{ productId: product.id, optionIds: [], quantity: n + 1, note: 'TEST' }],
        });
      }
      audit(a.id, 'test.simulate', id);
    });
    return json({ ok: true });
  }
  error(404, 'Onbekend endpoint');
}
