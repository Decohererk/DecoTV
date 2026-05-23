import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  resolvePosterRequest,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const connectorId = (searchParams.get('connectorId') || '').trim();
    const sourceItemId = (searchParams.get('sourceItemId') || '').trim();

    if (!connectorId || !sourceItemId) {
      return NextResponse.json(
        { error: 'connectorId 和 sourceItemId 不能为空' },
        { status: 400 },
      );
    }

    const poster = await resolvePosterRequest(connectorId, sourceItemId);
    if (!poster) {
      return NextResponse.json(
        { error: '未找到可用的私人影库封面' },
        { status: 404 },
      );
    }

    const response = await fetch(poster.url, {
      headers: {
        ...(poster.headers || {}),
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: '私人影库封面读取失败' },
        { status: response.status },
      );
    }

    const headers = new Headers();
    [
      'content-type',
      'content-length',
      'cache-control',
      'etag',
      'last-modified',
    ].forEach((name) => {
      const value = response.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    });
    headers.set(
      'Cache-Control',
      headers.get('Cache-Control') || 'private, max-age=600',
    );

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '私人影库封面代理失败',
        details: toPrivateLibraryErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
