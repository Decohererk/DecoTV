/**
 * @jest-environment node
 */
/* global afterEach, beforeEach, describe, expect, it */

const {
  getAuthSigningSecret,
  signAuthToken,
  verifyAuthToken,
} = require('../src/lib/auth-signature');

const DAY_MS = 24 * 60 * 60 * 1000;

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

const originalEnv = {
  AUTH_SECRET: process.env.AUTH_SECRET,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  PASSWORD: process.env.PASSWORD,
};

async function signedFields({
  username = 'admin',
  role = 'owner',
  iat = Date.now(),
  exp = Date.now() + 30 * DAY_MS,
} = {}) {
  return {
    username,
    role,
    iat,
    exp,
    signature: await signAuthToken(username, role, iat, exp),
  };
}

describe('auth token signing', () => {
  beforeEach(() => {
    delete process.env.AUTH_SECRET;
    delete process.env.NEXTAUTH_SECRET;
    process.env.PASSWORD = 'env_password';
  });

  afterEach(() => {
    Object.entries(originalEnv).forEach(([name, value]) =>
      restoreEnv(name, value),
    );
  });

  it('prefers AUTH_SECRET over PASSWORD as the signing secret', () => {
    expect(getAuthSigningSecret()).toBe('env_password');

    process.env.AUTH_SECRET = 'dedicated_secret';
    expect(getAuthSigningSecret()).toBe('dedicated_secret');
  });

  it('verifies a freshly signed token', async () => {
    expect(await verifyAuthToken(await signedFields())).toBe(true);
  });

  it('rejects an expired token', async () => {
    const fields = await signedFields({
      iat: Date.now() - 31 * DAY_MS,
      exp: Date.now() - DAY_MS,
    });

    expect(await verifyAuthToken(fields)).toBe(false);
  });

  it('rejects a token with a tampered expiry', async () => {
    const fields = await signedFields({ exp: Date.now() + DAY_MS });

    expect(
      await verifyAuthToken({ ...fields, exp: fields.exp + 365 * DAY_MS }),
    ).toBe(false);
  });

  it('rejects a token with a tampered role', async () => {
    const fields = await signedFields({ role: 'user' });

    expect(await verifyAuthToken({ ...fields, role: 'owner' })).toBe(false);
  });

  it('rejects a token issued too far in the future', async () => {
    const fields = await signedFields({
      iat: Date.now() + DAY_MS,
      exp: Date.now() + 31 * DAY_MS,
    });

    expect(await verifyAuthToken(fields)).toBe(false);
  });

  it('rejects legacy cookies without signed iat/exp', async () => {
    const fields = await signedFields();
    delete fields.iat;
    delete fields.exp;

    expect(await verifyAuthToken(fields)).toBe(false);
  });

  it('rejects tokens signed with a rotated-out secret', async () => {
    process.env.AUTH_SECRET = 'old_secret';
    const fields = await signedFields();

    process.env.AUTH_SECRET = 'new_secret';
    expect(await verifyAuthToken(fields)).toBe(false);
  });
});
