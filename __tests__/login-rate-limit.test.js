/**
 * @jest-environment node
 */
/* global afterEach, beforeEach, describe, expect, it */

const {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
  resetLoginRateLimitForTests,
} = require('../src/lib/login-rate-limit');

function requestFromIp(ip) {
  return { headers: new Headers(ip ? { 'x-forwarded-for': ip } : {}) };
}

const WINDOW_MS = 15 * 60 * 1000;
const originalFlag = process.env.LOGIN_RATE_LIMIT;

describe('login rate limiting (disabled by default)', () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
    delete process.env.LOGIN_RATE_LIMIT;
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.LOGIN_RATE_LIMIT;
    else process.env.LOGIN_RATE_LIMIT = originalFlag;
  });

  it('does not limit anything when LOGIN_RATE_LIMIT is unset', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 50; i++) {
      recordLoginFailure(request, 'admin', now);
    }

    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(false);
  });
});

describe('login rate limiting (LOGIN_RATE_LIMIT=true)', () => {
  beforeEach(() => {
    resetLoginRateLimitForTests();
    process.env.LOGIN_RATE_LIMIT = 'true';
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.LOGIN_RATE_LIMIT;
    else process.env.LOGIN_RATE_LIMIT = originalFlag;
  });

  it('limits an IP+account pair after 5 failures within the window', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(false);
      recordLoginFailure(request, 'admin', now);
    }

    const result = checkLoginRateLimit(request, 'admin', now);
    expect(result.limited).toBe(true);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('never locks out a different client on the same account', () => {
    const attacker = requestFromIp('203.0.113.9');
    const owner = requestFromIp('198.51.100.4');
    const now = Date.now();

    // Attacker trips their own IP+account limit.
    for (let i = 0; i < 6; i++) {
      recordLoginFailure(attacker, 'admin', now);
    }
    expect(checkLoginRateLimit(attacker, 'admin', now).limited).toBe(true);

    // The legitimate owner from another IP is unaffected.
    expect(checkLoginRateLimit(owner, 'admin', now).limited).toBe(false);
  });

  it('bounds one IP spraying many usernames', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 15; i++) {
      recordLoginFailure(request, `user${i}`, now);
    }

    // A fresh username from the same IP is now throttled by the per-IP cap.
    expect(checkLoginRateLimit(request, 'brandnew', now).limited).toBe(true);
  });

  it('does NOT rate limit when no client IP can be determined', () => {
    const request = requestFromIp(null);
    const now = Date.now();

    // Even after many failures, a request without a forwarded IP is allowed:
    // collapsing every client to one bucket would lock out the operator.
    for (let i = 0; i < 50; i++) {
      recordLoginFailure(request, 'admin', now);
    }

    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(false);
  });

  it('clears counters after a successful login', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordLoginFailure(request, 'admin', now);
    }
    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(true);

    recordLoginSuccess(request, 'admin');
    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(false);
  });

  it('forgets failures once the window has passed', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordLoginFailure(request, 'admin', now);
    }
    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(true);
    expect(
      checkLoginRateLimit(request, 'admin', now + WINDOW_MS + 1000).limited,
    ).toBe(false);
  });

  it('treats account names case-insensitively', () => {
    const request = requestFromIp('203.0.113.9');
    const now = Date.now();

    for (let i = 0; i < 5; i++) {
      recordLoginFailure(request, 'Admin', now);
    }

    expect(checkLoginRateLimit(request, 'admin', now).limited).toBe(true);
  });
});
