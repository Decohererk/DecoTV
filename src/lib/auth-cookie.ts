import type { NextRequest } from 'next/server';

import { isSecureRequest } from './request-protocol';

export const AUTH_COOKIE_NAME = 'auth';
export const AUTH_META_COOKIE_NAME = 'auth_meta';
export const AUTH_COOKIE_DAYS = 30;

export interface AuthCookieOptions {
  path: '/';
  expires: Date;
  sameSite: 'lax';
  httpOnly: boolean;
  secure: boolean;
  maxAge?: number;
}

export function getAuthCookieExpires(): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + AUTH_COOKIE_DAYS);
  return expires;
}

export function getAuthCookieOptions(
  request: Pick<NextRequest, 'headers' | 'nextUrl'>,
  expires = getAuthCookieExpires(),
): AuthCookieOptions {
  return {
    path: '/',
    expires,
    // DecoTV login is same-origin; Lax works for HTTP LAN, localhost and HTTPS
    // without creating the invalid SameSite=None + Secure=false pair.
    sameSite: 'lax',
    httpOnly: true,
    secure: isSecureRequest(request),
  };
}

export function getAuthMetaCookieOptions(
  request: Pick<NextRequest, 'headers' | 'nextUrl'>,
  expires = getAuthCookieExpires(),
): AuthCookieOptions {
  return {
    ...getAuthCookieOptions(request, expires),
    httpOnly: false,
  };
}

export function getAuthCookieClearOptions(
  request: Pick<NextRequest, 'headers' | 'nextUrl'>,
): AuthCookieOptions {
  return {
    ...getAuthCookieOptions(request, new Date(0)),
    maxAge: 0,
  };
}
