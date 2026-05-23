export const POSTER_FALLBACK_SRC = '/poster-fallback.svg';

const DEFAULT_WSRV_WIDTH = 256;
const DEFAULT_DOUBAN_IMAGE_PROXY_TYPE = 'auto';
const TIER1_DIRECT_HOSTS = new Set(['lain.bgm.tv']);
const WSRV_HOSTS = new Set(['wsrv.nl', 'images.weserv.nl']);
const CMLIUSSSS_TENCENT_HOST = 'img.doubanio.cmliussss.net';
const CMLIUSSSS_ALI_HOST = 'img.doubanio.cmliussss.com';
const DOUBAN_IMG3_HOST = 'img3.doubanio.com';
const AUTO_IMAGE_PROVIDER_STORAGE_KEY = 'doubanImageAutoProvider';

export type DoubanImageProxyType =
  | 'auto'
  | 'direct'
  | 'server'
  | 'img3'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'custom';

export interface DoubanImageProxyOverride {
  proxyType?: string;
  proxyUrl?: string;
}

export interface ResolveImageUrlOptions {
  wsrvWidth?: number;
  /**
   * 显式覆盖豆瓣图片代理。SSR 与首次客户端渲染保持一致以避免 hydration 不匹配，
   * 因此调用方应只在 client 端的 effect 中读取 localStorage / RUNTIME_CONFIG
   * 后再传入；不传时回退到 NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_* 环境变量默认值。
   */
  doubanImageProxy?: DoubanImageProxyOverride;
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
  return (
    hostname === 'doubanio.com' ||
    hostname.endsWith('.doubanio.com') ||
    hostname === CMLIUSSSS_TENCENT_HOST ||
    hostname === CMLIUSSSS_ALI_HOST
  );
}

function toWsrvUrl(absoluteUrl: string, wsrvWidth: number): string {
  const sanitizedTarget = absoluteUrl.replace(/^https?:\/\//i, '');
  return `https://wsrv.nl/?url=${encodeURIComponent(sanitizedTarget)}&w=${wsrvWidth}&default=blank`;
}

function getDefaultDoubanImageProxy(): {
  proxyType: string;
  proxyUrl: string;
} {
  return {
    proxyType:
      process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY_TYPE ||
      DEFAULT_DOUBAN_IMAGE_PROXY_TYPE,
    proxyUrl: process.env.NEXT_PUBLIC_DOUBAN_IMAGE_PROXY || '',
  };
}

function getStoredAutoImageProvider(): DoubanImageProxyType | null {
  if (typeof window === 'undefined') return null;

  try {
    const stored = window.localStorage.getItem(AUTO_IMAGE_PROVIDER_STORAGE_KEY);
    if (
      stored === 'img3' ||
      stored === 'cmliussss-cdn-ali' ||
      stored === 'cmliussss-cdn-tencent' ||
      stored === 'server' ||
      stored === 'direct'
    ) {
      return stored;
    }
  } catch {
    // ignore
  }

  return null;
}

export function rememberDoubanImageProvider(src: string): void {
  if (typeof window === 'undefined') return;

  const parsedUrl = toAbsoluteUrl(src);
  let provider: DoubanImageProxyType | null = null;

  if (src.startsWith('/api/image-proxy')) {
    provider = 'server';
  } else if (parsedUrl?.hostname === DOUBAN_IMG3_HOST) {
    provider = 'img3';
  } else if (parsedUrl?.hostname === CMLIUSSSS_ALI_HOST) {
    provider = 'cmliussss-cdn-ali';
  } else if (parsedUrl?.hostname === CMLIUSSSS_TENCENT_HOST) {
    provider = 'cmliussss-cdn-tencent';
  } else if (parsedUrl && isDoubanImageHost(parsedUrl.hostname)) {
    provider = 'direct';
  }

  if (!provider) return;

  try {
    window.localStorage.setItem(AUTO_IMAGE_PROVIDER_STORAGE_KEY, provider);
  } catch {
    // ignore
  }
}

function applyDoubanImageProxy(
  inputUrl: URL,
  proxyType: string,
  proxyUrl: string,
): string {
  const parsedUrl = new URL(inputUrl.toString());
  parsedUrl.protocol = 'https:';

  switch (proxyType as DoubanImageProxyType) {
    case 'auto':
    case 'img3':
      parsedUrl.hostname = DOUBAN_IMG3_HOST;
      return parsedUrl.toString();

    case 'direct':
      return parsedUrl.toString();

    case 'cmliussss-cdn-tencent':
      parsedUrl.hostname = CMLIUSSSS_TENCENT_HOST;
      return parsedUrl.toString();

    case 'cmliussss-cdn-ali':
      parsedUrl.hostname = CMLIUSSSS_ALI_HOST;
      return parsedUrl.toString();

    case 'server':
      return `/api/image-proxy?url=${encodeURIComponent(parsedUrl.toString())}`;

    case 'custom': {
      const trimmed = proxyUrl?.trim() ?? '';
      if (!trimmed) {
        return parsedUrl.toString();
      }
      const target = parsedUrl.toString();
      if (trimmed.includes('{url}')) {
        return trimmed.replace('{url}', encodeURIComponent(target));
      }
      if (trimmed === 'https://cors-anywhere.com/') {
        return `${trimmed}${target}`;
      }
      return `${trimmed}${encodeURIComponent(target)}`;
    }

    default:
      parsedUrl.hostname = DOUBAN_IMG3_HOST;
      return parsedUrl.toString();
  }
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  return urls.filter((url) => {
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

function buildDoubanImageCandidates(
  parsedUrl: URL,
  proxyType: string,
  proxyUrl: string,
): string[] {
  const candidates: string[] = [];

  // 图片代理 fallback：用户指定节点先试，随后按 auto 的稳定优先级逐级降级。
  if (proxyType && proxyType !== 'auto') {
    candidates.push(applyDoubanImageProxy(parsedUrl, proxyType, proxyUrl));
  }

  const storedAutoProvider = getStoredAutoImageProvider();
  if (storedAutoProvider && storedAutoProvider !== proxyType) {
    candidates.push(
      applyDoubanImageProxy(parsedUrl, storedAutoProvider, proxyUrl),
    );
  }

  candidates.push(
    applyDoubanImageProxy(parsedUrl, 'img3', proxyUrl),
    applyDoubanImageProxy(parsedUrl, 'cmliussss-cdn-ali', proxyUrl),
    applyDoubanImageProxy(parsedUrl, 'cmliussss-cdn-tencent', proxyUrl),
    applyDoubanImageProxy(parsedUrl, 'server', proxyUrl),
    applyDoubanImageProxy(parsedUrl, 'direct', proxyUrl),
    POSTER_FALLBACK_SRC,
  );

  return uniqueUrls(candidates);
}

export function resolveImageUrlCandidates(
  originalUrl: string,
  options: ResolveImageUrlOptions = {},
): string[] {
  const trimmed = originalUrl?.trim?.() ?? '';
  if (!trimmed) {
    return [POSTER_FALLBACK_SRC];
  }

  if (
    isRelativeUrl(trimmed) ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed === POSTER_FALLBACK_SRC
      ? [trimmed]
      : [trimmed, POSTER_FALLBACK_SRC];
  }

  const parsedUrl = toAbsoluteUrl(trimmed);
  if (!parsedUrl) {
    return [trimmed, POSTER_FALLBACK_SRC];
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  if (WSRV_HOSTS.has(hostname)) {
    return [parsedUrl.toString(), POSTER_FALLBACK_SRC];
  }

  if (TIER1_DIRECT_HOSTS.has(hostname)) {
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:';
    }
    return [parsedUrl.toString(), POSTER_FALLBACK_SRC];
  }

  if (isDoubanImageHost(hostname)) {
    const defaults = getDefaultDoubanImageProxy();
    const proxyType =
      options.doubanImageProxy?.proxyType?.trim() || defaults.proxyType;
    const proxyUrl =
      options.doubanImageProxy?.proxyUrl ?? defaults.proxyUrl ?? '';
    return buildDoubanImageCandidates(parsedUrl, proxyType, proxyUrl);
  }

  if (isDoubanHost(hostname)) {
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:';
    }
    return [parsedUrl.toString(), POSTER_FALLBACK_SRC];
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return [trimmed, POSTER_FALLBACK_SRC];
  }

  return [
    toWsrvUrl(parsedUrl.toString(), normalizeWsrvWidth(options.wsrvWidth)),
    parsedUrl.toString(),
    POSTER_FALLBACK_SRC,
  ];
}

export function resolveImageUrl(
  originalUrl: string,
  options: ResolveImageUrlOptions = {},
): string {
  return (
    resolveImageUrlCandidates(originalUrl, options)[0] || POSTER_FALLBACK_SRC
  );
}
