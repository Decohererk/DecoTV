export const POSTER_FALLBACK_SRC = '/poster-fallback.svg';

const DEFAULT_WSRV_WIDTH = 256;
const DOUBAN_DIRECT_HOST = 'img.doubanio.cmliussss.net';
const TIER1_DIRECT_HOSTS = new Set([
  'img.doubanio.cmliussss.net',
  'img.doubanio.cmliussss.com',
  'lain.bgm.tv',
]);
const WSRV_HOSTS = new Set(['wsrv.nl', 'images.weserv.nl']);

export interface ResolveImageUrlOptions {
  wsrvWidth?: number;
}

function normalizeWsrvWidth(width?: number): number {
  if (!Number.isFinite(width) || !width || width <= 0) {
    return DEFAULT_WSRV_WIDTH;
  }
  return Math.round(width);
}

function isRelativeUrl(url: string): boolean {
  return (
    url.startsWith('/') ||
    url.startsWith('./') ||
    url.startsWith('../') ||
    url.startsWith('#')
  );
}

function toAbsoluteUrl(url: string): URL | null {
  const normalized = url.startsWith('//') ? `https:${url}` : url;

  try {
    return new URL(normalized);
  } catch {
    return null;
  }
}

function isDoubanHost(hostname: string): boolean {
  return hostname === 'douban.com' || hostname.endsWith('.douban.com');
}

function isDoubanImageHost(hostname: string): boolean {
  return hostname === 'doubanio.com' || hostname.endsWith('.doubanio.com');
}

function toWsrvUrl(absoluteUrl: string, wsrvWidth: number): string {
  const sanitizedTarget = absoluteUrl.replace(/^https?:\/\//i, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(sanitizedTarget)}&w=${wsrvWidth}&default=blank`;
}

export function resolveImageUrl(
  originalUrl: string,
  options: ResolveImageUrlOptions = {},
): string {
  const trimmed = originalUrl?.trim?.() ?? '';
  if (!trimmed) {
    return POSTER_FALLBACK_SRC;
  }

  if (
    isRelativeUrl(trimmed) ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  const parsedUrl = toAbsoluteUrl(trimmed);
  if (!parsedUrl) {
    return trimmed;
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (WSRV_HOSTS.has(hostname)) {
    return parsedUrl.toString();
  }

  if (TIER1_DIRECT_HOSTS.has(hostname)) {
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:';
    }
    return parsedUrl.toString();
  }

  if (isDoubanImageHost(hostname)) {
    parsedUrl.protocol = 'https:';
    parsedUrl.hostname = DOUBAN_DIRECT_HOST;
    return parsedUrl.toString();
  }

  if (isDoubanHost(hostname)) {
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:';
    }
    return parsedUrl.toString();
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return trimmed;
  }

  return toWsrvUrl(parsedUrl.toString(), normalizeWsrvWidth(options.wsrvWidth));
}
