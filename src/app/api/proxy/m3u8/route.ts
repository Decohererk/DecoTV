import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { rewriteHlsManifest, verifyM3U8ProxySignature } from '@/lib/m3u8-proxy';
import { isLikelyM3U8Content } from '@/lib/player/hls-utils';
import { buildPlaybackRequestHeaders } from '@/lib/player/stream-health';
import {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

export const runtime = 'nodejs';

const M3U8_CONTENT_TYPE = 'application/vnd.apple.mpegurl; charset=utf-8';
const FETCH_TIMEOUT_MS = 12000;
const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function withCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
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
      'X-DecoTV-Error-Reason',
    ].join(', '),
  );
}

function jsonError(
  error: string,
  status: number,
  extraHeaders?: Record<string, string>,
) {
  const headers = new Headers(extraHeaders);
  withCorsHeaders(headers);
  headers.set('X-DecoTV-Error-Reason', error);
  return NextResponse.json({ error }, { status, headers });
}

function getRequestOrigin(req: Request) {
  const requestUrl = new URL(req.url);
  const forwardedProto = req.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const forwardedHost = req.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    .trim();
  const protocol = forwardedProto || requestUrl.protocol.replace(':', '');
  const host = forwardedHost || req.headers.get('host') || requestUrl.host;
  return `${protocol}://${host}`;
}

function shouldProxyAssets(searchParams: URLSearchParams): boolean {
  const explicit =
    searchParams.get('proxyAssets') ||
    searchParams.get('proxySegments') ||
    searchParams.get('assetProxy');
  if (explicit !== null) {
    return explicit === '1' || explicit === 'true' || explicit === 'yes';
  }

  const env = process.env.PLAYBACK_PROXY_SEGMENTS;
  return env === 'true' || env === '1';
}

async function readTextWithLimit(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PLAYLIST_BYTES) {
    throw new Error('Playlist too large');
  }

  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_PLAYLIST_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Playlist too large');
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function findSourceConfig(source: string | null) {
  if (!source) return undefined;
  const config = await getConfig();
  return (
    config.SourceConfig?.find((item) => item.key === source) ||
    config.LiveConfig?.find((item) => item.key === source)
  );
}

async function isLegacyLiveProxyAllowed(source: string | null) {
  if (!source) return false;
  const config = await getConfig();
  return Boolean(config.LiveConfig?.some((item) => item.key === source));
}

export async function OPTIONS() {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const startedAt = Date.now();
  const { searchParams } = new URL(request.url);
  const url = (searchParams.get('url') || '').trim();
  const source =
    searchParams.get('source') || searchParams.get('decotv-source') || null;
  const referer = searchParams.get('referer') || undefined;
  const signature = searchParams.get('sig');
  const proxyAssets = shouldProxyAssets(searchParams);
  const adFilter =
    searchParams.get('adfilter') === 'false' ||
    searchParams.get('adfilter') === '0'
      ? false
      : true;

  if (!url) {
    return jsonError('Missing url', 400);
  }

  const hasValidSignature = verifyM3U8ProxySignature(url, referer, signature);
  const legacyLiveAllowed = await isLegacyLiveProxyAllowed(source);
  if (!hasValidSignature && !legacyLiveAllowed) {
    return jsonError('Invalid signature', 403);
  }

  try {
    await validateProxyTargetUrl(url);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Invalid url',
      400,
    );
  }

  const sourceConfig = await findSourceConfig(source);
  const headers = buildPlaybackRequestHeaders({
    url,
    sourceConfig,
    userAgent: request.headers.get('user-agent') || undefined,
    referer,
  });

  let upstream: Response;
  try {
    upstream = await fetchWithValidatedRedirects(
      url,
      {
        cache: 'no-store',
        headers,
        method: 'GET',
      },
      { timeoutMs: FETCH_TIMEOUT_MS, maxRedirects: MAX_REDIRECTS },
    );
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Upstream fetch failed',
      502,
      {
        'X-DecoTV-Playback-Strategy': proxyAssets
          ? 'asset-proxy'
          : 'manifest-proxy',
        'X-DecoTV-Source': source || '',
      },
    );
  }

  const responseHeadersBase = {
    'X-DecoTV-Playback-Strategy': proxyAssets
      ? 'asset-proxy'
      : 'manifest-proxy',
    'X-DecoTV-Source': source || '',
    'X-DecoTV-Upstream-Status': String(upstream.status),
    'X-DecoTV-Upstream-Duration': String(Date.now() - startedAt),
  };

  if (!upstream.ok) {
    return jsonError('Upstream returned non-OK', 502, responseHeadersBase);
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (
    !isLikelyM3U8Content(contentType, url) &&
    !isLikelyM3U8Content(contentType, upstream.url)
  ) {
    const headers = new Headers(responseHeadersBase);
    withCorsHeaders(headers);
    headers.set('Content-Type', contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'no-cache');
    return new Response(upstream.body, {
      status: upstream.status,
      headers,
    });
  }

  let content: string;
  try {
    content = await readTextWithLimit(upstream);
  } catch (error) {
    return jsonError(
      error instanceof Error ? error.message : 'Unable to read playlist',
      502,
      responseHeadersBase,
    );
  }

  if (!content.trimStart().startsWith('#EXTM3U')) {
    return jsonError('Upstream is not an m3u8 playlist', 502, {
      ...responseHeadersBase,
      'X-DecoTV-Error-Reason': 'not-m3u8',
    });
  }

  const body = rewriteHlsManifest(content, {
    requestOrigin: getRequestOrigin(request),
    upstreamUrl: url,
    finalUrl: upstream.url || url,
    source,
    referer,
    proxyAssets,
    adFilter,
  });

  const responseHeaders = new Headers(responseHeadersBase);
  withCorsHeaders(responseHeaders);
  responseHeaders.set('Content-Type', contentType || M3U8_CONTENT_TYPE);
  responseHeaders.set('Cache-Control', 'no-cache, max-age=15');
  responseHeaders.set('X-DecoTV-Proxy-Cache', 'miss');

  return new Response(body, {
    status: 200,
    headers: responseHeaders,
  });
}
