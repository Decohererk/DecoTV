import { getConfig } from './config';

export type DoubanDataProvider =
  | 'direct'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'cors-proxy-zwei'
  | 'cors-anywhere'
  | 'custom';

export type DoubanProxyMode = DoubanDataProvider | 'auto';

export interface DoubanProxyConfig {
  proxyType: DoubanProxyMode;
  proxyUrl: string;
}

export interface DoubanProviderAttempt {
  provider: DoubanDataProvider;
  ok: boolean;
  status?: number;
  durationMs: number;
  reason?: string;
}

export interface DoubanFetchResult<T> {
  data: T;
  provider: DoubanDataProvider;
  durationMs: number;
  attempts: DoubanProviderAttempt[];
}

type ProviderStats = {
  lastSuccessAt: number;
  durationMs: number;
};

type NegativeCache = {
  until: number;
  reason: string;
};

const DEFAULT_DOUBAN_PROXY_TYPE: DoubanProxyMode = 'auto';
const DEFAULT_TIMEOUT_MS = 4500;
const NEGATIVE_CACHE_TTL_MS = 90 * 1000;
const providerStats = new Map<DoubanDataProvider, ProviderStats>();
const negativeCache = new Map<DoubanDataProvider, NegativeCache>();

const KNOWN_PROXY_TYPES = new Set<string>([
  'auto',
  'server',
  'direct',
  'cmliussss-cdn-tencent',
  'cmliussss-cdn-ali',
  'cors-proxy-zwei',
  'cors-anywhere',
  'custom',
]);

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

export class DoubanFetchError extends Error {
  attempts: DoubanProviderAttempt[];

  constructor(message: string, attempts: DoubanProviderAttempt[]) {
    super(message);
    this.name = 'DoubanFetchError';
    this.attempts = attempts;
  }
}

export function normalizeDoubanProxyType(
  value?: string | null,
): DoubanProxyMode {
  const normalized = (value || '').trim();
  if (normalized === 'server') {
    return 'auto';
  }
  if (KNOWN_PROXY_TYPES.has(normalized)) {
    return normalized as DoubanProxyMode;
  }
  return DEFAULT_DOUBAN_PROXY_TYPE;
}

export async function resolveServerDoubanProxyConfig(
  request?: Request,
): Promise<DoubanProxyConfig> {
  const url = request ? new URL(request.url) : null;
  const queryType = url?.searchParams.get('proxyType');
  const queryProxy = url?.searchParams.get('proxyUrl');

  if (queryType || queryProxy) {
    return {
      proxyType: normalizeDoubanProxyType(queryType),
      proxyUrl: queryProxy || '',
    };
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  let proxyType = process.env.NEXT_PUBLIC_DOUBAN_PROXY_TYPE || 'auto';
  let proxyUrl = process.env.NEXT_PUBLIC_DOUBAN_PROXY || '';

  if (storageType !== 'localstorage') {
    try {
      const config = await getConfig();
      proxyType = config.SiteConfig.DoubanProxyType || proxyType;
      proxyUrl = config.SiteConfig.DoubanProxy || proxyUrl;
    } catch {
      // 读取后台配置失败时回退到环境变量，避免豆瓣接口整体不可用。
    }
  }

  return {
    proxyType: normalizeDoubanProxyType(proxyType),
    proxyUrl,
  };
}

function appendProxyUrl(proxyUrl: string, targetUrl: string): string | null {
  const trimmed = proxyUrl.trim();
  if (!trimmed) return null;

  if (trimmed.includes('{url}')) {
    return trimmed.replace('{url}', encodeURIComponent(targetUrl));
  }

  if (trimmed === 'https://cors-anywhere.com/') {
    return `${trimmed}${targetUrl}`;
  }

  return `${trimmed}${encodeURIComponent(targetUrl)}`;
}

function rewriteDoubanHost(targetUrl: string, provider: DoubanDataProvider) {
  const parsed = new URL(targetUrl);

  if (provider === 'cmliussss-cdn-tencent') {
    if (parsed.hostname === 'm.douban.com') {
      parsed.hostname = 'm.douban.cmliussss.net';
    } else if (parsed.hostname === 'movie.douban.com') {
      parsed.hostname = 'movie.douban.cmliussss.net';
    }
  }

  if (provider === 'cmliussss-cdn-ali') {
    if (parsed.hostname === 'm.douban.com') {
      parsed.hostname = 'm.douban.cmliussss.com';
    } else if (parsed.hostname === 'movie.douban.com') {
      parsed.hostname = 'movie.douban.cmliussss.com';
    }
  }

  return parsed.toString();
}

function resolveProviderUrl(
  targetUrl: string,
  provider: DoubanDataProvider,
  proxyUrl: string,
): string | null {
  switch (provider) {
    case 'direct':
      return targetUrl;
    case 'cmliussss-cdn-tencent':
    case 'cmliussss-cdn-ali':
      return rewriteDoubanHost(targetUrl, provider);
    case 'cors-proxy-zwei':
      return appendProxyUrl('https://ciao-cors.is-an.org/', targetUrl);
    case 'cors-anywhere':
      return appendProxyUrl('https://cors-anywhere.com/', targetUrl);
    case 'custom':
      return appendProxyUrl(proxyUrl, targetUrl);
  }
}

function getDefaultAutoProviders(proxyUrl: string): DoubanDataProvider[] {
  const providers: DoubanDataProvider[] = [];
  if (proxyUrl.trim()) providers.push('custom');
  providers.push(
    'cmliussss-cdn-ali',
    'direct',
    'cmliussss-cdn-tencent',
    'cors-proxy-zwei',
  );
  return providers;
}

function isProviderTemporarilyBad(provider: DoubanDataProvider): boolean {
  const cached = negativeCache.get(provider);
  if (!cached) return false;
  if (Date.now() > cached.until) {
    negativeCache.delete(provider);
    return false;
  }
  return true;
}

function sortProvidersForAuto(
  providers: DoubanDataProvider[],
): DoubanDataProvider[] {
  const available = providers.filter(
    (provider) => !isProviderTemporarilyBad(provider),
  );
  const fallback = available.length > 0 ? available : providers;

  return [...fallback].sort((a, b) => {
    const aStats = providerStats.get(a);
    const bStats = providerStats.get(b);

    if (aStats && bStats) {
      return aStats.durationMs - bStats.durationMs;
    }
    if (aStats) return -1;
    if (bStats) return 1;
    return providers.indexOf(a) - providers.indexOf(b);
  });
}

function getProviderPlan(
  proxyType: DoubanProxyMode,
  proxyUrl: string,
): DoubanDataProvider[] {
  const autoProviders = getDefaultAutoProviders(proxyUrl);

  if (proxyType === 'auto') {
    return sortProvidersForAuto(autoProviders);
  }

  const selected = proxyType as DoubanDataProvider;
  const rest = sortProvidersForAuto(
    autoProviders.filter((provider) => provider !== selected),
  );

  return [selected, ...rest];
}

function recordProviderSuccess(
  provider: DoubanDataProvider,
  durationMs: number,
) {
  providerStats.set(provider, {
    durationMs,
    lastSuccessAt: Date.now(),
  });
  negativeCache.delete(provider);
}

function recordProviderFailure(provider: DoubanDataProvider, reason: string) {
  negativeCache.set(provider, {
    until: Date.now() + NEGATIVE_CACHE_TTL_MS,
    reason,
  });
}

function isLikelyHtml(text: string): boolean {
  const trimmed = text.trimStart().slice(0, 256).toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.includes('<title>') ||
    text.toLowerCase().includes('sec.douban.com')
  );
}

function isAntiSpiderHtml(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes('sec.douban.com') || lower.includes('检测到有异常请求');
}

function getErrorReason(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return 'timeout';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'unknown error';
}

async function fetchFromProvider(
  targetUrl: string,
  provider: DoubanDataProvider,
  proxyUrl: string,
  timeoutMs: number,
): Promise<{
  response: Response;
  text: string;
  durationMs: number;
}> {
  const finalUrl = resolveProviderUrl(targetUrl, provider, proxyUrl);
  if (!finalUrl) {
    throw new Error('missing custom proxy url');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(finalUrl, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://movie.douban.com/',
        Accept: 'application/json, text/plain, text/html, */*',
        Origin: 'https://movie.douban.com',
      },
    });
    const text = await response.text();

    return {
      response,
      text,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchDouban<T>(
  targetUrl: string,
  options: DoubanProxyConfig & {
    timeoutMs?: number;
    responseType: 'json' | 'text';
  },
): Promise<DoubanFetchResult<T>> {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const attempts: DoubanProviderAttempt[] = [];
  const providerPlan = Array.from(
    new Set(getProviderPlan(options.proxyType, options.proxyUrl)),
  );

  // auto provider fallback：每个 provider 独立超时和负缓存，失败后立即尝试下一个节点。
  for (const provider of providerPlan) {
    const startedAt = Date.now();

    try {
      const { response, text, durationMs } = await fetchFromProvider(
        targetUrl,
        provider,
        options.proxyUrl,
        timeoutMs,
      );

      if (!response.ok) {
        const reason =
          response.status === 403 || response.status === 429
            ? `blocked with ${response.status}`
            : `HTTP ${response.status}`;
        attempts.push({
          provider,
          ok: false,
          status: response.status,
          durationMs,
          reason,
        });
        recordProviderFailure(provider, reason);
        continue;
      }

      if (options.responseType === 'json') {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('text/html') || isLikelyHtml(text)) {
          const reason = 'non-json or anti-spider html';
          attempts.push({
            provider,
            ok: false,
            status: response.status,
            durationMs,
            reason,
          });
          recordProviderFailure(provider, reason);
          continue;
        }

        try {
          const data = JSON.parse(text) as T;
          attempts.push({
            provider,
            ok: true,
            status: response.status,
            durationMs,
          });
          recordProviderSuccess(provider, durationMs);
          return { data, provider, durationMs, attempts };
        } catch {
          const reason = 'invalid json';
          attempts.push({
            provider,
            ok: false,
            status: response.status,
            durationMs,
            reason,
          });
          recordProviderFailure(provider, reason);
          continue;
        }
      }

      if (isAntiSpiderHtml(text)) {
        const reason = 'anti-spider html';
        attempts.push({
          provider,
          ok: false,
          status: response.status,
          durationMs,
          reason,
        });
        recordProviderFailure(provider, reason);
        continue;
      }

      if (isLikelyHtml(text) || text.trim()) {
        attempts.push({
          provider,
          ok: true,
          status: response.status,
          durationMs,
        });
        recordProviderSuccess(provider, durationMs);
        return { data: text as T, provider, durationMs, attempts };
      }

      const reason = 'empty response';
      attempts.push({
        provider,
        ok: false,
        status: response.status,
        durationMs,
        reason,
      });
      recordProviderFailure(provider, reason);
    } catch (error) {
      const reason = getErrorReason(error);
      const durationMs = Date.now() - startedAt;
      attempts.push({
        provider,
        ok: false,
        durationMs,
        reason,
      });
      recordProviderFailure(provider, reason);
    }
  }

  throw new DoubanFetchError('所有豆瓣代理节点均不可用', attempts);
}

export function isDoubanFetchError(error: unknown): error is DoubanFetchError {
  return error instanceof DoubanFetchError;
}

export async function fetchDoubanJson<T>(
  targetUrl: string,
  options: DoubanProxyConfig & { timeoutMs?: number },
): Promise<DoubanFetchResult<T>> {
  return fetchDouban<T>(targetUrl, {
    ...options,
    responseType: 'json',
  });
}

export async function fetchDoubanText(
  targetUrl: string,
  options: DoubanProxyConfig & { timeoutMs?: number },
): Promise<DoubanFetchResult<string>> {
  return fetchDouban<string>(targetUrl, {
    ...options,
    responseType: 'text',
  });
}
