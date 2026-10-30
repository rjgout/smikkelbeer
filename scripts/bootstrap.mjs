import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
const directory = resolve(process.env.DATA_DIR || 'data');
const file = resolve(directory, 'smikkelbeer.sqlite');
if (!existsSync(file))
  throw new Error('Start de applicatie eerst om de database te initialiseren.');
const db = new DatabaseSync(file);
db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
try {
  if (db.prepare('SELECT id FROM admins LIMIT 1').get())
    throw new Error('Installatie is al voltooid. Gebruik een bestaand volledig beheeraccount.');
  const token = randomBytes(32).toString('base64url');
  db.prepare(
    'INSERT INTO bootstrap VALUES (1,?,?,NULL) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,expires=excluded.expires,pending=NULL',
  ).run(createHash('sha256').update(token).digest('hex'), Date.now() + 15 * 60000);
  db.exec('COMMIT');
  console.log(
    'Eenmalige installatiecode (15 minuten geldig):\n' +
      token +
      '\nOpen /setup via je HTTPS-adres. Bewaar deze uitvoer niet in tickets of openbare logs.',
  );
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
} finally {
  db.close();
}
