import { error } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { all, one, run, transaction, audit } from './db';
import { settings } from './config';
import { latestMenu, syncMenu, priceLines, type Product } from './menu';
import { enqueue, escape, renderOrder, type FrozenOrder } from './mail';
export const roundInput = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  invite: z.string(),
  close: z.string(),
  send: z.string(),
  arrival: z.string(),
  paymentMode: z.enum(['individual', 'advance']),
});
export function roundTimes(input: z.infer<typeof roundInput>) {
  const s = settings();
  const parse = (time: string) => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Ongeldige tijd');
    const d = DateTime.fromISO(input.day + 'T' + time, { zone: s.timezone });
    if (!d.isValid || d.toFormat('HH:mm') !== time || d.getPossibleOffsets().length > 1)
      throw new Error('Ongeldige of dubbelzinnige lokale tijd');
    return d.toMillis();
  };
  const opens = parse(input.invite),
    closes = parse(input.close),
    sends = parse(input.send),
    arrives = parse(input.arrival);
  if (!(opens < closes && closes <= sends && arrives - sends >= s.minPreparation * 60000))
    throw new Error('Controleer tijdvolgorde en voorbereidingstijd');
  return { opens, closes, sends, arrives };
}
export async function createRound(
  input: unknown,
  actor: string,
  synchronize = true,
  automatic = false,
) {
  const v = roundInput.parse(input),
    s = settings();
  const times = roundTimes(v);
  if (times.closes <= Date.now()) throw new Error('Sluiting ligt in het verleden');
  const menu = synchronize ? await syncMenu(actor) : latestMenu();
  const id = randomUUID(),
    number = 'SB-' + v.day.replaceAll('-', '') + '-' + id.slice(0, 6).toUpperCase();
  transaction(() => {
    if (
      one(
        "SELECT id FROM rounds WHERE opens<? AND closes>? AND status NOT IN ('cancelled','completed')",
        times.closes,
        times.opens,
      )
    )
      throw new Error('Bestelvensters mogen niet overlappen');
    run(
      'INSERT INTO rounds(id,number,day,opens,closes,sends,arrives,snapshot,digest,payment_mode,payment_link,test,automatic) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      id,
      number,
      v.day,
      times.opens,
      times.closes,
      times.sends,
      times.arrives,
      JSON.stringify(menu.products),
      menu.digest,
      v.paymentMode,
      s.paymentLink,
      s.testMode ? 1 : 0,
      automatic ? 1 : 0,
    );
  });
  audit(actor, 'round.create', id);
  return id;
}
export function saveOrder(employeeId: string, input: unknown) {
  const v = z
    .object({
      roundId: z.string().uuid(),
      revision: z.number().int().min(0),
      lines: z.unknown(),
      declined: z.boolean(),
    })
    .parse(input);
  return transaction(() => {
    const round = one('SELECT * FROM rounds WHERE id=?', v.roundId);
    if (!round || round.status !== 'open' || Date.now() >= round.closes || Date.now() < round.opens)
      error(409, 'Deze ronde is gesloten');
    const employee = one('SELECT * FROM employees WHERE id=? AND active=1', employeeId);
    if (!employee) error(403, 'Medewerker niet actief');
    const existing = one(
      'SELECT * FROM orders WHERE round_id=? AND employee_id=?',
      v.roundId,
      employeeId,
    );
    if ((existing?.revision || 0) !== v.revision)
      error(409, 'De bestelling is elders gewijzigd. Vernieuw de pagina.');
    const lines = v.declined ? [] : priceLines(v.lines, JSON.parse(round.snapshot) as Product[]);
    if (!v.declined && !lines.length) error(400, 'Kies producten of Deze keer geen snacks');
    const total = lines.reduce((n, l) => n + l.total, 0);
    const revision = v.revision + 1;
    run(
      'INSERT INTO orders(id,round_id,employee_id,name,lines,total,revision,updated,declined) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(round_id,employee_id) DO UPDATE SET name=excluded.name,lines=excluded.lines,total=excluded.total,revision=excluded.revision,updated=excluded.updated,declined=excluded.declined,paid=0',
      randomUUID(),
      round.id,
      employee.id,
      employee.name,
      JSON.stringify(lines),
      total,
      revision,
      Date.now(),
      v.declined ? 1 : 0,
    );
    if (JSON.parse(employee.preferences).confirmations) {
      const html = v.declined
        ? '<p>Je doet deze keer niet mee.</p>'
        : renderOrder(round, [{ employeeId, name: employee.name, lines, total }]);
      enqueue({
        dedupe: `confirmation:${round.id}:${employee.id}:${revision}`,
        roundId: round.id,
        to: employee.email,
        subject: `Smikkelbeer · ${v.revision ? 'gewijzigde bestelling' : 'bevestiging'} ${round.number}`,
        html: `<p>${escape(settings().templates.confirmation)}</p>` + html,
        kind: 'confirmation',
        test: !!round.test,
      });
    }
    audit(employee.id, 'order.save', round.id, { revision, total, declined: v.declined });
    return { revision, total, lines };
  });
}
export function frozenOrders(roundId: string): FrozenOrder[] {
  return all('SELECT * FROM orders WHERE round_id=? AND declined=0 ORDER BY name', roundId).map(
    (o) => ({
      employeeId: o.employee_id,
      name: o.name,
      lines: JSON.parse(o.lines),
      total: o.total,
    }),
  );
}
export function queueValidatedRound(roundId: string, currentDigest: string) {
  transaction(() => {
    const r = one('SELECT * FROM rounds WHERE id=?', roundId);
    if (!r || !['closed', 'blocked'].includes(r.status)) return;
    if (Date.now() < r.sends) throw new Error('Verzendtijd nog niet bereikt');
    const orders = frozenOrders(r.id);
    if (!orders.length) {
      run("UPDATE rounds SET status='completed' WHERE id=?", r.id);
      audit('system', 'round.empty', r.id);
      return;
    }
    if (r.digest !== currentDigest) {
      run(
        "UPDATE rounds SET status='blocked',issue='Menukaart gewijzigd. Annuleer en maak een nieuwe ronde; medewerkers bevestigen opnieuw.' WHERE id=?",
        r.id,
      );
      audit('system', 'round.price_block', r.id);
      return;
    }
    const s = settings();
    if (!!r.test !== s.testMode) throw new Error('Testmodus gewijzigd; annuleer deze ronde');
    const recipients = r.test ? s.testRecipients.slice(0, 1) : [s.cafeteria];
    if (!recipients.length || !recipients[0]) throw new Error('Geen ontvanger ingesteld');
    const html = renderOrder(r, orders);
    for (const to of recipients)
      enqueue({
        dedupe: 'order:' + r.id + ':' + to,
        roundId: r.id,
        to,
        subject: `${r.test ? '[TEST] ' : ''}Bestelling ${r.number}`,
        html,
        kind: 'order',
        test: !!r.test,
      });
    run("UPDATE rounds SET status='queued',issue=NULL WHERE id=?", r.id);
    audit('system', 'round.queued', r.id);
  });
}
export async function finalizeRound(roundId: string) {
  const r = one('SELECT * FROM rounds WHERE id=?', roundId);
  if (!r || !['closed', 'blocked'].includes(r.status) || Date.now() < r.sends) return;
  if (!frozenOrders(r.id).length) {
    queueValidatedRound(r.id, r.digest);
    return;
  }
  try {
    const current = await syncMenu();
    queueValidatedRound(r.id, current.digest);
  } catch {
    run(
      "UPDATE rounds SET status='blocked',issue='Verzending geblokkeerd: broncontrole niet geslaagd. Controleer menukaartdiagnostiek.' WHERE id=?",
      r.id,
    );
  }
}
export function updateTimes(id: string, input: unknown, actor: string) {
  const v = z
    .object({
      close: z.string(),
      send: z.string(),
      arrival: z.string(),
      confirmCorrection: z.boolean().default(false),
    })
    .parse(input);
  transaction(() => {
    const r = one('SELECT * FROM rounds WHERE id=?', id);
    if (!r) error(404, 'Ronde niet gevonden');
    const times = roundTimes({
      day: r.day,
      invite: DateTime.fromMillis(r.opens, { zone: 'Europe/Amsterdam' }).toFormat('HH:mm'),
      close: v.close,
      send: v.send,
      arrival: v.arrival,
      paymentMode: r.payment_mode,
    });
    if (['sent', 'confirmed', 'review'].includes(r.status)) {
      if (times.closes !== r.closes || times.sends !== r.sends || !v.confirmCorrection)
        error(409, 'Na verzending is alleen een expliciet bevestigde aankomstcorrectie toegestaan');
      if (times.arrives === r.arrives) return;
      const s = settings();
      const recipients = r.test ? s.testRecipients.slice(0, 1) : [s.cafeteria];
      for (const to of recipients)
        enqueue({
          dedupe: `correction:${id}:${r.revision + 1}:${to}`,
          roundId: id,
          to,
          subject: `${r.test ? '[TEST] ' : ''}CORRECTIE aankomsttijd ${r.number}`,
          html: `<h1>Alleen correctie aankomsttijd</h1><p>Bestelling ${escape(r.number)} blijft gelijk.</p><p>Nieuwe aankomsttijd: ${escape(v.arrival)} op ${escape(r.day)}.</p>`,
          kind: 'correction',
          test: !!r.test,
        });
    } else if (!['planned', 'open'].includes(r.status))
      error(409, 'Deze verzendstatus staat geen tijdwijziging toe');
    else if (times.closes <= Date.now()) error(400, 'Nieuwe sluiting moet in de toekomst liggen');
    if (
      one(
        "SELECT id FROM rounds WHERE id!=? AND opens<? AND closes>? AND status NOT IN ('cancelled','completed')",
        id,
        times.closes,
        r.opens,
      )
    )
      throw new Error('Bestelvensters mogen niet overlappen');
    run(
      'UPDATE rounds SET closes=?,sends=?,arrives=?,revision=revision+1 WHERE id=?',
      times.closes,
      times.sends,
      times.arrives,
      id,
    );
    audit(actor, 'round.times', id, {
      before: { closes: r.closes, sends: r.sends, arrives: r.arrives },
      after: times,
      correction: v.confirmCorrection,
    });
  });
}
