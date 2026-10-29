import { randomBytes } from 'node:crypto';
import {
  constants,
  openSync,
  writeFileSync,
  readSync,
  fstatSync,
  fchmodSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
// Bind all operations to one descriptor. Never check a path and later overwrite it.
export function loadMasterKey(path: string, hasEncryptedData: () => boolean): Buffer {
  let fd: number;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    if (hasEncryptedData()) throw new Error('Master key missing; restore the key from backup');
    try {
      fd = openSync(
        path,
        constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (createError) {
      if ((createError as NodeJS.ErrnoException).code !== 'EEXIST') throw createError;
      return loadMasterKey(path, () => true);
    }
    try {
      writeFileSync(fd, randomBytes(32));
      fsyncSync(fd);
    } catch (writeError) {
      closeSync(fd);
      throw writeError;
    }
  }
  try {
    const metadata = fstatSync(fd);
    if (!metadata.isFile() || metadata.size !== 32) throw new Error('Invalid master key');
    fchmodSync(fd, 0o600);
    const key = Buffer.alloc(32);
    if (readSync(fd, key, 0, 32, 0) !== 32) throw new Error('Incomplete master key');
    return key;
  } finally {
    closeSync(fd);
  }
}
