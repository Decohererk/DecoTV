/* global describe, expect, it */

const {
  hashPassword,
  isStoredPasswordHash,
  normalizePasswordForStorage,
  verifyStoredPassword,
} = require('../src/lib/password');

describe('password storage format', () => {
  it('recognizes only the current scrypt storage format as a stored hash', async () => {
    const hashed = await hashPassword('correct horse battery staple');

    expect(isStoredPasswordHash(hashed)).toBe(true);
    expect(isStoredPasswordHash('scrypt$1$1$1$salt$value')).toBe(false);
    expect(isStoredPasswordHash('scrypt$16384$8$1$salt$value')).toBe(false);
  });

  it('hashes hash-like raw passwords that do not match the strict stored format', async () => {
    const rawPassword = 'scrypt$1$1$1$salt$value';
    const stored = await normalizePasswordForStorage(rawPassword);

    expect(stored).not.toBe(rawPassword);
    expect(isStoredPasswordHash(stored)).toBe(true);

    await expect(
      verifyStoredPassword(stored, rawPassword),
    ).resolves.toMatchObject({ valid: true, needsRehash: false });
  });
});
