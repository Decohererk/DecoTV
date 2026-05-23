import { getConfig } from './config';
import { getServerCache, setServerCache } from './server-cache';
import type {
  TmdbCreditSet,
  TmdbEpisodeDetail,
  TmdbImageSet,
  TmdbMediaType,
  TmdbMovieDetail,
  TmdbSearchMediaResult,
  TmdbSearchResult,
  TmdbTvDetail,
} from './tmdb.types';

type TmdbProxyType = 'direct' | 'forward' | 'reverse';

interface TmdbRuntimeConfig {
  apiKey: string;
  proxyType: TmdbProxyType;
  proxy: string;
  reverseProxy: string;
}

type TmdbDetail = TmdbMovieDetail | TmdbTvDetail;

interface LanguageFallbackOptions<T> {
  endpoint: string;
  params?: Record<string, string | number | undefined>;
  ttlSeconds?: number;
  isMeaningful?: (data: T) => boolean;
  merge?: (primary: T, fallback: T) => T;
}

export class TmdbError extends Error {
  status?: number;
  code: 'disabled' | 'timeout' | 'network' | 'upstream' | 'invalid_response';

  constructor(message: string, code: TmdbError['code'], status?: number) {
    super(message);
    this.name = 'TmdbError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';
const TMDB_TIMEOUT_MS = 10_000;

async function getTmdbRuntimeConfig(): Promise<TmdbRuntimeConfig> {
  const config = await getConfig();
  const fromConfig = config.TMDBConfig;
  const siteTmdb = config.SiteConfig;

  const apiKey = (fromConfig?.ApiKey || process.env.TMDB_API_KEY || '').trim();
  const reverseProxy = (
    fromConfig?.ReverseProxy ||
    siteTmdb?.TmdbReverseProxy ||
    process.env.TMDB_REVERSE_PROXY ||
    ''
  ).trim();
  const proxy = (
    fromConfig?.Proxy ||
    siteTmdb?.TmdbProxy ||
    process.env.TMDB_PROXY ||
    ''
  ).trim();

  let proxyType: TmdbProxyType = 'direct';
  if (reverseProxy) {
    proxyType = 'reverse';
  } else if (proxy) {
    proxyType = 'forward';
  }

  return {
    apiKey,
    proxyType,
    proxy,
    reverseProxy,
  };
}

export async function isTmdbEnabled(): Promise<boolean> {
  const cfg = await getTmdbRuntimeConfig();
  return Boolean(cfg.apiKey);
}

function buildTmdbBaseUrl(config: TmdbRuntimeConfig): string {
  if (config.proxyType === 'reverse') {
    return `${config.reverseProxy.replace(/\/+$/, '')}/3`;
  }

  return DEFAULT_TMDB_BASE;
}

function buildImageProxyUrl(path: string, size = 'w500'): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const raw = `${TMDB_IMAGE_BASE}/${size}${cleanPath}`;
  return `/api/image-proxy?url=${encodeURIComponent(raw)}`;
}

function createAbortSignal(timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

function buildForwardProxyUrl(proxy: string, targetUrl: string): string {
  const normalizedProxy = proxy.trim();
  if (normalizedProxy.includes('{url}')) {
    return normalizedProxy.replace('{url}', encodeURIComponent(targetUrl));
  }

  return `${normalizedProxy.replace(/\/+$/, '')}?url=${encodeURIComponent(targetUrl)}`;
}

function buildCacheKey(
  endpoint: string,
  language: string,
  params: Record<string, string | number | undefined>,
): string {
  return `tmdb:${endpoint}:${language}:${JSON.stringify(params)}`;
}

function isMeaningfulSearchResult(data: TmdbSearchResult): boolean {
  return Array.isArray(data.results) && data.results.length > 0;
}

function hasMeaningfulDetailFields(detail: TmdbDetail): boolean {
  const title = 'title' in detail ? detail.title : detail.name;
  return Boolean(
    title?.trim() &&
    (detail.overview?.trim() || detail.poster_path || detail.backdrop_path),
  );
}

function mergeMovieDetails(
  primary: TmdbMovieDetail,
  fallback: TmdbMovieDetail,
): TmdbMovieDetail {
  return {
    ...fallback,
    ...primary,
    title: primary.title || fallback.title,
    original_title: primary.original_title || fallback.original_title,
    overview: primary.overview || fallback.overview,
    poster_path: primary.poster_path || fallback.poster_path,
    backdrop_path: primary.backdrop_path || fallback.backdrop_path,
    release_date: primary.release_date || fallback.release_date,
    vote_average: primary.vote_average || fallback.vote_average,
    runtime: primary.runtime || fallback.runtime,
    status: primary.status || fallback.status,
    original_language: primary.original_language || fallback.original_language,
    genres: primary.genres?.length ? primary.genres : fallback.genres,
    production_countries: primary.production_countries?.length
      ? primary.production_countries
      : fallback.production_countries,
    spoken_languages: primary.spoken_languages?.length
      ? primary.spoken_languages
      : fallback.spoken_languages,
  };
}

function mergeTvDetails(
  primary: TmdbTvDetail,
  fallback: TmdbTvDetail,
): TmdbTvDetail {
  return {
    ...fallback,
    ...primary,
    name: primary.name || fallback.name,
    original_name: primary.original_name || fallback.original_name,
    overview: primary.overview || fallback.overview,
    poster_path: primary.poster_path || fallback.poster_path,
    backdrop_path: primary.backdrop_path || fallback.backdrop_path,
    first_air_date: primary.first_air_date || fallback.first_air_date,
    vote_average: primary.vote_average || fallback.vote_average,
    status: primary.status || fallback.status,
    original_language: primary.original_language || fallback.original_language,
    number_of_seasons: primary.number_of_seasons || fallback.number_of_seasons,
    number_of_episodes:
      primary.number_of_episodes || fallback.number_of_episodes,
    episode_run_time:
      primary.episode_run_time?.length > 0
        ? primary.episode_run_time
        : fallback.episode_run_time,
    origin_country:
      primary.origin_country?.length > 0
        ? primary.origin_country
        : fallback.origin_country,
    genres: primary.genres?.length ? primary.genres : fallback.genres,
    production_countries: primary.production_countries?.length
      ? primary.production_countries
      : fallback.production_countries,
    spoken_languages: primary.spoken_languages?.length
      ? primary.spoken_languages
      : fallback.spoken_languages,
  };
}

async function fetchTmdb<T>(
  endpoint: string,
  params: Record<string, string | number | undefined> = {},
  language = 'zh-CN',
  ttlSeconds = 86_400,
): Promise<T> {
  const cfg = await getTmdbRuntimeConfig();
  if (!cfg.apiKey) {
    throw new TmdbError('TMDB is not configured.', 'disabled');
  }

  const cacheKey = buildCacheKey(endpoint, language, params);
  const cached = getServerCache<T>(cacheKey);
  if (cached) {
    return cached;
  }

  const query = new URLSearchParams();
  query.set('api_key', cfg.apiKey);
  query.set('language', language);

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      query.set(key, String(value));
    }
  });

  const base = buildTmdbBaseUrl(cfg);
  const targetUrl = `${base}${endpoint}?${query.toString()}`;
  const requestUrl =
    cfg.proxyType === 'forward' && cfg.proxy
      ? buildForwardProxyUrl(cfg.proxy, targetUrl)
      : targetUrl;
  const { signal, cleanup } = createAbortSignal(TMDB_TIMEOUT_MS);

  try {
    const response = await fetch(requestUrl, {
      signal,
      headers: {
        Accept: 'application/json',
        ...(cfg.proxyType === 'forward' && cfg.proxy
          ? { 'X-TMDB-Target': targetUrl }
          : {}),
      },
    });

    if (!response.ok) {
      throw new TmdbError(
        `TMDB upstream request failed with status ${response.status}.`,
        'upstream',
        response.status,
      );
    }

    const data = (await response.json()) as T;
    setServerCache(cacheKey, data, ttlSeconds);
    return data;
  } catch (error) {
    if (error instanceof TmdbError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new TmdbError('TMDB request timed out.', 'timeout');
    }

    throw new TmdbError('Unable to reach TMDB.', 'network');
  } finally {
    cleanup();
  }
}

async function withLanguageFallback<T>({
  endpoint,
  params = {},
  ttlSeconds = 86_400,
  isMeaningful,
  merge,
}: LanguageFallbackOptions<T>): Promise<T> {
  let zhResult: T | null = null;
  let zhError: unknown = null;

  try {
    zhResult = await fetchTmdb<T>(endpoint, params, 'zh-CN', ttlSeconds);
    if (!isMeaningful || isMeaningful(zhResult)) {
      return zhResult;
    }
  } catch (error) {
    zhError = error;
  }

  try {
    const enResult = await fetchTmdb<T>(endpoint, params, 'en-US', ttlSeconds);
    if (zhResult && merge) {
      return merge(zhResult, enResult);
    }

    return enResult;
  } catch (fallbackError) {
    if (zhResult) {
      return zhResult;
    }

    throw zhError || fallbackError;
  }
}

export function toTmdbPosterUrl(path: string | null, size = 'w500'): string {
  if (!path) {
    return '';
  }

  return buildImageProxyUrl(path, size);
}

export async function tmdbGetMovieDetail(id: number): Promise<TmdbMovieDetail> {
  return withLanguageFallback<TmdbMovieDetail>({
    endpoint: `/movie/${id}`,
    isMeaningful: hasMeaningfulDetailFields,
    merge: mergeMovieDetails,
  });
}

export async function tmdbGetTvDetail(id: number): Promise<TmdbTvDetail> {
  return withLanguageFallback<TmdbTvDetail>({
    endpoint: `/tv/${id}`,
    isMeaningful: hasMeaningfulDetailFields,
    merge: mergeTvDetails,
  });
}

export async function tmdbGetEpisodeDetail(
  tvId: number,
  season: number,
  episode: number,
): Promise<TmdbEpisodeDetail> {
  return withLanguageFallback<TmdbEpisodeDetail>({
    endpoint: `/tv/${tvId}/season/${season}/episode/${episode}`,
    isMeaningful: (data) => Boolean(data.name?.trim() || data.overview?.trim()),
  });
}

export async function tmdbGetCredits(
  mediaType: TmdbMediaType,
  id: number,
): Promise<TmdbCreditSet> {
  return withLanguageFallback<TmdbCreditSet>({
    endpoint: `/${mediaType}/${id}/credits`,
    isMeaningful: (data) => Array.isArray(data.cast) && data.cast.length > 0,
  });
}

export async function tmdbGetImages(
  mediaType: TmdbMediaType,
  id: number,
): Promise<TmdbImageSet> {
  return withLanguageFallback<TmdbImageSet>({
    endpoint: `/${mediaType}/${id}/images`,
    isMeaningful: (data) =>
      (data.posters?.length || 0) > 0 || (data.backdrops?.length || 0) > 0,
  });
}

export async function tmdbGetSimilar(
  mediaType: TmdbMediaType,
  id: number,
): Promise<TmdbSearchResult> {
  return withLanguageFallback<TmdbSearchResult>({
    endpoint: `/${mediaType}/${id}/similar`,
    isMeaningful: isMeaningfulSearchResult,
  });
}

export async function tmdbSearch(
  type: 'movie' | 'tv' | 'multi',
  query: string,
  page = 1,
): Promise<TmdbSearchResult<TmdbSearchMediaResult>> {
  return withLanguageFallback<TmdbSearchResult<TmdbSearchMediaResult>>({
    endpoint: `/search/${type}`,
    params: {
      query,
      page,
    },
    ttlSeconds: 21_600,
    isMeaningful: isMeaningfulSearchResult,
  });
}
