/* eslint-disable no-console */
import { NextRequest, NextResponse } from 'next/server';

import {
  AUTH_COOKIE_NAME,
  AUTH_META_COOKIE_NAME,
  getAuthCookieClearOptions,
  getAuthCookieExpires,
  getAuthCookieOptions,
  getAuthMetaCookieOptions,
} from '@/lib/auth-cookie';
import { isPublicMode } from '@/lib/auth-mode';
import { getAuthSigningSecret, signAuthToken } from '@/lib/auth-signature';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import {
  checkLoginRateLimit,
  recordLoginFailure,
  recordLoginSuccess,
} from '@/lib/login-rate-limit';
import { getEffectiveRequestOrigin } from '@/lib/request-protocol';

export const runtime = 'nodejs';

const STORAGE_TYPE =
  (process.env.NEXT_PUBLIC_STORAGE_TYPE as
    | 'localstorage'
    | 'redis'
    | 'upstash'
    | 'kvrocks'
    | undefined) || 'localstorage';

function withCors(response: NextResponse, req: NextRequest): NextResponse {
  const origin = req.headers.get('origin');
  if (!origin || origin !== getEffectiveRequestOrigin(req)) {
    return response;
  }

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Cookie');
  response.headers.set('Access-Control-Allow-Credentials', 'true');
  response.headers.append('Vary', 'Origin');
  return response;
}

function rateLimitedResponse(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    { error: '登录尝试次数过多，请稍后再试' },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    },
  );
}

async function generateAuthCookie(
  expires: Date,
  username?: string,
  role?: 'owner' | 'admin' | 'user',
): Promise<string> {
  const authData: {
    role: 'owner' | 'admin' | 'user';
    username?: string;
    signature?: string;
    iat?: number;
    exp?: number;
    timestamp?: number;
  } = { role: role || 'user' };

  if (username && getAuthSigningSecret()) {
    const iat = Date.now();
    const exp = expires.getTime();
    authData.username = username;
    // The signature binds iat/exp so a leaked cookie cannot be replayed
    // after it expires and the browser expiry cannot be extended.
    authData.signature = await signAuthToken(username, authData.role, iat, exp);
    authData.iat = iat;
    authData.exp = exp;
    authData.timestamp = iat;
  }

  return encodeURIComponent(JSON.stringify(authData));
}

function generateAuthMetaCookie(
  username?: string,
  role?: 'owner' | 'admin' | 'user',
): string {
  return encodeURIComponent(
    JSON.stringify({
      username,
      role: role || 'user',
      timestamp: Date.now(),
    }),
  );
}

function setAuthCookies(
  response: NextResponse,
  req: NextRequest,
  cookieValue: string,
  metaCookieValue: string,
  expires: Date,
) {
  response.cookies.set(
    AUTH_COOKIE_NAME,
    cookieValue,
    getAuthCookieOptions(req, expires),
  );
  response.cookies.set(
    AUTH_META_COOKIE_NAME,
    metaCookieValue,
    getAuthMetaCookieOptions(req, expires),
  );
}

function clearAuthCookies(response: NextResponse, req: NextRequest) {
  response.cookies.set(AUTH_COOKIE_NAME, '', getAuthCookieClearOptions(req));
  response.cookies.set(
    AUTH_META_COOKIE_NAME,
    '',
    getAuthCookieClearOptions(req),
  );
}

export async function POST(req: NextRequest) {
  try {
    if (isPublicMode()) {
      return withCors(NextResponse.json({ ok: true, mode: 'public' }), req);
    }

    if (STORAGE_TYPE === 'localstorage') {
      const envPassword = process.env.PASSWORD;

      if (!envPassword) {
        const response = NextResponse.json({ ok: true });
        clearAuthCookies(response, req);
        return withCors(response, req);
      }

      const { password } = await req.json();
      if (typeof password !== 'string') {
        return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
      }

      const localRate = checkLoginRateLimit(req, '__local__');
      if (localRate.limited) {
        return withCors(rateLimitedResponse(localRate.retryAfterSeconds), req);
      }

      if (password !== envPassword) {
        recordLoginFailure(req, '__local__');
        return NextResponse.json(
          { ok: false, error: '密码错误' },
          { status: 401 },
        );
      }

      recordLoginSuccess(req, '__local__');
      const expires = getAuthCookieExpires();
      const response = NextResponse.json({ ok: true });
      setAuthCookies(
        response,
        req,
        await generateAuthCookie(expires, '__local__', 'owner'),
        generateAuthMetaCookie('__local__', 'owner'),
        expires,
      );

      return withCors(response, req);
    }

    const { username, password } = await req.json();

    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: '用户名不能为空' }, { status: 400 });
    }
    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: '密码不能为空' }, { status: 400 });
    }

    const rate = checkLoginRateLimit(req, username);
    if (rate.limited) {
      return withCors(rateLimitedResponse(rate.retryAfterSeconds), req);
    }

    if (
      username === process.env.USERNAME &&
      password === process.env.PASSWORD
    ) {
      recordLoginSuccess(req, username);
      const expires = getAuthCookieExpires();
      const response = NextResponse.json({ ok: true });
      setAuthCookies(
        response,
        req,
        await generateAuthCookie(expires, username, 'owner'),
        generateAuthMetaCookie(username, 'owner'),
        expires,
      );

      return withCors(response, req);
    }

    if (username === process.env.USERNAME) {
      recordLoginFailure(req, username);
      return NextResponse.json({ error: '用户名或密码错误' }, { status: 401 });
    }

    const config = await getConfig();
    const user = config.UserConfig.Users.find((u) => u.username === username);
    if (user && user.banned) {
      recordLoginFailure(req, username);
      return NextResponse.json({ error: '用户被封禁' }, { status: 401 });
    }

    try {
      const pass = await db.verifyUser(username, password);
      if (!pass) {
        recordLoginFailure(req, username);
        return NextResponse.json(
          { error: '用户名或密码错误' },
          { status: 401 },
        );
      }

      recordLoginSuccess(req, username);
      const expires = getAuthCookieExpires();
      const response = NextResponse.json({ ok: true });
      setAuthCookies(
        response,
        req,
        await generateAuthCookie(expires, username, user?.role || 'user'),
        generateAuthMetaCookie(username, user?.role || 'user'),
        expires,
      );

      return withCors(response, req);
    } catch (err) {
      console.error('数据库验证失败', err);
      return NextResponse.json({ error: '数据库错误' }, { status: 500 });
    }
  } catch (error) {
    console.error('登录接口异常', error);
    return NextResponse.json({ error: '服务器错误' }, { status: 500 });
  }
}

export async function OPTIONS(req: NextRequest) {
  return withCors(new NextResponse(null, { status: 204 }), req);
}
