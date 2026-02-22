/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

function withCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept',
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  );
}

function copyHeader(
  from: Headers,
  to: Headers,
  sourceKey: string,
  targetKey = sourceKey,
) {
  const value = from.get(sourceKey);
  if (value) {
    to.set(targetKey, value);
  }
}

export async function OPTIONS() {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('decotv-source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }

  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  const decodedUrl = decodeURIComponent(url);

  try {
    const targetUrl = new URL(decodedUrl);
    const requestHeaders = new Headers();
    requestHeaders.set('User-Agent', ua);
    requestHeaders.set('Accept', '*/*');
    requestHeaders.set(
      'Referer',
      `${targetUrl.protocol}//${targetUrl.host}${targetUrl.pathname}`,
    );
    requestHeaders.set('Origin', `${targetUrl.protocol}//${targetUrl.host}`);

    const range = request.headers.get('range');
    if (range) {
      requestHeaders.set('Range', range);
    }

    const response = await fetch(decodedUrl, {
      cache: 'no-cache',
      redirect: 'follow',
      headers: requestHeaders,
    });

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        { error: 'Failed to fetch stream' },
        { status: response.status || 500 },
      );
    }

    const headers = new Headers();
    withCorsHeaders(headers);
    headers.set('Cache-Control', 'no-cache');

    copyHeader(response.headers, headers, 'content-type', 'Content-Type');
    copyHeader(response.headers, headers, 'content-length', 'Content-Length');
    copyHeader(response.headers, headers, 'content-range', 'Content-Range');
    copyHeader(response.headers, headers, 'accept-ranges', 'Accept-Ranges');
    copyHeader(
      response.headers,
      headers,
      'content-disposition',
      'Content-Disposition',
    );

    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/octet-stream');
    }
    if (!headers.has('Accept-Ranges')) {
      headers.set('Accept-Ranges', 'bytes');
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch stream' },
      { status: 500 },
    );
  }
}
