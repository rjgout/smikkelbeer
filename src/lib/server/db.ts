import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, readdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
export const dataDir = resolve(process.env.DATA_DIR || 'data');
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(resolve(dataDir, 'smikkelbeer.sqlite'));
chmodSync(resolve(dataDir, 'smikkelbeer.sqlite'), 0o600);
db.exec(
  'PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;',
);
db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
for (const name of readdirSync(resolve('migrations'))
  .filter((n) => n.endsWith('.sql'))
  .sort()) {
  if (!db.prepare('SELECT 1 FROM migrations WHERE name=?').get(name)) {
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try {
      db.exec(readFileSync(resolve('migrations', name), 'utf8'));
      db.prepare('INSERT INTO migrations VALUES (?,?)').run(name, Date.now());
      if (db.prepare('PRAGMA foreign_key_check').all().length)
        throw new Error('Migration foreign key check failed');
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    } finally {
      db.exec('PRAGMA foreign_keys=ON');
    }
  }
}
export function one(sql: string, ...params: any[]): any {
  return db.prepare(sql).get(...params);
}
export function all(sql: string, ...params: any[]): any[] {
  return db.prepare(sql).all(...params);
}
export function run(sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
let depth = 0;
export function transaction<T>(fn: () => T): T {
  const level = depth++,
    sp = 'nested_' + level;
  db.exec(level ? 'SAVEPOINT ' + sp : 'BEGIN IMMEDIATE');
  try {
    const v = fn();
    db.exec(level ? 'RELEASE ' + sp : 'COMMIT');
    return v;
  } catch (e) {
    db.exec(level ? 'ROLLBACK TO ' + sp : 'ROLLBACK');
    if (level) db.exec('RELEASE ' + sp);
    throw e;
  } finally {
    depth--;
  }
}
export function audit(actor: string, action: string, target = '', detail: unknown = {}) {
  run(
    'INSERT INTO audit(at,actor,action,target,detail) VALUES (?,?,?,?,?)',
    Date.now(),
    actor,
    action,
    target,
    JSON.stringify(detail),
  );
}
