import {
  randomBytes,
  createHash,
  createCipheriv,
  createDecipheriv,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { resolve } from 'node:path';
import { one, dataDir } from './db';
import { loadMasterKey } from './keys';
const key = loadMasterKey(
  resolve(dataDir, 'master.key'),
  () => !!(one('SELECT id FROM settings LIMIT 1') || one('SELECT id FROM admins LIMIT 1')),
);
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function encrypt(value: string) {
  const iv = randomBytes(12),
    c = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(value, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64url')).join('.');
}
export function decrypt(value: string) {
  const [iv, tag, body] = value.split('.').map((s) => Buffer.from(s, 'base64url'));
  const c = createDecipheriv('aes-256-gcm', key, iv);
  c.setAuthTag(tag);
  return Buffer.concat([c.update(body), c.final()]).toString('utf8');
}
export function passwordHash(value: string) {
  const salt = randomBytes(16).toString('hex');
  return (
    salt +
    ':' +
    scryptSync(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex')
  );
}
export function passwordVerify(value: string, stored: string) {
  const [salt, digest] = stored.split(':');
  const actual = scryptSync(value, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return (
    actual.length === Buffer.from(digest, 'hex').length &&
    timingSafeEqual(actual, Buffer.from(digest, 'hex'))
  );
}
