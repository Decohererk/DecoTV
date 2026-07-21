/**
 * @jest-environment node
 */
/* global afterEach, beforeEach, describe, expect, it, jest */

function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

function createRequest(url, options = {}) {
  const { NextRequest } = require('next/server');
  return new NextRequest(url, options);
}

function getSetCookie(response) {
  return response.headers.get('set-cookie') || '';
}

function getCookieHeader(response) {
  return getSetCookie(response).split(';')[0];
}

function decodeSetCookieValue(response) {
  return decodeURIComponent(decodeURIComponent(getCookieHeader(response)));
}

function expectCookieSecurity(setCookie, { secure }) {
  expect(setCookie).toContain('auth=');
  expect(setCookie).toContain('Path=/');
  expect(setCookie).toContain('SameSite=lax');
  expect(setCookie).not.toContain('SameSite=none');
  if (secure) {
    expect(setCookie).toContain('Secure');
  } else {
    expect(setCookie).not.toContain('Secure');
  }
}

const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
  NEXT_PUBLIC_STORAGE_TYPE: process.env.NEXT_PUBLIC_STORAGE_TYPE,
  NEXT_PUBLIC_AUTH_MODE: process.env.NEXT_PUBLIC_AUTH_MODE,
  PUBLIC_ALLOW_ADMIN: process.env.PUBLIC_ALLOW_ADMIN,
  USERNAME: process.env.USERNAME,
  PASSWORD: process.env.PASSWORD,
  LOGIN_RATE_LIMIT: process.env.LOGIN_RATE_LIMIT,
};

let mockDb;
let mockGetConfig;

function mockModules() {
  mockDb = {
    verifyUser: jest.fn(
      async (username, password) =>
        username === 'member' && password === 'member_password',
    ),
  };
  mockGetConfig = jest.fn(async () => ({
    UserConfig: {
      Users: [
        { username: 'member', role: 'admin', banned: false },
        { username: 'banned', role: 'user', banned: true },
      ],
    },
  }));

  jest.doMock('@/lib/db', () => ({ db: mockDb }));
  jest.doMock('@/lib/config', () => ({ getConfig: mockGetConfig }));
}

function loadLoginRoute(storageType) {
  jest.resetModules();
  process.env.NEXT_PUBLIC_STORAGE_TYPE = storageType;
  mockModules();
  return require('../src/app/api/login/route');
}

function loadLogoutRoute() {
  jest.resetModules();
  return require('../src/app/api/logout/route');
}

function loadProxy() {
  jest.resetModules();
  return require('../src/proxy');
}

async function login({ storageType, url, body, headers = {}, origin }) {
  const route = loadLoginRoute(storageType);
  const requestHeaders = {
    'content-type': 'application/json',
    host: new URL(url).host,
    ...headers,
  };
  if (origin) {
    requestHeaders.origin = origin;
  }

  const response = await route.POST(
    createRequest(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(body),
    }),
  );

  return response;
}

describe('auth login and logout routes', () => {
  beforeEach(() => {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PUBLIC_AUTH_MODE = 'password';
    delete process.env.PUBLIC_ALLOW_ADMIN;
    process.env.USERNAME = 'admin';
    process.env.PASSWORD = 'test_password';
  });

  afterEach(() => {
    jest.dontMock('@/lib/db');
    jest.dontMock('@/lib/config');
    Object.entries(originalEnv).forEach(([name, value]) =>
      restoreEnv(name, value),
    );
  });

  it('supports Docker production login over HTTP LAN IP without Secure cookies', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://192.168.1.20:3334/api/login',
      body: { username: 'admin', password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expectCookieSecurity(getSetCookie(response), { secure: false });

    const { proxy } = loadProxy();
    const protectedResponse = await proxy(
      createRequest('http://192.168.1.20:3334/', {
        headers: { cookie: getCookieHeader(response) },
      }),
    );

    expect(protectedResponse.status).not.toBe(307);
    expect(protectedResponse.headers.get('location')).toBeNull();
  });

  it('supports HTTP localhost without Secure cookies', async () => {
    const response = await login({
      storageType: 'localstorage',
      url: 'http://localhost:3000/api/login',
      body: { password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expectCookieSecurity(getSetCookie(response), { secure: false });

    const { proxy } = loadProxy();
    const protectedResponse = await proxy(
      createRequest('http://localhost:3000/search?q=test', {
        headers: { cookie: getCookieHeader(response) },
      }),
    );

    expect(protectedResponse.status).not.toBe(307);
    expect(protectedResponse.headers.get('location')).toBeNull();
  });

  it('marks direct HTTPS login cookies as Secure', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'https://example.com/api/login',
      body: { username: 'admin', password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expectCookieSecurity(getSetCookie(response), { secure: true });
  });

  it('marks HTTPS reverse proxy login cookies as Secure', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://127.0.0.1:3000/api/login',
      headers: { 'x-forwarded-proto': 'https' },
      body: { username: 'admin', password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expectCookieSecurity(getSetCookie(response), { secure: true });
  });

  it('uses the first proxy protocol value from multi-hop headers', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://127.0.0.1:3000/api/login',
      headers: { 'x-forwarded-proto': 'https, http' },
      body: { username: 'admin', password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expectCookieSecurity(getSetCookie(response), { secure: true });
  });

  it('keeps HTTP reverse proxy login cookies non-Secure', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://127.0.0.1:3000/api/login',
      headers: { 'x-forwarded-proto': 'http' },
      body: { username: 'admin', password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expectCookieSecurity(getSetCookie(response), { secure: false });
  });

  it.each(['redis', 'upstash'])(
    'uses the shared database-mode owner login path for %s',
    async (storageType) => {
      const response = await login({
        storageType,
        url: 'http://127.0.0.1:3000/api/login',
        body: { username: 'admin', password: 'test_password' },
      });

      expect(response.status).toBe(200);
      expectCookieSecurity(getSetCookie(response), { secure: false });
      expect(mockDb.verifyUser).not.toHaveBeenCalled();
    },
  );

  it('does not require the database for the kvrocks environment owner branch', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://127.0.0.1:3000/api/login',
      body: { username: 'admin', password: 'test_password' },
    });

    expect(response.status).toBe(200);
    expect(mockDb.verifyUser).not.toHaveBeenCalled();
  });

  it('keeps the database user login path working', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://127.0.0.1:3000/api/login',
      body: { username: 'member', password: 'member_password' },
    });

    expect(mockGetConfig).toHaveBeenCalled();
    expect(mockDb.verifyUser).toHaveBeenCalledWith('member', 'member_password');
    expect(response.status).toBe(200);
    expect(decodeSetCookieValue(response)).toContain('"username":"member"');
    expect(decodeSetCookieValue(response)).toContain('"role":"admin"');
  });

  it('expires auth cookies on HTTP and HTTPS logout using matching paths', async () => {
    const route = loadLogoutRoute();

    const httpResponse = await route.POST(
      createRequest('http://192.168.1.20:3334/api/logout', {
        method: 'POST',
      }),
    );
    const httpsResponse = await route.POST(
      createRequest('https://example.com/api/logout', { method: 'POST' }),
    );

    expectCookieSecurity(getSetCookie(httpResponse), { secure: false });
    expect(getSetCookie(httpResponse)).toContain('Max-Age=0');

    expectCookieSecurity(getSetCookie(httpsResponse), { secure: true });
    expect(getSetCookie(httpsResponse)).toContain('Max-Age=0');

    const { proxy } = loadProxy();
    const protectedResponse = await proxy(
      createRequest('http://192.168.1.20:3334/', {
        headers: { cookie: getCookieHeader(httpResponse) },
      }),
    );

    expect(protectedResponse.status).toBe(307);
    expect(protectedResponse.headers.get('location')).toContain(
      '/login?redirect=%2F',
    );
  });

  it('rate limits repeated failed logins when LOGIN_RATE_LIMIT is enabled', async () => {
    process.env.LOGIN_RATE_LIMIT = 'true';
    const route = loadLoginRoute('kvrocks');
    const attempt = (password) =>
      route.POST(
        createRequest('http://127.0.0.1:3000/api/login', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            host: '127.0.0.1:3000',
            'x-forwarded-for': '203.0.113.9',
          },
          body: JSON.stringify({ username: 'admin', password }),
        }),
      );

    for (let i = 0; i < 5; i++) {
      expect((await attempt('wrong_password')).status).toBe(401);
    }

    const limited = await attempt('wrong_password');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);

    // Even the correct password is throttled while the account is limited.
    const blockedLogin = await attempt('test_password');
    expect(blockedLogin.status).toBe(429);
  });

  it('rejects auth cookies whose signed expiry has passed', async () => {
    const response = await login({
      storageType: 'kvrocks',
      url: 'http://127.0.0.1:3000/api/login',
      body: { username: 'admin', password: 'test_password' },
    });
    expect(response.status).toBe(200);

    const cookieValue = decodeURIComponent(
      getCookieHeader(response).replace(/^auth=/, ''),
    );
    const authData = JSON.parse(decodeURIComponent(cookieValue));
    expect(typeof authData.iat).toBe('number');
    expect(typeof authData.exp).toBe('number');
    expect(authData.exp).toBeGreaterThan(authData.iat);

    // Extending exp without re-signing must not extend the session.
    const forged = {
      ...authData,
      exp: authData.exp + 365 * 24 * 60 * 60 * 1000,
    };

    const { proxy } = loadProxy();
    const forgedResponse = await proxy(
      createRequest('http://127.0.0.1:3000/', {
        headers: {
          cookie: `auth=${encodeURIComponent(JSON.stringify(forged))}`,
        },
      }),
    );

    expect(forgedResponse.status).toBe(307);
    expect(forgedResponse.headers.get('location')).toContain('/login');
  });

  it('rejects legacy cookies signed without iat/exp', async () => {
    const { proxy } = loadProxy();

    // Shape of cookies issued by older builds: signature over username:role.
    const legacy = {
      username: 'admin',
      role: 'owner',
      signature: 'a'.repeat(64),
      timestamp: Date.now(),
    };

    const legacyResponse = await proxy(
      createRequest('http://127.0.0.1:3000/', {
        headers: {
          cookie: `auth=${encodeURIComponent(JSON.stringify(legacy))}`,
        },
      }),
    );

    expect(legacyResponse.status).toBe(307);
    expect(legacyResponse.headers.get('location')).toContain('/login');
  });

  it('does not emit wildcard CORS with credentials for login', async () => {
    const noOriginResponse = await login({
      storageType: 'localstorage',
      url: 'http://127.0.0.1:3000/api/login',
      body: { password: 'test_password' },
    });

    expect(
      noOriginResponse.headers.get('access-control-allow-origin'),
    ).toBeNull();
    expect(
      noOriginResponse.headers.get('access-control-allow-credentials'),
    ).toBeNull();

    const sameOriginResponse = await login({
      storageType: 'localstorage',
      url: 'http://127.0.0.1:3000/api/login',
      origin: 'http://127.0.0.1:3000',
      body: { password: 'test_password' },
    });

    expect(sameOriginResponse.headers.get('access-control-allow-origin')).toBe(
      'http://127.0.0.1:3000',
    );
    expect(
      sameOriginResponse.headers.get('access-control-allow-credentials'),
    ).toBe('true');
  });

  it('keeps public mode frontend access open and admin rules gated', async () => {
    process.env.NEXT_PUBLIC_AUTH_MODE = 'public';
    process.env.PASSWORD = 'test_password';

    const { proxy } = loadProxy();

    const frontendResponse = await proxy(
      createRequest('http://localhost:3000/'),
    );
    expect(frontendResponse.status).not.toBe(307);

    const adminResponse = await proxy(
      createRequest('http://localhost:3000/admin'),
    );
    expect(adminResponse.status).toBe(307);
    expect(adminResponse.headers.get('location')).toContain('/login');

    process.env.PUBLIC_ALLOW_ADMIN = 'true';
    const allowedAdminResponse = await proxy(
      createRequest('http://localhost:3000/admin'),
    );
    expect(allowedAdminResponse.status).not.toBe(307);
  });
});
