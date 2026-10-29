import { constants, readFileSync, copyFileSync, mkdirSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const source = resolve(process.argv[2] || '');
const dest = resolve(process.env.DATA_DIR || 'data');
if (!process.argv[2]) throw new Error('Geef de back-upmap op');
if (existsSync(resolve(dest, 'smikkelbeer.sqlite')) || existsSync(resolve(dest, 'master.key')))
  throw new Error('Herstel vereist een lege doelmap en een gestopte applicatie');
const manifest = JSON.parse(readFileSync(resolve(source, 'manifest.json'), 'utf8'));
if (manifest.version !== 1) throw new Error('Onbekend back-upformaat');
for (const name of ['smikkelbeer.sqlite', 'master.key']) {
  if (
    createHash('sha256')
      .update(readFileSync(resolve(source, name)))
      .digest('hex') !== manifest.sums[name]
  )
    throw new Error('Checksum onjuist: ' + name);
}
const check = new DatabaseSync(resolve(source, 'smikkelbeer.sqlite'), { readOnly: true });
if (check.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
  throw new Error('Database beschadigd');
check.close();
if (readFileSync(resolve(source, 'master.key')).length !== 32)
  throw new Error('Sleutel beschadigd');
mkdirSync(dest, { recursive: true, mode: 0o700 });
for (const name of ['smikkelbeer.sqlite', 'master.key']) {
  copyFileSync(resolve(source, name), resolve(dest, name), constants.COPYFILE_EXCL);
  chmodSync(resolve(dest, name), 0o600);
}
const db = new DatabaseSync(resolve(dest, 'smikkelbeer.sqlite'));
db.exec(
  "DELETE FROM sessions; DELETE FROM tokens; DELETE FROM bootstrap; UPDATE outbox SET status='unknown',error='Hersteld uit back-up; controleer mailbox' WHERE status IN ('pending','sending'); UPDATE rounds SET status='unknown',issue='Hersteld uit back-up; controleer mailbox' WHERE status IN ('planned','open','closed','blocked','queued','sending');",
);
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='menu_sync_jobs'").get())
  db.prepare(
    "UPDATE menu_sync_jobs SET status='interrupted',finished=?,updated=?,lease_owner=NULL,lease_until=NULL,error_code='BACKUP_RESTORED',error_message='Hersteld uit back-up; controleer de vorige taak en start zo nodig handmatig opnieuw.' WHERE status IN ('queued','running')",
  ).run(Date.now(), Date.now());
db.close();
console.log(
  'Hersteld. Sessies en links zijn ingetrokken. Controleer onzekere verzendingen voor hervatten.',
);
