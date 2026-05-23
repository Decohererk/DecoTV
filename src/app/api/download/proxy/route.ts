import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Connection: 'keep-alive',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

interface HeaderVariant {
  referer?: string;
  origin?: string;
}

interface FetchAttemptError {
  status: number;
  details: string;
}

const PLAYLIST_FETCH_TIMEOUT_MS = 20_000;
const RESOURCE_FETCH_TIMEOUT_MS = 90_000;

function buildError(status: number, message: string, details?: string) {
  return NextResponse.json(
    {
      error: message,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

function safeDecodeURIComponent(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseHttpUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  if (trimmed.includes('%')) {
    const decoded = safeDecodeURIComponent(trimmed);
    if (decoded !== trimmed) {
      candidates.push(decoded);
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        continue;
      }
      return parsed;
    } catch {
      // try next candidate
    }
  }

  return null;
}

function normalizeOptional(raw: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function normalizeOrigin(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    return new URL(input).origin;
  } catch {
    return undefined;
  }
}

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    .trim();
  const protocol =
    forwardedProto || request.nextUrl.protocol.replace(':', '') || 'http';
  const host =
    forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${protocol}://${host}`;
}

function shouldForwardSameOriginAuth(
  request: NextRequest,
  targetUrl: string,
): boolean {
  try {
    const target = new URL(targetUrl);
    if (target.origin !== getRequestOrigin(request)) {
      return false;
    }
    return target.pathname.startsWith('/api/');
  } catch {
    return false;
  }
}

function buildDockerInternalFetchUrl(
  request: NextRequest,
  targetUrl: string,
): string {
  if (process.env.DOCKER_ENV !== 'true') {
    return targetUrl;
  }

  try {
    const target = new URL(targetUrl);
    if (
      target.origin !== getRequestOrigin(request) ||
      !target.pathname.startsWith('/api/')
    ) {
      return targetUrl;
    }

    const internal = new URL(target.toString());
    internal.protocol = 'http:';
    internal.hostname = '127.0.0.1';
    internal.port = process.env.PORT || '3000';
    internal.username = '';
    internal.password = '';
    return internal.toString();
  } catch {
    return targetUrl;
  }
}

function toAbsoluteReferer(input: string | undefined): string | undefined {
  if (!input) return undefined;
  try {
    const parsed = new URL(input);
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function buildHeaderVariants(
  targetUrl: string,
  explicitReferer?: string,
  explicitOrigin?: string,
): HeaderVariant[] {
  const targetOrigin = normalizeOrigin(targetUrl);
  const referer = toAbsoluteReferer(explicitReferer);
  const refererOrigin = normalizeOrigin(referer);
  const origin = normalizeOrigin(explicitOrigin);

  const variants: HeaderVariant[] = [];
  const seen = new Set<string>();

  const push = (variant: HeaderVariant) => {
    const key = `${variant.referer || ''}|${variant.origin || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(variant);
  };

  if (referer && origin) {
    push({
      referer,
      origin,
    });
  }

  if (referer) {
    push({
      referer,
    });
  }

  if (origin) {
    push({
      origin,
    });
  }

  if (referer && refererOrigin && refererOrigin !== origin) {
    push({
      referer,
      origin: refererOrigin,
    });
  }

  if (targetOrigin) {
    push({
      referer: `${targetOrigin}/`,
    });

    push({
      referer: `${targetOrigin}/`,
      origin: targetOrigin,
    });

    push({
      origin: targetOrigin,
    });
  }

  push({});
  return variants;
}

function buildRequestHeaders(
  request: NextRequest,
  options: {
    targetUrl: string;
    userAgent?: string;
    playlist?: boolean;
    variant: HeaderVariant;
  },
): Headers {
  const headers = new Headers(DEFAULT_HEADERS);
  const range = request.headers.get('range');
  if (range) {
    headers.set('Range', range);
  }

  const userAgent = options.userAgent?.trim();
  if (userAgent) {
    headers.set('User-Agent', userAgent);
  }

  if (options.playlist) {
    headers.set(
      'Accept',
      'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*',
    );
  }

  if (options.variant.referer) {
    headers.set('Referer', options.variant.referer);
  } else {
    headers.delete('Referer');
  }

  if (options.variant.origin) {
    headers.set('Origin', options.variant.origin);
  } else {
    headers.delete('Origin');
  }

  if (shouldForwardSameOriginAuth(request, options.targetUrl)) {
    const cookie = request.headers.get('cookie');
    if (cookie) {
      headers.set('Cookie', cookie);
    }

    const authorization = request.headers.get('authorization');
    if (authorization) {
      headers.set('Authorization', authorization);
    }
  }

  return headers;
}

async function fetchUpstreamWithFallback(
  request: NextRequest,
  targetUrl: string,
  options: {
    userAgent?: string;
    playlist?: boolean;
    timeoutMs: number;
    variants: HeaderVariant[];
  },
): Promise<{ response: Response | null; error: FetchAttemptError | null }> {
  let lastError: FetchAttemptError | null = null;
  const fetchUrl = buildDockerInternalFetchUrl(request, targetUrl);

  for (const variant of options.variants) {
    const headers = buildRequestHeaders(request, {
      targetUrl,
      userAgent: options.userAgent,
      playlist: options.playlist,
      variant,
    });

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);
      let response: Response;
      try {
        response = await fetch(fetchUrl, {
          method: 'GET',
          headers,
          signal: controller.signal,
          redirect: 'follow',
          cache: 'no-store',
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.ok) {
        return {
          response,
          error: null,
        };
      }

      const details = (await response.text().catch(() => '')).slice(0, 260);
      lastError = {
        status: response.status,
        details,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';
      lastError = {
        status: 0,
        details: isAbort
          ? `Upstream request timeout (${Math.round(options.timeoutMs / 1000)}s)`
          : error instanceof Error
            ? error.message
            : String(error),
      };
    }
  }

  return {
    response: null,
    error: lastError,
  };
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return buildError(401, 'Unauthorized');
  }

  const targetRaw = request.nextUrl.searchParams.get('url');
  if (!targetRaw) {
    return buildError(400, 'Missing url');
  }

  const parsedTarget = parseHttpUrl(targetRaw);
  if (!parsedTarget) {
    return buildError(400, 'Invalid url');
  }

  const referer = normalizeOptional(
    request.nextUrl.searchParams.get('referer'),
  );
  const origin = normalizeOptional(request.nextUrl.searchParams.get('origin'));
  const userAgent = normalizeOptional(
    request.nextUrl.searchParams.get('ua') ||
      request.headers.get('user-agent') ||
      '',
  );
  const playlist = request.nextUrl.searchParams.get('playlist') === '1';
  const timeoutMs = playlist
    ? PLAYLIST_FETCH_TIMEOUT_MS
    : RESOURCE_FETCH_TIMEOUT_MS;

  const variants = buildHeaderVariants(
    parsedTarget.toString(),
    referer,
    origin,
  );
  const { response, error } = await fetchUpstreamWithFallback(
    request,
    parsedTarget.toString(),
    {
      userAgent,
      playlist,
      timeoutMs,
      variants,
    },
  );

  if (!response) {
    const upstreamStatus = error?.status && error.status > 0 ? error.status : 0;
    const message =
      upstreamStatus === 401 || upstreamStatus === 403
        ? `上游资源拒绝访问（${upstreamStatus}），已尝试自动补齐鉴权和防盗链请求头`
        : `Failed to fetch upstream resource (${upstreamStatus})`;
    return buildError(502, message, error?.details);
  }

  const headers = new Headers();
  headers.set(
    'Content-Type',
    response.headers.get('content-type') || 'application/octet-stream',
  );
  headers.set('Cache-Control', 'no-store');
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Accept, Origin, Referer, User-Agent',
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type, X-Upstream-Url',
  );

  if (response.url) {
    headers.set(
      'X-Upstream-Url',
      response.url ===
        buildDockerInternalFetchUrl(request, parsedTarget.toString())
        ? parsedTarget.toString()
        : response.url,
    );
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    headers.set('Content-Length', contentLength);
  }

  const contentRange = response.headers.get('content-range');
  if (contentRange) {
    headers.set('Content-Range', contentRange);
  }

  const acceptRanges = response.headers.get('accept-ranges');
  if (acceptRanges) {
    headers.set('Accept-Ranges', acceptRanges);
  } else {
    headers.set('Accept-Ranges', 'bytes');
  }

  return new Response(response.body, {
    status: response.status,
    headers,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers':
        'Content-Type, Range, Accept, Origin, Referer, User-Agent',
      'Access-Control-Max-Age': '86400',
    },
  });
}
