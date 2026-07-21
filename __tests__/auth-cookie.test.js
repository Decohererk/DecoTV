/* global describe, expect, it */

const {
  getAuthCookieClearOptions,
  getAuthMetaCookieOptions,
  getAuthCookieOptions,
} = require('../src/lib/auth-cookie');
const {
  getEffectiveRequestHost,
  getEffectiveRequestOrigin,
  getEffectiveRequestProtocol,
  isSecureRequest,
} = require('../src/lib/request-protocol');
const { getSafeRedirectPath } = require('../src/lib/safe-redirect');

function requestLike(url, headers = {}) {
  return {
    headers: new Headers(headers),
    nextUrl: new URL(url),
  };
}

describe('request protocol detection', () => {
  it('does not treat production mode as HTTPS', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const request = requestLike('http://192.168.1.20:3334/api/login');

    expect(getEffectiveRequestProtocol(request)).toBe('http');
    expect(isSecureRequest(request)).toBe(false);

    process.env.NODE_ENV = originalNodeEnv;
  });

  it('detects direct HTTPS requests', () => {
    const request = requestLike('https://example.com/api/login');

    expect(getEffectiveRequestProtocol(request)).toBe('https');
    expect(isSecureRequest(request)).toBe(true);
  });

  it('uses the first X-Forwarded-Proto value from a proxy chain', () => {
    const request = requestLike('http://127.0.0.1:3000/api/login', {
      'x-forwarded-proto': ' HTTPS, http ',
    });

    expect(getEffectiveRequestProtocol(request)).toBe('https');
    expect(isSecureRequest(request)).toBe(true);
  });

  it('falls back to the standard Forwarded proto value', () => {
    const request = requestLike('http://127.0.0.1:3000/api/login', {
      forwarded: 'for=192.0.2.60;proto="https";host=example.com',
    });

    expect(getEffectiveRequestProtocol(request)).toBe('https');
    expect(isSecureRequest(request)).toBe(true);
  });

  it('honors an HTTP reverse proxy header', () => {
    const request = requestLike('http://127.0.0.1:3000/api/login', {
      'x-forwarded-proto': 'http',
    });

    expect(getEffectiveRequestProtocol(request)).toBe('http');
    expect(isSecureRequest(request)).toBe(false);
  });

  it('preserves forwarded host ports when building the effective origin', () => {
    const request = requestLike('http://127.0.0.1:3000/api/proxy/m3u8-filter', {
      'x-forwarded-proto': 'https, http',
      'x-forwarded-host': 'tv.example.com:8443',
      host: '127.0.0.1:3000',
    });

    expect(getEffectiveRequestHost(request)).toBe('tv.example.com:8443');
    expect(getEffectiveRequestOrigin(request)).toBe(
      'https://tv.example.com:8443',
    );
  });

  it('combines forwarded host and forwarded port for non-standard HTTPS ports', () => {
    const request = requestLike('http://127.0.0.1:3000/api/tvbox/config', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'tv.example.com',
      'x-forwarded-port': '8443',
      host: '127.0.0.1:3000',
    });

    expect(getEffectiveRequestHost(request)).toBe('tv.example.com:8443');
    expect(getEffectiveRequestOrigin(request)).toBe(
      'https://tv.example.com:8443',
    );
  });

  it('uses a matching Host port when X-Forwarded-Host omits it', () => {
    const request = requestLike('http://127.0.0.1:3000/api/tvbox/config', {
      'x-forwarded-proto': 'https',
      'x-forwarded-host': 'tv.example.com',
      host: 'tv.example.com:8443',
    });

    expect(getEffectiveRequestOrigin(request)).toBe(
      'https://tv.example.com:8443',
    );
  });

  it('falls back to the standard Forwarded host value', () => {
    const request = requestLike('http://127.0.0.1:3000/api/login', {
      forwarded: 'for=192.0.2.60;proto=https;host="tv.example.com:9443"',
    });

    expect(getEffectiveRequestOrigin(request)).toBe(
      'https://tv.example.com:9443',
    );
  });
});

describe('auth cookie options', () => {
  it('sets HTTP IP cookies without Secure and never uses SameSite=None', () => {
    const request = requestLike('http://192.168.1.20:3334/api/login');
    const options = getAuthCookieOptions(request, new Date('2026-01-01'));

    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
    expect(options.httpOnly).toBe(true);
    expect(options.path).toBe('/');
  });

  it('keeps only the non-sensitive auth meta cookie readable by the browser', () => {
    const request = requestLike('http://192.168.1.20:3334/api/login');
    const options = getAuthMetaCookieOptions(request, new Date('2026-01-01'));

    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
    expect(options.httpOnly).toBe(false);
    expect(options.path).toBe('/');
  });

  it('sets localhost HTTP cookies without relying on Secure cookie exceptions', () => {
    const request = requestLike('http://localhost:3000/api/login');
    const options = getAuthCookieOptions(request, new Date('2026-01-01'));

    expect(options.secure).toBe(false);
    expect(options.sameSite).toBe('lax');
  });

  it('sets Secure only for effective HTTPS requests', () => {
    expect(
      getAuthCookieOptions(
        requestLike('https://example.com/api/login'),
        new Date('2026-01-01'),
      ).secure,
    ).toBe(true);

    expect(
      getAuthCookieOptions(
        requestLike('http://127.0.0.1:3000/api/login', {
          'x-forwarded-proto': 'https',
        }),
        new Date('2026-01-01'),
      ).secure,
    ).toBe(true);
  });

  it('uses matching path and security attributes when clearing cookies', () => {
    const httpOptions = getAuthCookieClearOptions(
      requestLike('http://192.168.1.20:3334/api/logout'),
    );
    const httpsOptions = getAuthCookieClearOptions(
      requestLike('https://example.com/api/logout'),
    );

    expect(httpOptions.path).toBe('/');
    expect(httpOptions.maxAge).toBe(0);
    expect(httpOptions.secure).toBe(false);
    expect(httpOptions.sameSite).toBe('lax');

    expect(httpsOptions.path).toBe('/');
    expect(httpsOptions.maxAge).toBe(0);
    expect(httpsOptions.secure).toBe(true);
    expect(httpsOptions.sameSite).toBe('lax');
  });
});

describe('safe login redirects', () => {
  it.each(['/', '/search?q=test', '/play?source=x&id=1'])(
    'allows internal redirect %s',
    (redirect) => {
      expect(getSafeRedirectPath(redirect)).toBe(redirect);
    },
  );

  it.each([
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    'javascript:alert(1)',
    '',
    null,
  ])('rejects unsafe redirect %s', (redirect) => {
    expect(getSafeRedirectPath(redirect)).toBe('/');
  });
});
