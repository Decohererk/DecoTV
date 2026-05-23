/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { verifyM3U8ProxySignature } from '@/lib/m3u8-proxy';
import { buildPlaybackRequestHeaders } from '@/lib/player/stream-health';
import {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

export const runtime = 'nodejs';

const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 3;

function withCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept',
  );
  headers.set(
    'Access-Control-Expose-Headers',
    [
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
      'Content-Type',
      'X-DecoTV-Playback-Strategy',
      'X-DecoTV-Source',
      'X-DecoTV-Upstream-Status',
      'X-DecoTV-Upstream-Duration',
      'X-DecoTV-Proxy-Cache',
      'X-DecoTV-Error-Reason',
    ].join(', '),
  );
}

function jsonError(error: string, status: number, details?: string) {
  const headers = new Headers();
  withCorsHeaders(headers);
  headers.set('X-DecoTV-Error-Reason', error);
  return NextResponse.json({ error, details }, { status, headers });
}

function inferContentType(decodedUrl: string, kind: string | null) {
  const pathname = (() => {
    try {
      return new URL(decodedUrl).pathname.toLowerCase();
    } catch {
      return decodedUrl.toLowerCase();
    }
  })();

  if (kind === 'key' || pathname.endsWith('.key')) {
    return 'application/octet-stream';
  }
  if (pathname.endsWith('.m4s') || pathname.endsWith('.m4v')) {
    return 'video/iso.segment';
  }
  if (pathname.endsWith('.mp4')) {
    return 'video/mp4';
  }
  if (pathname.endsWith('.aac')) {
    return 'audio/aac';
  }
  if (pathname.endsWith('.vtt')) {
    return 'text/vtt; charset=utf-8';
  }
  return 'video/mp2t';
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

async function findSourceConfig(source: string | null) {
  if (!source) return undefined;
  const config = await getConfig();
  return (
    config.SourceConfig?.find((item: any) => item.key === source) ||
    config.LiveConfig?.find((item: any) => item.key === source)
  );
}

async function handleAssetRequest(request: Request, method: 'GET' | 'HEAD') {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const referer = searchParams.get('referer') || undefined;
  const kind = searchParams.get('kind');
  const source =
    searchParams.get('source') || searchParams.get('decotv-source') || null;

  if (!url) {
    return jsonError('Missing url', 400);
  }

  const decodedUrl = url.trim();
  if (!decodedUrl) {
    return jsonError('Invalid url', 400);
  }

  if (!verifyM3U8ProxySignature(decodedUrl, referer, searchParams.get('sig'))) {
    return jsonError('Invalid signature', 403);
  }

  try {
    await validateProxyTargetUrl(decodedUrl);
  } catch (e: any) {
    return jsonError(e?.message || 'Invalid url', 400);
  }

  const sourceConfig = await findSourceConfig(source);
  const range = request.headers.get('range');
  const requestHeaders = buildPlaybackRequestHeaders({
    url: decodedUrl,
    sourceConfig,
    userAgent: request.headers.get('user-agent') || undefined,
    referer,
    range: range || undefined,
  });

  let upstream: Response;
  try {
    upstream = await fetchWithValidatedRedirects(
      decodedUrl,
      {
        cache: 'no-store',
        headers: requestHeaders,
        method,
      },
      { timeoutMs: FETCH_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS },
    );
  } catch (e: any) {
    return jsonError('Upstream fetch failed', 502, e?.message || 'unknown');
  }

  if (!upstream.ok && upstream.status !== 206) {
    return jsonError('Failed to fetch asset', upstream.status || 502);
  }

  const headers = new Headers();
  withCorsHeaders(headers);
  headers.set(
    'Cache-Control',
    kind === 'key' ? 'public, max-age=3600' : 'no-cache',
  );
  headers.set('Vary', 'Range');
  headers.set('X-DecoTV-Playback-Strategy', 'asset-proxy');
  headers.set('X-DecoTV-Source', source || '');
  headers.set('X-DecoTV-Upstream-Status', String(upstream.status));
  headers.set('X-DecoTV-Upstream-Duration', String(Date.now() - startedAt));
  headers.set('X-DecoTV-Proxy-Cache', 'miss');
  copyHeader(upstream.headers, headers, 'content-type', 'Content-Type');
  copyHeader(upstream.headers, headers, 'content-length', 'Content-Length');
  copyHeader(upstream.headers, headers, 'content-range', 'Content-Range');
  copyHeader(upstream.headers, headers, 'accept-ranges', 'Accept-Ranges');
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', inferContentType(decodedUrl, kind));
  }
  if (!headers.has('Accept-Ranges')) {
    headers.set('Accept-Ranges', 'bytes');
  }

  return new Response(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers,
  });
}

export async function OPTIONS() {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}

export async function HEAD(request: Request) {
  return handleAssetRequest(request, 'HEAD');
}

export async function GET(request: Request) {
  return handleAssetRequest(request, 'GET');
}
