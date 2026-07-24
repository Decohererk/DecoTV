/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getBaseUrl, resolveUrl } from '@/lib/live';
import { fetchWithValidatedRedirects } from '@/lib/proxy-security';
import { getEffectiveRequestOrigin } from '@/lib/request-protocol';

export const runtime = 'nodejs';

const M3U8_CONTENT_TYPE = 'application/vnd.apple.mpegurl';

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

function getRequestOrigin(req: Request) {
  return getEffectiveRequestOrigin(req);
}

function isLikelyM3U8Url(rawUrl: string) {
  return /\.m3u8(?:$|[?#])/i.test(rawUrl) || /\/m3u8(?:$|[/?#])/i.test(rawUrl);
}

function shouldRewriteAsM3U8(
  contentType: string,
  requestUrl: string,
  responseUrl: string,
) {
  const lowerContentType = contentType.toLowerCase();
  return (
    lowerContentType.includes('mpegurl') ||
    lowerContentType.includes('application/vnd.apple.mpegurl') ||
    lowerContentType.includes('application/x-mpegurl') ||
    lowerContentType.includes('audio/mpegurl') ||
    lowerContentType.includes('octet-stream') ||
    isLikelyM3U8Url(requestUrl) ||
    isLikelyM3U8Url(responseUrl)
  );
}

function buildProxyUrl(
  req: Request,
  path: 'm3u8' | 'segment' | 'key',
  upstreamUrl: string,
  source: string | null,
  options?: { allowCORS?: boolean },
) {
  const proxyUrl = new URL(`/api/proxy/${path}`, getRequestOrigin(req));
  proxyUrl.searchParams.set('url', upstreamUrl);
  if (source) {
    proxyUrl.searchParams.set('decotv-source', source);
  }
  if (options?.allowCORS) {
    proxyUrl.searchParams.set('allowCORS', 'true');
  }
  return proxyUrl.toString();
}

export async function OPTIONS() {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const allowCORS = searchParams.get('allowCORS') === 'true';
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

  let response: Response | null = null;
  let responseUsed = false;

  try {
    const decodedUrl = decodeUpstreamUrl(url);

    response = await fetchWithValidatedRedirects(
      decodedUrl,
      {
        cache: 'no-cache',
        headers: {
          'User-Agent': ua,
        },
      },
      { timeoutMs: 15000 },
    );

    if (!response.ok) {
      return jsonError('Failed to fetch m3u8', response.status || 502);
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (shouldRewriteAsM3U8(contentType, decodedUrl, response.url)) {
      const m3u8Content = await response.text();
      responseUsed = true;

      if (!m3u8Content.trimStart().startsWith('#EXTM3U')) {
        return jsonError('Upstream is not an m3u8 playlist', 502);
      }

      const baseUrl = getBaseUrl(response.url || decodedUrl);
      const modifiedContent = rewriteM3U8Content(
        m3u8Content,
        baseUrl,
        request,
        source,
        allowCORS,
      );

      const headers = new Headers();
      headers.set(
        'Content-Type',
        contentType.toLowerCase().includes('mpegurl')
          ? contentType
          : M3U8_CONTENT_TYPE,
      );
      withCorsHeaders(headers);
      headers.set('Cache-Control', 'no-cache');
      return new Response(modifiedContent, { headers });
    }

    const headers = new Headers();
    headers.set(
      'Content-Type',
      response.headers.get('Content-Type') || 'application/octet-stream',
    );
    withCorsHeaders(headers);
    headers.set('Cache-Control', 'no-cache');
    responseUsed = true;

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return jsonError('Failed to fetch m3u8', 500);
  } finally {
    if (response && !responseUsed) {
      try {
        response.body?.cancel();
      } catch {
        // ignore
      }
    }
  }
}

function rewriteM3U8Content(
  content: string,
  baseUrl: string,
  req: Request,
  source: string | null,
  allowCORS: boolean,
) {
  const lines = content.split('\n');
  const rewrittenLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();

    if (line && !line.startsWith('#')) {
      const resolvedUrl = resolveUrl(baseUrl, line);
      const proxyUrl = allowCORS
        ? resolvedUrl
        : buildProxyUrl(req, 'segment', resolvedUrl, source);
      rewrittenLines.push(proxyUrl);
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      line = rewriteMapUri(line, baseUrl, req, source, allowCORS);
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      line = rewriteKeyUri(line, baseUrl, req, source, allowCORS);
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      rewrittenLines.push(line);
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolvedUrl = resolveUrl(baseUrl, nextLine);
          const proxyUrl = allowCORS
            ? buildProxyUrl(req, 'm3u8', resolvedUrl, source, {
                allowCORS: true,
              })
            : buildProxyUrl(req, 'm3u8', resolvedUrl, source);
          rewrittenLines.push(proxyUrl);
        } else {
          rewrittenLines.push(nextLine);
        }
      }
      continue;
    }

    rewrittenLines.push(line);
  }

  return rewrittenLines.join('\n');
}

function rewriteMapUri(
  line: string,
  baseUrl: string,
  req: Request,
  source: string | null,
  allowCORS: boolean,
) {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    const proxyUrl = allowCORS
      ? resolvedUrl
      : buildProxyUrl(req, 'segment', resolvedUrl, source);
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}

function rewriteKeyUri(
  line: string,
  baseUrl: string,
  req: Request,
  source: string | null,
  allowCORS: boolean,
) {
  const uriMatch = line.match(/URI="([^"]+)"/);
  if (uriMatch) {
    const originalUri = uriMatch[1];
    const resolvedUrl = resolveUrl(baseUrl, originalUri);
    const proxyUrl = allowCORS
      ? resolvedUrl
      : buildProxyUrl(req, 'key', resolvedUrl, source);
    return line.replace(uriMatch[0], `URI="${proxyUrl}"`);
  }
  return line;
}
