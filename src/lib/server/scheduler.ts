import { DateTime } from 'luxon';
import { randomUUID } from 'node:crypto';
import { all, one, run, transaction, audit } from './db';
import { settings } from './config';
import { participates } from './auth';
import { invite, enqueue, processOutbox, pollInbox, recoverSending } from './mail';
import { createRound, finalizeRound } from './orders';
let running = false,
  lastInbox = 0,
  lastRetention = 0;
export async function tick() {
  if (running) return;
  running = true;
  try {
    const s = settings();
    const now = Date.now(),
      local = DateTime.now().setZone(s.timezone),
      day = local.toISODate()!;
    if (
      s.weekdays.includes(local.weekday) &&
      !s.exceptions.includes(day) &&
      local.toFormat('HH:mm') >= s.inviteTime &&
      local.toFormat('HH:mm') < s.closeTime &&
      !one('SELECT id FROM rounds WHERE day=? AND automatic=1', day)
    ) {
      try {
        await createRound(
          {
            day,
            invite: s.inviteTime,
            close: s.closeTime,
            send: s.sendTime,
            arrival: s.arrivalTime,
            paymentMode: s.paymentMode,
          },
          'scheduler',
          true,
          true,
        );
      } catch {
        audit('system', 'schedule.blocked', day, {
          message: 'Automatisch starten mislukt; controleer bron en instellingen',
        });
      }
    }
    for (const r of all(
      "SELECT * FROM rounds WHERE status IN ('planned','open','closed','blocked') ORDER BY opens",
    )) {
      if (r.status === 'planned' && now >= r.opens && now < r.closes)
        run("UPDATE rounds SET status='open' WHERE id=? AND status='planned'", r.id);
      if (now >= r.closes) {
        run("UPDATE rounds SET status='closed' WHERE id=? AND status IN ('planned','open')", r.id);
        if (now >= r.sends && (!r.issue || !r.alerted || now - r.alerted > 300000)) {
          await finalizeRound(r.id);
          run("UPDATE rounds SET alerted=? WHERE id=? AND status='blocked'", now, r.id);
        }
        continue;
      }
      if (now >= r.opens) {
        const employees = all('SELECT * FROM employees WHERE active=1');
        for (const e of employees) {
          if (!participates(e, r.id, r.day)) continue;
          try {
            invite(e, 'invite:' + r.id + ':' + e.id, r.id);
          } catch {
            audit('system', 'invitation.blocked', r.id, { employeeId: e.id });
          }
        }
        run('UPDATE rounds SET invited=COALESCE(invited,?) WHERE id=?', now, r.id);
        const remaining = r.closes - now;
        const reminder = remaining <= s.reminderMinutes * 60000 ? 1 : 0;
        const second = s.secondReminder && remaining <= 5 * 60000 ? 2 : 0;
        for (const stage of [reminder, second].filter(Boolean)) {
          if (stage === 1 ? r.reminded : r.reminded2) continue;
          for (const e of employees) {
            if (
              !participates(e, r.id, r.day) ||
              one('SELECT id FROM orders WHERE round_id=? AND employee_id=?', r.id, e.id)
            )
              continue;
            try {
              invite(e, `reminder:${r.id}:${e.id}:${stage}`, r.id);
            } catch {
              /* restricted test recipients remain blocked */
            }
          }
          run(
            stage === 1
              ? 'UPDATE rounds SET reminded=? WHERE id=?'
              : 'UPDATE rounds SET reminded2=? WHERE id=?',
            now,
            r.id,
          );
        }
      }
    }
    for (const r of all(
      "SELECT * FROM rounds WHERE status IN ('sent','unknown','blocked','failed') AND alerted IS NULL",
    )) {
      if (r.status === 'sent' && now - r.sent < s.confirmationMinutes * 60000) continue;
      if (s.coordinator) {
        try {
          enqueue({
            dedupe: 'alert:' + r.id,
            roundId: r.id,
            to: s.coordinator,
            subject: 'Smikkelbeer · controle nodig ' + r.number,
            html: '<p>Controleer de verzendstatus en ontvangstbevestiging in het beheerdersdashboard. Er wordt geen nieuwe bestelling verzonden.</p>',
            kind: 'alert',
            test: !!r.test,
          });
          run('UPDATE rounds SET alerted=? WHERE id=?', now, r.id);
        } catch {
          /* never redirect restricted test mail to production */
        }
      }
    }
    await processOutbox();
    if (now - lastInbox > 120000) {
      lastInbox = now;
      await pollInbox();
    }
    if (now - lastRetention > 3600000) {
      lastRetention = now;
      retain(s.retentionDays);
    }
  } finally {
    running = false;
  }
}
export function retain(days: number) {
  const cutoff = Date.now() - days * 86400000;
  transaction(() => {
    run('DELETE FROM sessions WHERE expires<?', Date.now());
    run('DELETE FROM tokens WHERE expires<?', Date.now());
    run('DELETE FROM rate_limits WHERE expires<?', Date.now());
    run('DELETE FROM inbox WHERE at<?', cutoff);
    run("DELETE FROM outbox WHERE created<? AND status IN ('sent','failed')", cutoff);
    run(
      "DELETE FROM orders WHERE updated<? AND round_id IN (SELECT id FROM rounds WHERE status IN ('completed','cancelled'))",
      cutoff,
    );
    run('DELETE FROM audit WHERE at<?', cutoff);
    run('DELETE FROM syncs WHERE at<?', cutoff);
  });
}
let timer: ReturnType<typeof setInterval> | undefined;
export function startScheduler() {
  if (timer || process.env.BUILDING === '1') return;
  recoverSending();
  timer = setInterval(() => void tick().catch(() => audit('system', 'scheduler.error')), 30000);
  timer.unref();
  process.once('SIGTERM', () => {
    if (timer) clearInterval(timer);
  });
}
export function jobId() {
  return randomUUID();
}
