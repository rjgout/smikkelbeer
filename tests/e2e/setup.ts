import { DatabaseSync } from 'node:sqlite';
// Only Playwright's isolated database. Never select a target from application env.
export default function setup() {
  const db = new DatabaseSync('.e2e-data/smikkelbeer.sqlite');
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  try {
    db.exec('BEGIN IMMEDIATE');
    for (const table of [
      'menu_sync_jobs',
      'outbox',
      'inbox',
      'orders',
      'rounds',
      'tokens',
      'favorites',
      'employees',
      'syncs',
      'rate_limits',
      'sessions',
      'settings',
    ])
      db.exec('DELETE FROM ' + table);
    db.exec('COMMIT');
  } finally {
    db.close();
  }
}
