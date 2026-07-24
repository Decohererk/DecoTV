import {
  randomBytes,
  scrypt as scryptCallback,
  type ScryptOptions,
  timingSafeEqual,
} from 'crypto';

const HASH_PREFIX = 'scrypt';
const KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const STORED_PASSWORD_HASH_PATTERN =
  /^scrypt\$16384\$8\$1\$[A-Za-z0-9_-]{16,}\$[A-Za-z0-9_-]{80,}$/;

function scrypt(
  password: string,
  salt: string,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(derivedKey as Buffer);
    });
  });
}

export function isStoredPasswordHash(
  value: string | null | undefined,
): boolean {
  return Boolean(value && STORED_PASSWORD_HASH_PATTERN.test(value));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('base64url');
  const derived = (await scrypt(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  })) as Buffer;

  return [
    HASH_PREFIX,
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt,
    derived.toString('base64url'),
  ].join('$');
}

export async function normalizePasswordForStorage(
  password: string,
): Promise<string> {
  return isStoredPasswordHash(password) ? password : hashPassword(password);
}

export async function verifyStoredPassword(
  storedPassword: string,
  candidatePassword: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!isStoredPasswordHash(storedPassword)) {
    return {
      valid: storedPassword === candidatePassword,
      needsRehash: storedPassword === candidatePassword,
    };
  }

  const parts = storedPassword.split('$');
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = Buffer.from(parts[5], 'base64url');

  try {
    const actual = (await scrypt(candidatePassword, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: 64 * 1024 * 1024,
    })) as Buffer;

    return {
      valid:
        expected.length === actual.length && timingSafeEqual(expected, actual),
      needsRehash: n !== SCRYPT_N || r !== SCRYPT_R || p !== SCRYPT_P,
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}
