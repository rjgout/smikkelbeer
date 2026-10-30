import { z } from 'zod';
import { one, run, transaction } from './db';
import { hash } from './crypto';
import { settings } from './config';
import { latestMenu } from './menu';
import { MenuSyncError, enqueueMenuSync, menuSyncStatus } from './menu-jobs';
import { roundInput, validateNewRound, createRoundFromMenu, requireMenuApproval } from './orders';
export const roundCreationInput = roundInput.extend({ requestId: z.uuid() });
export function roundCreationStatus(actor: string, id: string) {
  const row = one('SELECT * FROM round_creation_requests WHERE actor=? AND id=?', actor, id);
  if (!row) return null;
  const job = row.job_id ? menuSyncStatus(row.job_id).job : null;
  return { requestId: id, roundId: row.round_id || job?.resultRoundId || null, job };
}
export function requestRoundCreation(input: unknown, actor: string) {
  const parsed = roundCreationInput.safeParse(input);
  if (!parsed.success)
    throw new MenuSyncError(
      'ROUND_INPUT',
      'Vul een geldige datum (JJJJ-MM-DD), alle tijden en de betaalwijze in.',
      400,
    );
  const { requestId, ...v } = parsed.data;
  return transaction(() => {
    const fingerprint = hash(JSON.stringify({ ...v, test: settings().testMode }));
    const previous = one(
      'SELECT * FROM round_creation_requests WHERE actor=? AND id=?',
      actor,
      requestId,
    );
    if (previous) {
      if (previous.fingerprint !== fingerprint)
        throw new MenuSyncError(
          'REQUEST_CONFLICT',
          'Deze aanvraag hoort bij andere rondegegevens. Vernieuw het formulier.',
          409,
        );
      return { ...roundCreationStatus(actor, requestId)!, reused: true };
    }
    requireMenuApproval();
    try {
      validateNewRound(v);
    } catch (e) {
      if (e instanceof MenuSyncError) throw e;
      throw new MenuSyncError(
        'ROUND_INPUT',
        'Controleer de datum, tijdvolgorde en voorbereidingstijd. Ongeldige of dubbelzinnige lokale tijden zijn niet toegestaan.',
        400,
      );
    }
    let menu;
    try {
      menu = latestMenu();
    } catch {
      /* A complete new source check is required. */
    }
    let roundId: string | null = null,
      job = null;
    if (menu) roundId = createRoundFromMenu(v, actor, menu);
    else job = enqueueMenuSync(actor, 'round.create', v, false).job;
    run(
      'INSERT INTO round_creation_requests(actor,id,fingerprint,created,round_id,job_id) VALUES (?,?,?,?,?,?)',
      actor,
      requestId,
      fingerprint,
      Date.now(),
      roundId,
      job?.id || null,
    );
    return { requestId, roundId, job, reused: false };
  });
}
