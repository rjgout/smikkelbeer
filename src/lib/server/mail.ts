import { mailAddress } from './network';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { all, one, run, transaction, audit } from './db';
import { settings } from './config';
import { issueToken } from './auth';
import { hash, encrypt, decrypt } from './crypto';
import type { OrderLine } from './menu';
export const escape = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export const money = (cents: number) =>
  new Intl.NumberFormat('nl-NL', { style: 'currency', currency: 'EUR' }).format(cents / 100);
export type FrozenOrder = { employeeId: string; name: string; lines: OrderLine[]; total: number };
export function renderOrder(round: any, orders: FrozenOrder[]) {
  const kitchen = new Map<string, OrderLine>();
  let total = 0;
  for (const order of orders) {
    const calculated = order.lines.reduce((n, l) => n + l.unit * l.quantity, 0);
    if (calculated !== order.total) throw new Error('Inconsistente bestelbedragen');
    for (const l of order.lines) {
      if (l.total !== l.unit * l.quantity) throw new Error('Inconsistente regel');
      const key = hash(JSON.stringify([l.productId, l.optionIds, l.note, l.unit]));
      const current = kitchen.get(key);
      kitchen.set(key, {
        ...l,
        quantity: l.quantity + (current?.quantity || 0),
        total: l.total + (current?.total || 0),
      });
    }
    total += calculated;
  }
  if ([...kitchen.values()].reduce((n, l) => n + l.total, 0) !== total)
    throw new Error('Keukenoverzicht wijkt af');
  const rows = (lines: OrderLine[]) =>
    lines
      .map(
        (l) =>
          `<tr><td style="padding:8px;border-bottom:1px solid #ddd">${l.quantity} × ${escape(l.name)}${l.options.length ? ' — ' + escape(l.options.join(', ')) : ''}${l.note ? '<br>Opmerking: ' + escape(l.note) : ''}</td><td style="padding:8px;text-align:right">${money(l.total)}</td></tr>`,
      )
      .join('');
  const arrival = new Intl.DateTimeFormat('nl-NL', {
    timeZone: 'Europe/Amsterdam',
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(round.arrives));
  return `<html lang="nl"><body style="font-family:Arial,sans-serif;color:#172d27;max-width:720px;margin:auto;padding:24px"><h1>Smikkelbeer · ${escape(round.number)}</h1><p>Gewenste aankomst: <strong>${escape(arrival)}</strong></p><h2>A · Totaaloverzicht voor de keuken</h2><table width="100%" cellpadding="0" cellspacing="0">${rows([...kitchen.values()])}</table><p><strong>Totaal: ${money(total)}</strong></p><h2>B · Individuele bestellingen</h2>${[
    ...orders,
  ]
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'))
    .map(
      (o) =>
        `<h3>${escape(o.name)}</h3><table width="100%" cellpadding="0" cellspacing="0">${rows(o.lines)}</table><p>Persoonstotaal: <strong>${money(o.total)}</strong></p>`,
    )
    .join(
      '',
    )}<p>Betaalwijze: ${round.payment_mode === 'advance' ? 'Voorgeschoten, terugbetaling onderling' : 'Iedereen betaalt individueel bij de cafetaria'}</p></body></html>`;
}
export function enqueue(input: {
  dedupe: string;
  roundId?: string;
  to: string;
  subject: string;
  html: string;
  kind: string;
  test?: boolean;
}) {
  const s = settings();
  const isTest = input.test ?? s.testMode;
  if (isTest && input.to.toLowerCase() === s.cafeteria.toLowerCase())
    throw new Error('Testmail naar cafetaria geblokkeerd');
  if (isTest && !s.testRecipients.map((e) => e.toLowerCase()).includes(input.to.toLowerCase()))
    throw new Error('Testmail geblokkeerd: ontvanger staat niet op de testlijst');
  const id = randomUUID(),
    now = Date.now();
  const messageId = `<${id}@smikkelbeer.invalid>`;
  run(
    'INSERT INTO outbox(id,dedupe,round_id,recipient,subject,html,message_id,kind,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(dedupe) DO NOTHING',
    id,
    input.dedupe,
    input.roundId || null,
    input.to,
    input.subject,
    encrypt(input.html),
    messageId,
    input.kind,
    now,
    now,
  );
  return one('SELECT id,message_id FROM outbox WHERE dedupe=?', input.dedupe);
}
export function invite(employee: any, dedupe: string, roundId?: string) {
  const s = settings();
  return transaction(() => {
    if (one('SELECT id FROM outbox WHERE dedupe=?', dedupe)) return;
    const token = issueToken(employee.id);
    enqueue({
      dedupe,
      roundId,
      to: employee.email,
      subject: 'Smikkelbeer · jouw bestellink',
      html: `<h1>Hoi ${escape(employee.name)}!</h1><p>${escape(s.templates.invitation)}</p><p><a href="${escape(s.publicUrl)}/login#${token}">Open Smikkelbeer</a></p><p>De link is ${s.tokenMinutes} minuten geldig. Klik daarna op Bevestigen. Deel deze link niet.</p>`,
      kind: 'invitation',
    });
  });
}
export type MailSender = (msg: any, config: ReturnType<typeof settings>) => Promise<void>;
export const smtpSend: MailSender = async (msg, s) => {
  let address: string;
  try {
    address = await mailAddress(s.smtp.host);
  } catch {
    throw Object.assign(new Error('Mailserver niet toegestaan'), { code: 'EHOST' });
  }
  const transport = nodemailer.createTransport({
    host: address,
    port: s.smtp.port,
    secure: s.smtp.port === 465,
    requireTLS: true,
    auth: { user: s.smtp.user, pass: s.smtp.password },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    tls: { minVersion: 'TLSv1.2', servername: s.smtp.host },
    logger: false,
    debug: false,
  });
  try {
    const result = await transport.sendMail({
      from: s.smtp.from,
      to: msg.recipient,
      subject: msg.subject,
      html: decrypt(msg.html),
      messageId: msg.message_id,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    if (!result.accepted?.length) throw new Error('Niet geaccepteerd');
  } finally {
    transport.close();
  }
};
let processing = false;
export async function processOutbox(sender: MailSender = smtpSend) {
  if (processing) return;
  processing = true;
  try {
    const s = settings();
    if (!s.smtp.host) return;
    for (const msg of all(
      "SELECT * FROM outbox WHERE status='pending' ORDER BY created LIMIT 10",
    )) {
      if (
        s.testMode &&
        (!s.testRecipients.map((x) => x.toLowerCase()).includes(msg.recipient.toLowerCase()) ||
          msg.recipient.toLowerCase() === s.cafeteria.toLowerCase())
      ) {
        run(
          "UPDATE outbox SET status='failed',error='Huidige testmodus blokkeert ontvanger',updated=? WHERE id=?",
          Date.now(),
          msg.id,
        );
        if (msg.kind === 'order')
          run(
            "UPDATE rounds SET status='failed',issue='Ontvanger geblokkeerd door testmodus' WHERE id=?",
            msg.round_id,
          );
        continue;
      }
      if (
        !run(
          "UPDATE outbox SET status='sending',updated=? WHERE id=? AND status='pending'",
          Date.now(),
          msg.id,
        ).changes
      )
        continue;
      if (msg.kind === 'order')
        run("UPDATE rounds SET status='sending' WHERE id=? AND status='queued'", msg.round_id);
      try {
        await sender(msg, s);
        transaction(() => {
          run("UPDATE outbox SET status='sent',html='',updated=? WHERE id=?", Date.now(), msg.id);
          if (msg.kind === 'order')
            run(
              "UPDATE rounds SET status='sent',sent=?,message_id=? WHERE id=?",
              Date.now(),
              msg.message_id,
              msg.round_id,
            );
          audit('system', 'mail.sent', msg.id);
        });
      } catch (e) {
        const code = (e as { code?: string }).code;
        const definite = ['EAUTH', 'EENVELOPE', 'EDNS', 'EHOST'].includes(code || '');
        const status = definite ? 'failed' : 'unknown';
        transaction(() => {
          run(
            'UPDATE outbox SET status=?,error=?,updated=? WHERE id=?',
            status,
            definite
              ? 'SMTP geweigerd vóór verzending'
              : 'Uitkomst onzeker; controleer de mailbox vóór verdere actie',
            Date.now(),
            msg.id,
          );
          if (msg.kind === 'order')
            run(
              'UPDATE rounds SET status=?,issue=? WHERE id=?',
              status,
              'Controleer verzenduitkomst in de mailbox',
              msg.round_id,
            );
          audit('system', 'mail.' + status, msg.id);
        });
      }
    }
  } finally {
    processing = false;
  }
}
export function recoverSending() {
  transaction(() => {
    run(
      "UPDATE outbox SET status='unknown',error='Proces onderbroken tijdens verzending; controleer mailbox' WHERE status='sending'",
    );
    run(
      "UPDATE rounds SET status='unknown',issue='Proces onderbroken; controleer mailbox' WHERE status='sending'",
    );
  });
}
export function classifyIncoming(
  input: {
    sender: string;
    subject: string;
    text: string;
    inReplyTo?: string;
    references?: string[];
  },
  rounds: any[],
  expected: string,
) {
  const text = input.subject + '\n' + input.text;
  const matches = rounds.filter(
    (r) =>
      text.includes(r.number) ||
      input.inReplyTo === r.message_id ||
      input.references?.includes(r.message_id),
  );
  const validSender = input.sender.toLowerCase() === expected.toLowerCase() && !!expected;
  const positive =
    /\b(bevestigd|ontvangen|akkoord|we hebben.*bestelling|bestelling.*ontvangen)\b/i.test(text) &&
    !/\b(niet|geen|geannuleerd|annuleren|kan niet|wijzig|probleem|helaas)\b/i.test(text);
  return {
    roundId: matches.length === 1 ? matches[0].id : null,
    status: 'review',
    reason:
      validSender && matches.length === 1 && positive
        ? 'Passende afzender, thread en bevestiging; controleer authenticiteit'
        : 'Onzekere afzender, koppeling of inhoud; handmatige beoordeling verplicht',
  };
}
let polling = false;
export async function pollInbox() {
  const s = settings();
  if (!s.imap.enabled || polling) return;
  polling = true;
  let address: string;
  try {
    address = await mailAddress(s.imap.host);
  } catch {
    polling = false;
    audit('system', 'imap.host_blocked');
    return;
  }
  const client = new ImapFlow({
    host: address,
    port: 993,
    secure: true,
    auth: { user: s.imap.user, pass: s.imap.password },
    logger: false,
    tls: { minVersion: 'TLSv1.2', servername: s.imap.host },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const found = await client.search(
        { since: new Date(Date.now() - 7 * 86400000) },
        { uid: true },
      );
      const ids = found === false ? [] : found.slice(-50);
      if (ids.length) {
        const messages = [];
        for await (const message of client.fetch(ids, { uid: true, size: true }, { uid: true }))
          messages.push(message);
        for (const meta of messages) {
          if (!meta.size || meta.size > 1_000_000) continue;
          const message = await client.fetchOne(
            meta.uid,
            { source: { start: 0, maxLength: 1_000_001 } },
            { uid: true },
          );
          if (!message || !message.source || message.source.length > 1_000_000) continue;
          const id = hash(String(client.mailbox && client.mailbox.uidValidity) + ':' + meta.uid);
          if (one('SELECT 1 FROM inbox WHERE id=?', id)) continue;
          const parsed = await simpleParser(message.source, {
            skipHtmlToText: true,
            skipTextToHtml: true,
            skipImageLinks: true,
          });
          const sender = parsed.from?.value[0]?.address || '',
            subject = (parsed.subject || '').slice(0, 300),
            text = (parsed.text || '').slice(0, 10000);
          const verdict = classifyIncoming(
            {
              sender,
              subject,
              text,
              inReplyTo: parsed.inReplyTo,
              references:
                typeof parsed.references === 'string' ? [parsed.references] : parsed.references,
            },
            all("SELECT * FROM rounds WHERE status IN ('sent','unknown','review')"),
            s.cafeteria,
          );
          transaction(() => {
            run(
              'INSERT INTO inbox VALUES (?,?,?,?,?,?,?,?)',
              id,
              Date.now(),
              sender,
              subject,
              text.slice(0, 2000),
              verdict.roundId,
              verdict.status,
              verdict.reason,
            );
            if (verdict.roundId)
              run(
                "UPDATE rounds SET status='review' WHERE id=? AND status IN ('sent','unknown')",
                verdict.roundId,
              );
          });
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
  } catch {
    audit('system', 'imap.error', '', {
      message: 'Inkomende mailbox niet bereikbaar; controleer instellingen',
    });
  } finally {
    polling = false;
  }
}
