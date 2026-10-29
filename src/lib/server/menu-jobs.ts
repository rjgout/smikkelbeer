import { randomUUID } from 'node:crypto';
import { all, one, run, transaction, audit } from './db';
import { settings } from './config';
export const MENU_LEASE_MS = 90000;
export const MENU_COOLDOWN_MS = 60000;
export type MenuPurpose = 'menu' | 'round.create' | 'round.validate';
export class MenuSyncError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 409,
    public retryAfter?: number,
  ) {
    super(message);
  }
}
export function publicMenuJob(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    phase: row.phase,
    purpose: row.purpose,
    processed: row.processed,
    total: row.total,
    currentProductId: row.current_product_id,
    createdAt: row.created,
    startedAt: row.started,
    updatedAt: row.updated,
    finishedAt: row.finished,
    error: row.error_code
      ? { code: row.error_code, message: row.error_message, productId: row.current_product_id }
      : null,
    syncId: row.sync_id,
    resultRoundId: row.result_round_id,
  };
}
export function menuSyncStatus(id?: string) {
  const row = id
    ? one('SELECT * FROM menu_sync_jobs WHERE id=?', id)
    : one(
        "SELECT * FROM menu_sync_jobs ORDER BY CASE WHEN status IN ('queued','running') THEN 0 ELSE 1 END,created DESC,rowid DESC LIMIT 1",
      );
  const latest = one('SELECT at FROM syncs ORDER BY at DESC LIMIT 1');
  return {
    job: publicMenuJob(row),
    lastSuccess: one('SELECT id,at FROM syncs WHERE success=1 ORDER BY at DESC LIMIT 1') || null,
    nextAllowedAt: Math.max(row?.finished || 0, latest?.at || 0) + MENU_COOLDOWN_MS,
  };
}
export function enqueueMenuSync(
  actor: string,
  purpose: MenuPurpose = 'menu',
  payload: unknown = null,
  join = true,
) {
  return transaction(() => {
    const s = settings();
    if (!s.scrapingApproved)
      throw new MenuSyncError(
        'SCRAPING_DISABLED',
        'Beoordeel de bronvoorwaarden en activeer synchronisatie in Instellingen.',
        400,
      );
    const active = one("SELECT * FROM menu_sync_jobs WHERE status IN ('queued','running') LIMIT 1");
    if (active) {
      if (join && purpose === 'menu') return { job: publicMenuJob(active)!, reused: true };
      throw new MenuSyncError(
        'SYNC_ACTIVE',
        'Er loopt al een menukaartsynchronisatie. Volg de voortgang en probeer daarna opnieuw.',
      );
    }
    const recent = one('SELECT MAX(at) AS at FROM syncs');
    const previous = one('SELECT MAX(finished) AS finished FROM menu_sync_jobs');
    const until = Math.max(recent?.at || 0, previous?.finished || 0) + MENU_COOLDOWN_MS;
    if (Date.now() < until)
      throw new MenuSyncError(
        'SYNC_COOLDOWN',
        'Wacht minimaal één minuut na de vorige synchronisatie om de cafetaria te ontzien.',
        429,
        Math.ceil((until - Date.now()) / 1000),
      );
    const id = randomUUID(),
      now = Date.now();
    run(
      "INSERT INTO menu_sync_jobs(id,status,actor,purpose,payload,test,delay_ms,created,updated) VALUES (?,'queued',?,?,?,?,?,?,?)",
      id,
      actor,
      purpose,
      payload === null ? null : JSON.stringify(payload),
      s.testMode ? 1 : 0,
      s.syncIntervalMs,
      now,
      now,
    );
    audit(actor, 'menu.sync_requested', id, { purpose });
    return {
      job: publicMenuJob(one('SELECT * FROM menu_sync_jobs WHERE id=?', id))!,
      reused: false,
    };
  });
}
export function assertMenuLease(id: string, owner: string) {
  const row = one(
    "SELECT * FROM menu_sync_jobs WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?",
    id,
    owner,
    Date.now(),
  );
  if (!row)
    throw new MenuSyncError(
      'LEASE_LOST',
      'De synchronisatie is onderbroken. Vernieuw de status; er wordt geen onvolledige menukaart gebruikt.',
    );
  return row;
}
export function finishMenuFailure(
  id: string,
  owner: string,
  code: string,
  message: string,
  interrupted = false,
) {
  transaction(() => {
    const row = one(
      "SELECT * FROM menu_sync_jobs WHERE id=? AND status='running' AND lease_owner=?",
      id,
      owner,
    );
    if (!row) return;
    const now = Date.now();
    let syncId = row.sync_id;
    if (!syncId) {
      syncId = randomUUID();
      run('INSERT INTO syncs VALUES (?,?,0,NULL,NULL,?)', syncId, now, message);
    }
    run(
      'UPDATE menu_sync_jobs SET status=?,finished=?,updated=?,lease_owner=NULL,lease_until=NULL,error_code=?,error_message=?,sync_id=? WHERE id=?',
      interrupted ? 'interrupted' : 'failed',
      now,
      now,
      code,
      message,
      syncId,
      id,
    );
    audit(row.actor, 'menu.sync_' + (interrupted ? 'interrupted' : 'failed'), id, {
      code,
      productId: row.current_product_id,
    });
  });
}
export function recoverMenuSyncJobs() {
  for (const row of all(
    "SELECT id,lease_owner FROM menu_sync_jobs WHERE status='running' AND lease_until<=?",
    Date.now(),
  ))
    finishMenuFailure(
      row.id,
      row.lease_owner,
      'PROCESS_INTERRUPTED',
      'De synchronisatie is onderbroken door een herstart of verlopen werklease. De vorige geldige momentopnamen zijn bewaard. Start na de wachttijd opnieuw.',
      true,
    );
}
export function claimMenuSyncJob() {
  return transaction(() => {
    const row = one("SELECT * FROM menu_sync_jobs WHERE status='queued' ORDER BY created LIMIT 1");
    if (!row) return null;
    const owner = randomUUID(),
      now = Date.now();
    run(
      "UPDATE menu_sync_jobs SET status='running',phase='menu',started=?,updated=?,lease_owner=?,lease_until=? WHERE id=? AND status='queued'",
      now,
      now,
      owner,
      now + MENU_LEASE_MS,
      row.id,
    );
    return { ...row, status: 'running', lease_owner: owner };
  });
}
export function renewMenuLease(id: string, owner: string) {
  const now = Date.now();
  return !!run(
    "UPDATE menu_sync_jobs SET updated=?,lease_until=? WHERE id=? AND status='running' AND lease_owner=? AND lease_until>?",
    now,
    now + MENU_LEASE_MS,
    id,
    owner,
    now,
  ).changes;
}
