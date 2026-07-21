import { NextRequest, NextResponse } from 'next/server';

import {
  AUTH_COOKIE_NAME,
  AUTH_META_COOKIE_NAME,
  getAuthCookieClearOptions,
} from '@/lib/auth-cookie';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(
    AUTH_COOKIE_NAME,
    '',
    getAuthCookieClearOptions(request),
  );
  response.cookies.set(
    AUTH_META_COOKIE_NAME,
    '',
    getAuthCookieClearOptions(request),
  );

  return response;
}
