import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { buildCategoryTree } from '@/lib/category-tree';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = await verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authResult.username ||
    authInfo?.username ||
    (authResult.isLocalMode ? '__local__' : '');

  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  const config = await getConfig();
  const payload = buildCategoryTree(config);

  const filteredPayload = type
    ? {
        ...payload,
        categories: payload.categories.filter(
          (category) => category.key === type,
        ),
      }
    : payload;

  return NextResponse.json(filteredPayload, {
    headers: {
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
    },
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Max-Age': '86400',
    },
  });
}
