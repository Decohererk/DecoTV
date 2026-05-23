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

function jsonError(error: string, status: number) {
  const headers = new Headers();
  withCorsHeaders(headers);
  return NextResponse.json({ error }, { status, headers });
}

function decodeUpstreamUrl(rawUrl: string) {
  try {
    return decodeURIComponent(rawUrl);
  } catch {
    return rawUrl;
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
    return jsonError('Missing url', 400);
  }

  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return jsonError('Source not found', 404);
  }
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';
  const decodedUrl = decodeUpstreamUrl(url);

  try {
    const targetUrl = new URL(decodedUrl);
    const response = await fetch(decodedUrl, {
      cache: 'no-cache',
      redirect: 'follow',
      headers: {
        Accept: '*/*',
        Origin: `${targetUrl.protocol}//${targetUrl.host}`,
        Referer: `${targetUrl.protocol}//${targetUrl.host}${targetUrl.pathname}`,
        'User-Agent': ua,
      },
    });
    if (!response.ok) {
      return jsonError('Failed to fetch key', response.status || 502);
    }
    const keyData = await response.arrayBuffer();
    const headers = new Headers();
    withCorsHeaders(headers);
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=3600');
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      headers.set('Content-Length', contentLength);
    }
    return new Response(keyData, { headers });
  } catch {
    return jsonError('Failed to fetch key', 500);
  }
}
