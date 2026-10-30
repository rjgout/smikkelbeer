import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const directory = resolve(process.env.DATA_DIR || 'data');
const destination = resolve(
  process.argv[2] || 'backups/' + new Date().toISOString().replaceAll(':', '-'),
);
if (destination === directory || destination.startsWith(directory + '/'))
  throw new Error('Kies een back-upmap buiten het datavolume');
mkdirSync(destination, { recursive: true, mode: 0o700 });
const db = new DatabaseSync(resolve(directory, 'smikkelbeer.sqlite'), { readOnly: true });
await backup(db, resolve(destination, 'smikkelbeer.sqlite'));
db.close();
copyFileSync(resolve(directory, 'master.key'), resolve(destination, 'master.key'));
for (const name of ['smikkelbeer.sqlite', 'master.key'])
  chmodSync(resolve(destination, name), 0o600);
const sums = Object.fromEntries(
  ['smikkelbeer.sqlite', 'master.key'].map((name) => [
    name,
    createHash('sha256')
      .update(readFileSync(resolve(destination, name)))
      .digest('hex'),
  ]),
);
writeFileSync(
  resolve(destination, 'manifest.json'),
  JSON.stringify({ version: 1, created: new Date().toISOString(), sums }, null, 2),
  { mode: 0o600 },
);
console.log(
  'Consistente back-up inclusief sleutel: ' +
    destination +
    '\nVersleutel en verplaats deze map naar een afzonderlijke beveiligde locatie.',
);
