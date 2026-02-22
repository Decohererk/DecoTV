/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { resolveAdultFilter } from '@/lib/adult-filter';
import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

const ALLOWED_PATTERNS = [
  /\?ac=class/i,
  /\?ac=list/i,
  /\?ac=videolist/i,
  /\?ac=detail/i,
  /\/api\.php/i,
  /\/provide\/vod/i,
  /\/api\/vod/i,
  /\/index\.php/i,
];

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json, application/xml, text/xml, text/html, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

interface MinimalSource {
  key?: string;
  name?: string;
  api?: string;
  is_adult?: unknown;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
  };
}

function isAdultFlag(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on'
    );
  }
  return false;
}

function findMatchedAdultSource(
  decodedUrl: string,
  allSources: MinimalSource[],
): MinimalSource | null {
  let targetOrigin = '';
  try {
    targetOrigin = new URL(decodedUrl).origin.toLowerCase();
  } catch {
    targetOrigin = '';
  }

  const lowerUrl = decodedUrl.toLowerCase();

  for (const source of allSources) {
    if (!isAdultFlag(source.is_adult)) continue;
    const sourceApi = (source.api || '').trim();
    if (!sourceApi) continue;

    try {
      const sourceOrigin = new URL(sourceApi).origin.toLowerCase();
      if (
        (targetOrigin && targetOrigin === sourceOrigin) ||
        lowerUrl.includes(sourceOrigin)
      ) {
        return source;
      }
    } catch {
      if (lowerUrl.includes(sourceApi.toLowerCase())) {
        return source;
      }
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');

  if (!targetUrl) {
    return NextResponse.json(
      { error: 'Missing url parameter', code: 'MISSING_URL' },
      { status: 400 },
    );
  }

  let decodedUrl: string;
  try {
    decodedUrl = decodeURIComponent(targetUrl);
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to decode target url',
        code: 'DECODE_ERROR',
        details: String(error),
      },
      { status: 400 },
    );
  }

  const isAllowed = ALLOWED_PATTERNS.some((pattern) =>
    pattern.test(decodedUrl),
  );
  if (!isAllowed) {
    console.warn('[CMS Proxy] 🚫 Blocked by allowlist:', decodedUrl);
    return NextResponse.json(
      {
        error: 'URL is blocked by allowlist',
        code: 'BLOCKED',
        target: decodedUrl,
      },
      { status: 403 },
    );
  }

  let config: Awaited<ReturnType<typeof getConfig>> | null = null;
  let shouldFilterAdult = true;

  try {
    config = await getConfig();
    shouldFilterAdult = resolveAdultFilter(
      searchParams,
      config.SiteConfig.DisableYellowFilter,
    );
  } catch (err) {
    console.warn(
      '[CMS Proxy] ⚠️ Failed to read config, fallback to safe mode:',
      err,
    );
    const adultParam = searchParams.get('adult');
    const filterParam = searchParams.get('filter');
    shouldFilterAdult = !(
      adultParam === '1' ||
      adultParam === 'true' ||
      filterParam === 'off' ||
      filterParam === 'disable'
    );
  }

  if (shouldFilterAdult && config) {
    try {
      const allSources = (config.SourceConfig || []) as MinimalSource[];
      const matchedAdultSource = findMatchedAdultSource(decodedUrl, allSources);

      if (matchedAdultSource) {
        console.log(
          `[CMS Proxy] 🚫 Blocked adult source request: ${matchedAdultSource.key || 'unknown'} (${matchedAdultSource.name || 'unknown'})`,
        );
        console.log(`[CMS Proxy] 🚫 Target URL: ${decodedUrl}`);

        return NextResponse.json(
          {
            code: 1,
            msg: 'access denied',
            list: [],
            class: [],
            total: 0,
            page: 1,
            pagecount: 0,
          },
          {
            status: 200,
            headers: corsHeaders(),
          },
        );
      }
    } catch (err) {
      // Config inspection failures should not block proxy requests.
      console.warn('[CMS Proxy] ⚠️ Failed while checking adult sources:', err);
    }
  }

  console.log('[CMS Proxy] 📡 Fetching:', decodedUrl);

  try {
    let origin = '';
    try {
      origin = new URL(decodedUrl).origin;
    } catch {
      origin = '';
    }

    const headers: Record<string, string> = { ...BROWSER_HEADERS };
    if (origin) {
      headers.Referer = `${origin}/`;
      headers.Origin = origin;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);

    try {
      const response = await fetch(decodedUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.error(
          '[CMS Proxy] ❌ Upstream error:',
          response.status,
          errorText.substring(0, 200),
        );
        return NextResponse.json(
          {
            error: `Upstream server responded with ${response.status}`,
            code: 'UPSTREAM_ERROR',
            status: response.status,
            target: decodedUrl,
          },
          {
            status: 502,
            headers: corsHeaders(),
          },
        );
      }

      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const elapsed = Date.now() - startTime;

      try {
        const cleanText = text.trim().replace(/^\uFEFF/, '');
        const data = JSON.parse(cleanText);
        return NextResponse.json(data, {
          headers: {
            ...corsHeaders(),
            'X-Proxy-Time': `${elapsed}ms`,
          },
        });
      } catch {
        return new NextResponse(text, {
          status: 200,
          headers: {
            'Content-Type': contentType || 'text/plain; charset=utf-8',
            ...corsHeaders(),
            'X-Proxy-Time': `${elapsed}ms`,
          },
        });
      }
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const elapsed = Date.now() - startTime;
    console.error('[CMS Proxy] ❌ Error after', elapsed, 'ms:', error);

    let errorCode = 'UNKNOWN_ERROR';
    let errorMessage = 'Proxy request failed';
    let statusCode = 502;

    if (error instanceof Error) {
      const errName = error.name;
      const errMsg = error.message;

      if (errName === 'AbortError' || errMsg.includes('aborted')) {
        errorCode = 'TIMEOUT';
        errorMessage = 'Request timeout (20s)';
        statusCode = 504;
      } else if (
        errMsg.includes('ENOTFOUND') ||
        errMsg.includes('getaddrinfo')
      ) {
        errorCode = 'DNS_ERROR';
        errorMessage = 'Failed to resolve target domain';
      } else if (errMsg.includes('ECONNREFUSED')) {
        errorCode = 'CONNECTION_REFUSED';
        errorMessage = 'Target server refused connection';
      } else if (
        errMsg.includes('ECONNRESET') ||
        errMsg.includes('socket hang up')
      ) {
        errorCode = 'CONNECTION_RESET';
        errorMessage = 'Connection reset by peer';
      } else if (errMsg.includes('ETIMEDOUT')) {
        errorCode = 'CONNECT_TIMEOUT';
        errorMessage = 'Connection timeout';
        statusCode = 504;
      } else if (
        errMsg.includes('certificate') ||
        errMsg.includes('SSL') ||
        errMsg.includes('TLS')
      ) {
        errorCode = 'SSL_ERROR';
        errorMessage = 'SSL/TLS certificate error';
      } else if (errMsg.includes('EHOSTUNREACH')) {
        errorCode = 'HOST_UNREACHABLE';
        errorMessage = 'Host unreachable';
      } else {
        errorMessage = errMsg;
      }
    }

    return NextResponse.json(
      {
        error: errorMessage,
        code: errorCode,
        target: decodedUrl,
        elapsed: `${elapsed}ms`,
        details: error instanceof Error ? error.message : String(error),
      },
      {
        status: statusCode,
        headers: corsHeaders(),
      },
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(),
      'Access-Control-Max-Age': '86400',
    },
  });
}
