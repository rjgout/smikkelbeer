import { all, one } from './db';
import { roundWindowStatus } from '../round-window';
// Participation preferences govern invitations, not an explicit manual order.
export function invitationStatus(preferences: any, round: { id: string; day: string }) {
  if (preferences.participation === 'paused')
    return {
      code: 'paused',
      message: 'Je uitnodigingen zijn gepauzeerd. Je kunt je deelname aanpassen in Mijn profiel.',
    };
  if (preferences.skipRound === round.id)
    return {
      code: 'skipped',
      message: 'Je slaat de uitnodigingen voor deze ronde over. Je voorkeur blijft bewaard.',
    };
  if (
    preferences.participation === 'away' &&
    preferences.from <= round.day &&
    preferences.until >= round.day
  )
    return {
      code: 'away',
      message: 'Je staat voor deze datum als afwezig geregistreerd en ontvangt geen uitnodiging.',
    };
  return { code: 'normal', message: '' };
}
export function employeeRounds(employeeId: string, now = Date.now()) {
  const employee = one('SELECT preferences FROM employees WHERE id=? AND active=1', employeeId);
  if (!employee) throw new Error('Medewerker niet actief');
  const preferences = JSON.parse(employee.preferences);
  const metadata = (row: any) =>
    row
      ? {
          ...row,
          windowStatus: roundWindowStatus(row, now),
          participation: invitationStatus(preferences, row),
        }
      : null;
  // Explicit projection: never reveal snapshots, other orders or internal issues.
  const columns = 'id,number,day,opens,closes,arrives,status,test';
  const upcoming = all(
    `SELECT ${columns} FROM rounds WHERE status IN ('planned','open') AND closes>? ORDER BY opens,id LIMIT 12`,
    now,
  ).map(metadata);
  const active = upcoming.find((r) => r!.windowStatus === 'open') || null;
  const recent = metadata(
    one(
      `SELECT ${columns} FROM rounds WHERE status!='cancelled' AND closes<=? ORDER BY closes DESC,id LIMIT 1`,
      now,
    ),
  );
  const recentOrder = recent
    ? one(
        'SELECT id,round_id,lines,total,paid,declined,revision,updated FROM orders WHERE employee_id=? AND round_id=?',
        employeeId,
        recent.id,
      ) || null
    : null;
  return {
    serverNow: now,
    active,
    upcoming: upcoming.filter((r) => r!.windowStatus === 'upcoming'),
    recent: recent ? { round: recent, order: recentOrder } : null,
  };
}
