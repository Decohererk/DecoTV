/* eslint-disable no-useless-escape */

import type {
  PrivateLibraryConfig,
  PrivateLibraryConnector,
} from './admin.types';
import { getConfig } from './config';
import { db } from './db';
import { normalizePrivateLibraryConfig } from './private-library-config';
import { getServerCache, setServerCache } from './server-cache';
import {
  isTmdbEnabled,
  tmdbGetMovieDetail,
  tmdbGetTvDetail,
  tmdbSearch,
  toTmdbPosterUrl,
} from './tmdb';

export type PrivateLibraryConnectorType =
  | 'openlist'
  | 'emby'
  | 'jellyfin'
  | 'xiaoya';

export interface PrivateLibraryItem {
  id: string;
  connectorId: string;
  connectorType: PrivateLibraryConnectorType;
  sourceItemId: string;
  title: string;
  searchTitle?: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  streamPath: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
  poster?: string;
  backdrop?: string;
  originalLanguage?: string;
  tmdbRating?: number;
  runtimeMinutes?: number;
  episodeCount?: number;
  seasonCount?: number;
  isAnime?: boolean;
  scannedAt: number;
  sortKey: number;
  embeddedStreamUrl?: string;
}

export interface PrivateLibraryProgressPayload {
  connectorId: string;
  sourceItemId: string;
  event: 'progress' | 'stopped' | 'played';
  positionTicks: number;
  runtimeTicks?: number;
  paused?: boolean;
}

export interface PrivateLibraryProgressResult {
  ok: boolean;
  synced: boolean;
  detail?: string;
}

export interface PrivateLibraryAudioStream {
  index: number;
  displayTitle?: string;
  language?: string;
  codec?: string;
  isDefault: boolean;
}

export class PrivateLibraryError extends Error {
  code:
    | 'invalid_config'
    | 'unauthorized'
    | 'not_found'
    | 'timeout'
    | 'service_unavailable'
    | 'upstream';
  status?: number;

  constructor(
    message: string,
    code: PrivateLibraryError['code'],
    status?: number,
  ) {
    super(message);
    this.name = 'PrivateLibraryError';
    this.code = code;
    this.status = status;
  }
}

interface AlistEntry {
  name: string;
  is_dir: boolean;
  path?: string;
  raw_url?: string;
}

interface AlistListResponse {
  code: number;
  data?: {
    content?: AlistEntry[];
  };
  message?: string;
}

interface AlistGetResponse {
  code: number;
  data?: {
    raw_url?: string;
    content?: string;
    provider?: string;
    sign?: string;
  };
  message?: string;
}

interface AlistOtherResponse {
  code: number;
  data?: unknown;
  message?: string;
}

interface XiaoyaAuthResponse {
  code?: number;
  data?: {
    token?: string;
  };
  token?: string;
  message?: string;
}

interface MediaServerAuthenticationResult {
  AccessToken?: string;
  User?: {
    Id?: string;
    Name?: string;
  };
  SessionInfo?: {
    UserId?: string;
  };
}

interface MediaServerAuthSession {
  accessToken: string;
  userId?: string;
  authorizationHeader: string;
}

interface EmbyMediaStream {
  Type?: string;
  Index?: number;
  DisplayTitle?: string;
  Language?: string;
  Codec?: string;
  IsDefault?: boolean;
}

interface EmbyPlaybackInfoResponse {
  MediaSources?: Array<{
    MediaStreams?: EmbyMediaStream[];
  }>;
  MediaStreams?: EmbyMediaStream[];
}

interface EmbyItemDetailResponse {
  MediaStreams?: EmbyMediaStream[];
}

interface TmdbSearchCandidate {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  original_language?: string;
  origin_country?: string[];
}

interface XiaoyaScanContext {
  title?: string;
  year?: number;
  tmdbId?: number;
  libraryName?: string;
}

const PRIVATE_LIBRARY_CACHE_PREFIX = 'private-lib';
const PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS = 12_000;
const PRIVATE_LIBRARY_SCAN_TIMEOUT_MS = 15_000;
const PRIVATE_LIBRARY_AUTH_CACHE_TTL_SECONDS = 6 * 60 * 60;
const PRIVATE_LIBRARY_HYDRATE_CACHE_TTL_SECONDS = 6 * 60 * 60;
const XIAOYA_AUTH_CACHE_TTL_SECONDS = 48 * 60 * 60;
const PRIVATE_LIBRARY_CLIENT_NAME = 'DecoTV';
const PRIVATE_LIBRARY_CLIENT_DEVICE = 'DecoTV Web';
const PRIVATE_LIBRARY_CLIENT_VERSION = '1.0.0';
const XIAOYA_MAX_SCAN_DEPTH = 8;
const MEDIA_FILE_REGEX = /\.(mkv|mp4|m3u8|mov|avi|flv|ts|strm)$/i;
const OPENLIST_MEDIA_FILE_REGEX = /\.(mkv|mp4|m3u8|mov|avi|flv|ts)$/i;

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => sanitizeString(item)).filter(Boolean);
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

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function mapUpstreamError(
  serviceName: string,
  error: unknown,
): PrivateLibraryError {
  if (error instanceof PrivateLibraryError) {
    return error;
  }

  if (isAbortError(error)) {
    return new PrivateLibraryError(
      `${serviceName} request timed out.`,
      'timeout',
    );
  }

  if (error instanceof Error) {
    return new PrivateLibraryError(
      `${serviceName} is unavailable.`,
      'service_unavailable',
    );
  }

  return new PrivateLibraryError(`${serviceName} request failed.`, 'upstream');
}

function toFriendlyPrivateLibraryMessage(error: unknown): string {
  if (error instanceof PrivateLibraryError) {
    switch (error.code) {
      case 'invalid_config':
        return error.message;
      case 'unauthorized':
        return '鉴权失败，请检查服务地址和连接凭证。';
      case 'not_found':
        return '请求的媒体资源或目录不存在。';
      case 'timeout':
        return '上游服务响应超时，请稍后重试。';
      case 'service_unavailable':
        return '上游服务当前不可用。';
      default:
        return error.message;
    }
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return '私人影库请求失败。';
}

function buildBasicAuth(username?: string, password?: string): string {
  const u = sanitizeString(username);
  const p = sanitizeString(password);
  if (!u || !p) {
    return '';
  }

  return `Basic ${Buffer.from(`${u}:${p}`, 'utf8').toString('base64')}`;
}

function hasCredentialPair(username?: string, password?: string): boolean {
  return Boolean(sanitizeString(username) && sanitizeString(password));
}

function normalizePath(path: string): string {
  const trimmed = sanitizeString(path);
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  return `/${trimmed.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function joinPath(basePath: string, name: string): string {
  const base = normalizePath(basePath);
  const cleanName = sanitizeString(name).replace(/^\/+/, '');
  if (!cleanName) {
    return base;
  }
  if (base === '/') {
    return `/${cleanName}`;
  }
  return `${base}/${cleanName}`;
}

function getPathName(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || '';
}

function stripMediaExtension(name: string): string {
  return sanitizeString(name).replace(
    /\.(mkv|mp4|m3u8|mov|avi|flv|ts|strm)$/i,
    '',
  );
}

function parseTmdbId(input: string): number | undefined {
  const match = input.match(/\{tmdb-(\d+)\}/i);
  if (!match) {
    return undefined;
  }

  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : undefined;
}

function parseYearLike(input: string): number | undefined {
  const match = sanitizeString(input).match(/(19|20)\d{2}/);
  if (!match) {
    return undefined;
  }

  const year = Number(match[0]);
  return Number.isFinite(year) ? year : undefined;
}

function parseTitleYear(input: string): { title: string; year?: number } {
  const cleaned = sanitizeString(input)
    .replace(/\{tmdb-\d+\}/gi, '')
    .trim();
  const match = cleaned.match(
    /^(.*?)(?:[\s._-]*[\[(（]?\s*((?:19|20)\d{2})\s*[\])）]?)?$/,
  );

  if (!match) {
    return { title: cleaned || input };
  }

  const title = sanitizeString(match[1]) || cleaned || input;
  const year = match[2] ? Number(match[2]) : undefined;
  return {
    title,
    year: Number.isFinite(year || NaN) ? year : undefined,
  };
}

function parseEpisodeInfo(pathOrName: string): {
  season?: number;
  episode?: number;
} {
  const match = pathOrName.match(/S(\d{1,2})E(\d{1,2})/i);
  if (!match) {
    return {};
  }

  return {
    season: Number(match[1]),
    episode: Number(match[2]),
  };
}

function parseTick(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function parseAudioStreamIndex(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

function safeJsonParse<T>(value: unknown): T {
  return value as T;
}

async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  serviceName: string,
): Promise<T> {
  const { signal, cleanup } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new PrivateLibraryError(
          `${serviceName} authentication failed.`,
          'unauthorized',
          response.status,
        );
      }

      if (response.status === 404) {
        throw new PrivateLibraryError(
          `${serviceName} resource was not found.`,
          'not_found',
          response.status,
        );
      }

      if (response.status >= 500) {
        throw new PrivateLibraryError(
          `${serviceName} is currently unavailable.`,
          'service_unavailable',
          response.status,
        );
      }

      throw new PrivateLibraryError(
        `${serviceName} request failed with status ${response.status}.`,
        'upstream',
        response.status,
      );
    }

    return safeJsonParse<T>(await response.json());
  } catch (error) {
    throw mapUpstreamError(serviceName, error);
  } finally {
    cleanup();
  }
}

async function fetchTextWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  serviceName: string,
): Promise<string> {
  const { signal, cleanup } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal,
    });

    if (!response.ok) {
      throw new PrivateLibraryError(
        `${serviceName} request failed with status ${response.status}.`,
        'upstream',
        response.status,
      );
    }

    return response.text();
  } catch (error) {
    throw mapUpstreamError(serviceName, error);
  } finally {
    cleanup();
  }
}

async function sendJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  serviceName: string,
): Promise<void> {
  const { signal, cleanup } = createAbortSignal(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal,
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new PrivateLibraryError(
          `${serviceName} authentication failed.`,
          'unauthorized',
          response.status,
        );
      }

      if (response.status === 404) {
        throw new PrivateLibraryError(
          `${serviceName} resource was not found.`,
          'not_found',
          response.status,
        );
      }

      if (response.status >= 500) {
        throw new PrivateLibraryError(
          `${serviceName} is currently unavailable.`,
          'service_unavailable',
          response.status,
        );
      }

      throw new PrivateLibraryError(
        `${serviceName} request failed with status ${response.status}.`,
        'upstream',
        response.status,
      );
    }
  } catch (error) {
    throw mapUpstreamError(serviceName, error);
  } finally {
    cleanup();
  }
}

function getMediaServerDeviceId(connector: PrivateLibraryConnector): string {
  return `decotv-private-${connector.type}-${connector.id}`;
}

function buildMediaBrowserAuthorizationHeader(args: {
  connector: PrivateLibraryConnector;
  token?: string;
  userId?: string;
}): string {
  const parts = [
    `Client="${PRIVATE_LIBRARY_CLIENT_NAME}"`,
    `Device="${PRIVATE_LIBRARY_CLIENT_DEVICE}"`,
    `DeviceId="${getMediaServerDeviceId(args.connector)}"`,
    `Version="${PRIVATE_LIBRARY_CLIENT_VERSION}"`,
  ];

  if (args.userId) {
    parts.unshift(`UserId="${args.userId}"`);
  }

  if (args.token) {
    parts.push(`Token="${args.token}"`);
  }

  return `MediaBrowser ${parts.join(', ')}`;
}

function getMediaServerAuthCacheKey(
  connector: PrivateLibraryConnector,
): string {
  return `${PRIVATE_LIBRARY_CACHE_PREFIX}:${connector.id}:auth:${connector.updatedAt}`;
}

function getXiaoyaAuthCacheKey(connector: PrivateLibraryConnector): string {
  return `${PRIVATE_LIBRARY_CACHE_PREFIX}:${connector.id}:alist-auth:${connector.updatedAt}`;
}

async function resolveXiaoyaToken(
  connector: PrivateLibraryConnector,
  options: { forceRefresh?: boolean } = {},
): Promise<string> {
  const staticToken = sanitizeString(connector.token);
  if (staticToken && !options.forceRefresh) {
    return staticToken;
  }

  const password = sanitizeString(connector.password);
  if (!password) {
    return '';
  }

  const cacheKey = getXiaoyaAuthCacheKey(connector);
  if (!options.forceRefresh) {
    const cached = getServerCache<string>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const usernameCandidates = Array.from(
    new Set(
      [sanitizeString(connector.username), 'guest', '']
        .map((item) => sanitizeString(item))
        .filter((item, index, array) => array.indexOf(item) === index),
    ),
  );

  for (const username of usernameCandidates) {
    try {
      const payload = await fetchJsonWithTimeout<XiaoyaAuthResponse>(
        `${connector.serverUrl}/api/auth/login`,
        {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            username,
            password,
          }),
        },
        PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
        '小雅 Alist',
      );

      const token = sanitizeString(payload.data?.token || payload.token);
      if (token) {
        setServerCache(cacheKey, token, XIAOYA_AUTH_CACHE_TTL_SECONDS);
        return token;
      }
    } catch (error) {
      if (
        error instanceof PrivateLibraryError &&
        error.code === 'unauthorized'
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new PrivateLibraryError(
    '小雅 Alist 登录失败，请检查访问密码。',
    'unauthorized',
  );
}

async function buildAlistHeaders(
  connector: PrivateLibraryConnector,
  options: { forceAuthRefresh?: boolean } = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  if (connector.type === 'xiaoya') {
    const token = await resolveXiaoyaToken(connector, {
      forceRefresh: options.forceAuthRefresh,
    });
    if (token) {
      headers.Authorization = token;
    }
    return headers;
  }

  const token = sanitizeString(connector.token);
  const basic = buildBasicAuth(connector.username, connector.password);
  if (token) {
    headers.Authorization = token.startsWith('Bearer ')
      ? token
      : `Bearer ${token}`;
  }
  if (basic) {
    headers['X-Openlist-Basic'] = basic;
  }

  return headers;
}

function buildMediaServerHeaders(
  connector: PrivateLibraryConnector,
  auth?: MediaServerAuthSession,
): Record<string, string> {
  const token = sanitizeString(auth?.accessToken || connector.token);
  const userId = sanitizeString(auth?.userId || connector.userId);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (token) {
    headers['X-Emby-Token'] = token;
    headers.Authorization = buildMediaBrowserAuthorizationHeader({
      connector,
      token,
      userId: userId || undefined,
    });
    headers['X-Emby-Authorization'] = buildMediaBrowserAuthorizationHeader({
      connector,
      token,
      userId: userId || undefined,
    });
  }

  return headers;
}

async function resolveMediaServerAuth(
  connector: PrivateLibraryConnector,
  options: { forceRefresh?: boolean } = {},
): Promise<MediaServerAuthSession> {
  const staticToken = sanitizeString(connector.token);
  const staticUserId = sanitizeString(connector.userId);
  if (staticToken && !options.forceRefresh) {
    return {
      accessToken: staticToken,
      userId: staticUserId || undefined,
      authorizationHeader: buildMediaBrowserAuthorizationHeader({
        connector,
        token: staticToken,
        userId: staticUserId || undefined,
      }),
    };
  }

  if (!hasCredentialPair(connector.username, connector.password)) {
    throw new PrivateLibraryError(
      'Emby / Jellyfin 需要 API Key，或用户名与密码。',
      'invalid_config',
    );
  }

  const cacheKey = getMediaServerAuthCacheKey(connector);
  if (!options.forceRefresh) {
    const cached = getServerCache<MediaServerAuthSession>(cacheKey);
    if (cached?.accessToken) {
      return cached;
    }
  }

  const authorizationHeader = buildMediaBrowserAuthorizationHeader({
    connector,
  });
  const payload = await fetchJsonWithTimeout<MediaServerAuthenticationResult>(
    `${connector.serverUrl}/Users/AuthenticateByName`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: authorizationHeader,
        'X-Emby-Authorization': authorizationHeader,
      },
      body: JSON.stringify({
        Username: sanitizeString(connector.username),
        Pw: sanitizeString(connector.password),
        Password: sanitizeString(connector.password),
      }),
    },
    PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
    connector.type === 'emby' ? 'Emby' : 'Jellyfin',
  );

  const accessToken = sanitizeString(payload.AccessToken);
  const userId = sanitizeString(
    payload.User?.Id || payload.SessionInfo?.UserId || connector.userId,
  );

  if (!accessToken) {
    throw new PrivateLibraryError(
      `${connector.type === 'emby' ? 'Emby' : 'Jellyfin'} 登录没有返回 AccessToken。`,
      'unauthorized',
    );
  }

  const session: MediaServerAuthSession = {
    accessToken,
    userId: userId || undefined,
    authorizationHeader: buildMediaBrowserAuthorizationHeader({
      connector,
      token: accessToken,
      userId: userId || undefined,
    }),
  };

  setServerCache(cacheKey, session, PRIVATE_LIBRARY_AUTH_CACHE_TTL_SECONDS);
  return session;
}

function getAlistServiceName(type: PrivateLibraryConnectorType): string {
  return type === 'xiaoya' ? '小雅 Alist' : 'OpenList';
}

async function listAlistPath(
  connector: PrivateLibraryConnector,
  path: string,
  options: { forceAuthRefresh?: boolean } = {},
): Promise<AlistEntry[]> {
  const payload = await fetchJsonWithTimeout<AlistListResponse>(
    `${connector.serverUrl}/api/fs/list`,
    {
      method: 'POST',
      headers: await buildAlistHeaders(connector, options),
      body: JSON.stringify({
        path: normalizePath(path),
        refresh: false,
        page: 1,
        per_page: 200,
      }),
    },
    PRIVATE_LIBRARY_SCAN_TIMEOUT_MS,
    getAlistServiceName(connector.type),
  );

  if (payload.code !== 200) {
    throw new PrivateLibraryError(
      payload.message || `${getAlistServiceName(connector.type)} 请求失败。`,
      'upstream',
    );
  }

  return payload.data?.content || [];
}

async function getAlistFileInfo(
  connector: PrivateLibraryConnector,
  path: string,
  options: { forceAuthRefresh?: boolean } = {},
): Promise<AlistGetResponse['data']> {
  const payload = await fetchJsonWithTimeout<AlistGetResponse>(
    `${connector.serverUrl}/api/fs/get`,
    {
      method: 'POST',
      headers: await buildAlistHeaders(connector, options),
      body: JSON.stringify({
        path: normalizePath(path),
      }),
    },
    PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
    getAlistServiceName(connector.type),
  );

  if (payload.code !== 200) {
    throw new PrivateLibraryError(
      payload.message || `${getAlistServiceName(connector.type)} 请求失败。`,
      'upstream',
    );
  }

  return payload.data;
}

function extractFirstHttpUrl(value: unknown): string {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }

    const match = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
    return match?.[0] || '';
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      const url = extractFirstHttpUrl(entry);
      if (url) {
        return url;
      }
    }
    return '';
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const priorityKeys = [
      'url',
      'raw_url',
      'download_url',
      'play_url',
      'preview_url',
      'downloadUrl',
      'playUrl',
      'previewUrl',
    ];

    for (const key of priorityKeys) {
      const url = extractFirstHttpUrl(objectValue[key]);
      if (url) {
        return url;
      }
    }

    for (const entry of Object.values(objectValue)) {
      const url = extractFirstHttpUrl(entry);
      if (url) {
        return url;
      }
    }
  }

  return '';
}

async function readXiaoyaStrmTargetUrl(
  connector: PrivateLibraryConnector,
  path: string,
): Promise<string> {
  const fileInfo = await getAlistFileInfo(connector, path);
  const inlineContent = sanitizeString(fileInfo?.content);
  if (inlineContent) {
    return extractFirstHttpUrl(inlineContent);
  }

  const rawUrl = sanitizeString(fileInfo?.raw_url);
  if (!rawUrl) {
    return '';
  }

  try {
    const text = await fetchTextWithTimeout(
      rawUrl,
      {
        method: 'GET',
        headers: {
          Accept: 'text/plain,*/*',
        },
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      '小雅 Alist',
    );
    return extractFirstHttpUrl(text);
  } catch {
    return '';
  }
}

async function callXiaoyaFsOther(
  connector: PrivateLibraryConnector,
  path: string,
  method: 'video_preview' | 'down_url',
): Promise<string> {
  const payload = await fetchJsonWithTimeout<AlistOtherResponse>(
    `${connector.serverUrl}/api/fs/other`,
    {
      method: 'POST',
      headers: await buildAlistHeaders(connector),
      body: JSON.stringify({
        path: normalizePath(path),
        method,
      }),
    },
    PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
    '小雅 Alist',
  );

  if (payload.code !== 200) {
    return '';
  }

  return extractFirstHttpUrl(payload.data);
}

function extractYearFromDate(value: string | undefined): number | undefined {
  return parseYearLike(value || '');
}

function normalizeLookupTitle(value: string): string {
  return sanitizeString(value)
    .toLowerCase()
    .replace(/\{tmdb-\d+\}/gi, '')

    .replace(/[\s:：·._\-()[\]（）'"“”‘’]/g, '');
}

function selectBestTmdbCandidate(
  candidates: TmdbSearchCandidate[],
  title: string,
  year?: number,
  preferredMediaType?: 'movie' | 'tv',
): TmdbSearchCandidate | undefined {
  const normalizedTitle = normalizeLookupTitle(title);

  const scored = candidates
    .filter((item) => item.media_type === 'movie' || item.media_type === 'tv')
    .map((item) => {
      let score = 0;
      const names = [
        item.title,
        item.name,
        item.original_title,
        item.original_name,
      ]
        .map((entry) => normalizeLookupTitle(entry || ''))
        .filter(Boolean);

      if (names.some((entry) => entry === normalizedTitle)) {
        score += 40;
      } else if (names.some((entry) => entry.includes(normalizedTitle))) {
        score += 18;
      }

      const candidateYear = extractYearFromDate(
        item.release_date || item.first_air_date,
      );
      if (year && candidateYear) {
        if (candidateYear === year) {
          score += 30;
        } else if (Math.abs(candidateYear - year) === 1) {
          score += 12;
        }
      }

      if (preferredMediaType && item.media_type === preferredMediaType) {
        score += 16;
      }

      if (item.poster_path) {
        score += 4;
      }

      return { item, score };
    })
    .sort(
      (left, right) => right.score - left.score || right.item.id - left.item.id,
    );

  return scored[0]?.item;
}

function inferAnime(
  genres: string[],
  originalLanguage?: string,
  originCountries: string[] = [],
): boolean {
  const normalizedGenres = genres.map((item) => item.trim().toLowerCase());
  const hasAnimation =
    normalizedGenres.includes('animation') || normalizedGenres.includes('动画');
  if (!hasAnimation) {
    return false;
  }

  const countries = originCountries.map((item) => item.toUpperCase());
  return originalLanguage === 'ja' || countries.includes('JP');
}

function getHydratedPrivateLibraryItemCacheKey(
  item: PrivateLibraryItem,
): string {
  return [
    'private-library:hydrate',
    item.connectorId,
    item.sourceItemId,
    item.tmdbId || 'none',
    item.mediaType,
    item.year || 'none',
    item.scannedAt,
  ].join(':');
}

export async function hydratePrivateLibraryItem(
  item: PrivateLibraryItem,
): Promise<PrivateLibraryItem> {
  const cacheKey = getHydratedPrivateLibraryItemCacheKey(item);
  const cached = getServerCache<PrivateLibraryItem>(cacheKey);
  if (cached) {
    return cached;
  }

  if (!(await isTmdbEnabled())) {
    return item;
  }

  let effectiveTmdbId = item.tmdbId;
  let effectiveMediaType = item.mediaType;

  if (!effectiveTmdbId) {
    const lookupTitle = item.searchTitle || item.title;
    const results = await tmdbSearch('multi', lookupTitle, 1);
    const candidate = selectBestTmdbCandidate(
      results.results as TmdbSearchCandidate[],
      lookupTitle,
      item.year,
      item.mediaType,
    );

    if (!candidate) {
      setServerCache(cacheKey, item, PRIVATE_LIBRARY_HYDRATE_CACHE_TTL_SECONDS);
      return item;
    }

    effectiveTmdbId = candidate.id;
    effectiveMediaType = candidate.media_type === 'tv' ? 'tv' : 'movie';
  }

  if (!effectiveTmdbId) {
    setServerCache(cacheKey, item, PRIVATE_LIBRARY_HYDRATE_CACHE_TTL_SECONDS);
    return item;
  }

  if (effectiveMediaType === 'movie') {
    const detail = await tmdbGetMovieDetail(effectiveTmdbId);
    const genres = (detail.genres || [])
      .map((genre) => genre.name)
      .filter(Boolean);
    const year = item.year || extractYearFromDate(detail.release_date);

    const hydratedItem: PrivateLibraryItem = {
      ...item,
      tmdbId: effectiveTmdbId,
      mediaType: 'movie',
      title: detail.title || item.title,
      year,
      poster: toTmdbPosterUrl(detail.poster_path) || item.poster,
      backdrop: toTmdbPosterUrl(detail.backdrop_path, 'w780') || item.backdrop,
      overview: detail.overview || item.overview,
      genres: genres.length > 0 ? genres : item.genres,
      originalLanguage: detail.original_language || item.originalLanguage,
      tmdbRating: detail.vote_average || item.tmdbRating,
      runtimeMinutes: detail.runtime || item.runtimeMinutes,
      isAnime: inferAnime(
        genres.length > 0 ? genres : item.genres || [],
        detail.original_language,
        (detail.production_countries || []).map(
          (country) => country.iso_3166_1,
        ),
      ),
    };
    setServerCache(
      cacheKey,
      hydratedItem,
      PRIVATE_LIBRARY_HYDRATE_CACHE_TTL_SECONDS,
    );
    return hydratedItem;
  }

  const detail = await tmdbGetTvDetail(effectiveTmdbId);
  const genres = (detail.genres || [])
    .map((genre) => genre.name)
    .filter(Boolean);
  const runtime =
    Array.isArray(detail.episode_run_time) && detail.episode_run_time.length > 0
      ? detail.episode_run_time[0]
      : item.runtimeMinutes;

  const hydratedItem: PrivateLibraryItem = {
    ...item,
    tmdbId: effectiveTmdbId,
    mediaType: 'tv',
    title: item.season || item.episode ? item.title : detail.name || item.title,
    year: item.year || extractYearFromDate(detail.first_air_date),
    poster: toTmdbPosterUrl(detail.poster_path) || item.poster,
    backdrop: toTmdbPosterUrl(detail.backdrop_path, 'w780') || item.backdrop,
    overview: detail.overview || item.overview,
    genres: genres.length > 0 ? genres : item.genres,
    originalLanguage: detail.original_language || item.originalLanguage,
    tmdbRating: detail.vote_average || item.tmdbRating,
    runtimeMinutes: runtime,
    episodeCount: detail.number_of_episodes || item.episodeCount,
    seasonCount: detail.number_of_seasons || item.seasonCount,
    isAnime: inferAnime(
      genres.length > 0 ? genres : item.genres || [],
      detail.original_language,
      detail.origin_country || [],
    ),
  };
  setServerCache(
    cacheKey,
    hydratedItem,
    PRIVATE_LIBRARY_HYDRATE_CACHE_TTL_SECONDS,
  );
  return hydratedItem;
}

async function scanOpenList(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  const rootPath = normalizePath(connector.rootPath || '/Media');
  const level1 = await listAlistPath(connector, rootPath);
  const scannedAt = Date.now();
  const items: PrivateLibraryItem[] = [];

  for (const dir of level1) {
    if (!dir.is_dir) {
      continue;
    }

    const dirPath = sanitizeString(dir.path) || joinPath(rootPath, dir.name);
    const tmdbId = parseTmdbId(dir.name);
    const { title, year } = parseTitleYear(dir.name);

    let children: AlistEntry[] = [];
    try {
      children = await listAlistPath(connector, dirPath);
    } catch {
      continue;
    }

    const mediaFiles = children.filter(
      (entry) => !entry.is_dir && OPENLIST_MEDIA_FILE_REGEX.test(entry.name),
    );

    for (const media of mediaFiles) {
      const mediaPath =
        sanitizeString(media.path) || joinPath(dirPath, media.name);
      const { season, episode } = parseEpisodeInfo(`${dirPath}/${media.name}`);
      const mediaType: 'movie' | 'tv' = season || episode ? 'tv' : 'movie';
      const sourceItemId = `${dirPath}::${mediaPath}`;

      items.push({
        id: `${connector.id}:${Buffer.from(sourceItemId).toString('base64url')}`,
        connectorId: connector.id,
        connectorType: connector.type,
        sourceItemId,
        title: season || episode ? stripMediaExtension(media.name) : title,
        searchTitle: title,
        year,
        tmdbId,
        mediaType,
        streamPath: mediaPath,
        season,
        episode,
        scannedAt,
        sortKey: items.length,
      });
    }
  }

  return items;
}

function buildInitialXiaoyaContext(
  connector: PrivateLibraryConnector,
  path: string,
): XiaoyaScanContext {
  const normalizedRoot = normalizePath(connector.rootPath || '/');
  const rootName =
    normalizedRoot !== '/' ? sanitizeString(getPathName(normalizedRoot)) : '';
  const normalizedPath = normalizePath(path);
  const relativePath =
    normalizedRoot === '/'
      ? normalizedPath
      : normalizedPath.startsWith(normalizedRoot)
        ? normalizedPath.slice(normalizedRoot.length) || '/'
        : normalizedPath;
  const firstSegment = relativePath.split('/').filter(Boolean)[0];

  return {
    libraryName: rootName || sanitizeString(firstSegment),
  };
}

function deriveXiaoyaContext(
  current: XiaoyaScanContext,
  dirName: string,
): XiaoyaScanContext {
  const cleanName = sanitizeString(dirName);
  if (!cleanName) {
    return current;
  }

  if (/^season\s*\d+/i.test(cleanName) || /^第?\d+季$/i.test(cleanName)) {
    return current;
  }

  if (/^(19|20)\d{2}$/.test(cleanName)) {
    return {
      ...current,
      year: current.year || Number(cleanName),
    };
  }

  const tmdbId = parseTmdbId(cleanName);
  const parsed = parseTitleYear(cleanName);

  return {
    ...current,
    title: parsed.title || current.title,
    year: parsed.year || current.year,
    tmdbId: tmdbId || current.tmdbId,
  };
}

async function scanXiaoyaDirectory(
  connector: PrivateLibraryConnector,
  currentPath: string,
  context: XiaoyaScanContext,
  items: PrivateLibraryItem[],
  depth: number,
  scannedAt: number,
): Promise<void> {
  if (depth > XIAOYA_MAX_SCAN_DEPTH) {
    return;
  }

  let entries: AlistEntry[] = [];
  try {
    entries = await listAlistPath(connector, currentPath);
  } catch {
    return;
  }

  const currentDirName = getPathName(currentPath);
  const nextContext = deriveXiaoyaContext(context, currentDirName);

  for (const entry of entries) {
    const entryPath =
      sanitizeString(entry.path) || joinPath(currentPath, entry.name);
    if (entry.is_dir) {
      const childContext = {
        ...nextContext,
        libraryName:
          nextContext.libraryName ||
          buildInitialXiaoyaContext(connector, entryPath).libraryName,
      };
      await scanXiaoyaDirectory(
        connector,
        entryPath,
        childContext,
        items,
        depth + 1,
        scannedAt,
      );
      continue;
    }

    if (!MEDIA_FILE_REGEX.test(entry.name)) {
      continue;
    }

    const { season, episode } = parseEpisodeInfo(
      `${currentPath}/${entry.name}`,
    );
    const mediaType: 'movie' | 'tv' =
      season || episode
        ? 'tv'
        : nextContext.libraryName?.includes('剧')
          ? 'tv'
          : 'movie';
    const title =
      mediaType === 'tv' && (season || episode)
        ? stripMediaExtension(entry.name)
        : nextContext.title || stripMediaExtension(entry.name);
    const embeddedStreamUrl = /\.strm$/i.test(entry.name)
      ? await readXiaoyaStrmTargetUrl(connector, entryPath).catch(() => '')
      : '';

    items.push({
      id: `${connector.id}:${Buffer.from(entryPath).toString('base64url')}`,
      connectorId: connector.id,
      connectorType: connector.type,
      sourceItemId: entryPath,
      title,
      searchTitle: nextContext.title || title,
      year: nextContext.year,
      tmdbId: nextContext.tmdbId,
      mediaType,
      streamPath: entryPath,
      season,
      episode,
      libraryName: nextContext.libraryName,
      scannedAt,
      sortKey: items.length,
      embeddedStreamUrl,
    });
  }
}

async function scanXiaoya(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  const rootPath = normalizePath(connector.rootPath || '/');
  const items: PrivateLibraryItem[] = [];
  const scannedAt = Date.now();

  await scanXiaoyaDirectory(
    connector,
    rootPath,
    buildInitialXiaoyaContext(connector, rootPath),
    items,
    0,
    scannedAt,
  );

  return items;
}

async function scanEmbyLike(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  const auth = await resolveMediaServerAuth(connector);
  const libraryFilter = new Set(
    sanitizeStringArray(connector.libraryFilter).map((item) =>
      item.toLowerCase(),
    ),
  );
  const authQuery = auth.accessToken
    ? `api_key=${encodeURIComponent(auth.accessToken)}`
    : '';
  const payload = await fetchJsonWithTimeout<{
    Items?: Array<{
      Id: string;
      Name: string;
      Type: string;
      ProductionYear?: number;
      CollectionType?: string;
      ProviderIds?: { Tmdb?: string };
      Overview?: string;
      Genres?: string[];
    }>;
  }>(
    `${connector.serverUrl}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds,ProductionYear,CollectionType,Overview,Genres&${authQuery}`,
    {
      headers: buildMediaServerHeaders(connector, auth),
    },
    PRIVATE_LIBRARY_SCAN_TIMEOUT_MS,
    connector.type === 'emby' ? 'Emby' : 'Jellyfin',
  );

  const scannedAt = Date.now();
  const items: PrivateLibraryItem[] = [];
  for (const item of payload.Items || []) {
    if (!item?.Id || !item?.Name) {
      continue;
    }

    if (
      libraryFilter.size > 0 &&
      !libraryFilter.has(sanitizeString(item.CollectionType).toLowerCase())
    ) {
      continue;
    }

    const mediaType: 'movie' | 'tv' = item.Type === 'Series' ? 'tv' : 'movie';
    const tmdbIdRaw = item.ProviderIds?.Tmdb;
    const tmdbId = tmdbIdRaw ? Number(tmdbIdRaw) : undefined;

    items.push({
      id: `${connector.id}:${item.Id}`,
      connectorId: connector.id,
      connectorType: connector.type,
      sourceItemId: item.Id,
      title: item.Name,
      searchTitle: item.Name,
      year: item.ProductionYear,
      tmdbId: Number.isFinite(tmdbId || NaN) ? tmdbId : undefined,
      mediaType,
      streamPath: item.Id,
      overview: sanitizeString(item.Overview),
      genres: sanitizeStringArray(item.Genres),
      libraryName: sanitizeString(item.CollectionType),
      poster: buildPrivateLibraryPosterUrl(connector.id, item.Id),
      scannedAt,
      sortKey: items.length,
    });
  }

  return items;
}

function getConnectorCacheKey(connectorId: string): string {
  return `${PRIVATE_LIBRARY_CACHE_PREFIX}:${connectorId}:items`;
}

export function getPrivateLibraryConnectorTypeLabel(
  type: PrivateLibraryConnectorType,
): string {
  switch (type) {
    case 'emby':
      return 'Emby';
    case 'jellyfin':
      return 'Jellyfin';
    case 'xiaoya':
      return '小雅';
    default:
      return 'OpenList';
  }
}

export function formatPrivateLibrarySourceName(
  connector: Pick<PrivateLibraryConnector, 'type' | 'name' | 'displayName'>,
): string {
  return (
    sanitizeString(connector.displayName) ||
    sanitizeString(connector.name) ||
    getPrivateLibraryConnectorTypeLabel(connector.type)
  );
}

export function buildPrivateLibraryPosterUrl(
  connectorId: string,
  sourceItemId: string,
): string {
  return `/api/private-library/poster?connectorId=${encodeURIComponent(connectorId)}&sourceItemId=${encodeURIComponent(sourceItemId)}`;
}

function buildPrivateProgressKey(
  username: string,
  connectorType: PrivateLibraryConnectorType,
  sourceItemId: string,
): string {
  return `private:progress:${username}:${connectorType}:${sourceItemId}`;
}

function _buildPrivateLibraryItemId(
  connector: Pick<PrivateLibraryConnector, 'id' | 'type'>,
  sourceItemId: string,
): string {
  if (connector.type === 'openlist' || connector.type === 'xiaoya') {
    return `${connector.id}:${Buffer.from(sourceItemId).toString('base64url')}`;
  }

  return `${connector.id}:${sourceItemId}`;
}

export async function scanConnector(
  connector: PrivateLibraryConnector,
): Promise<PrivateLibraryItem[]> {
  let items: PrivateLibraryItem[];

  if (connector.type === 'openlist') {
    items = await scanOpenList(connector);
  } else if (connector.type === 'xiaoya') {
    items = await scanXiaoya(connector);
  } else {
    items = await scanEmbyLike(connector);
  }

  setServerCache(getConnectorCacheKey(connector.id), items, 3600);
  return items;
}

export function getConnectorCachedItems(
  connectorId: string,
): PrivateLibraryItem[] {
  return (
    getServerCache<PrivateLibraryItem[]>(getConnectorCacheKey(connectorId)) ||
    []
  );
}

export async function getPrivateLibraryConfig(): Promise<PrivateLibraryConfig> {
  const config = await getConfig();
  return normalizePrivateLibraryConfig(config.PrivateLibraryConfig);
}

export async function hasEnabledPrivateLibraryConnector(): Promise<boolean> {
  const cfg = await getPrivateLibraryConfig();
  return cfg.connectors.some((item) => item.enabled);
}

export async function testConnector(
  connector: PrivateLibraryConnector,
): Promise<{ ok: boolean; detail?: string }> {
  try {
    if (!sanitizeString(connector.serverUrl)) {
      throw new PrivateLibraryError('服务地址不能为空。', 'invalid_config');
    }

    if (connector.type === 'openlist') {
      await listAlistPath(connector, connector.rootPath || '/Media');
      return { ok: true };
    }

    if (connector.type === 'xiaoya') {
      await listAlistPath(connector, connector.rootPath || '/');
      return { ok: true };
    }

    const auth = await resolveMediaServerAuth(connector);
    const authQuery = auth.accessToken
      ? `api_key=${encodeURIComponent(auth.accessToken)}`
      : '';

    await fetchJsonWithTimeout<{ Items?: unknown[] }>(
      `${connector.serverUrl}/Items?Limit=1&Recursive=false&${authQuery}`,
      {
        headers: buildMediaServerHeaders(connector, auth),
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      connector.type === 'emby' ? 'Emby' : 'Jellyfin',
    );

    return { ok: true };
  } catch (error) {
    if (
      connector.type === 'xiaoya' &&
      error instanceof PrivateLibraryError &&
      error.code === 'unauthorized' &&
      !sanitizeString(connector.password)
    ) {
      return {
        ok: false,
        detail: '小雅 Alist 需要填写访问密码。',
      };
    }

    return {
      ok: false,
      detail: toFriendlyPrivateLibraryMessage(error),
    };
  }
}

async function fetchPlaybackInfoMediaStreams(
  connector: PrivateLibraryConnector,
  auth: MediaServerAuthSession,
  sourceItemId: string,
): Promise<EmbyMediaStream[]> {
  const serviceName = connector.type === 'emby' ? 'Emby' : 'Jellyfin';
  const baseUrl = connector.serverUrl.replace(/\/+$/, '');
  const headers = buildMediaServerHeaders(connector, auth);
  const effectiveUserId = sanitizeString(connector.userId || auth.userId);
  const query = new URLSearchParams();

  if (auth.accessToken) {
    query.set('api_key', auth.accessToken);
  }
  if (effectiveUserId) {
    query.set('UserId', effectiveUserId);
  }

  const playbackInfoUrl = `${baseUrl}/Items/${encodeURIComponent(sourceItemId)}/PlaybackInfo${query.toString() ? `?${query.toString()}` : ''}`;
  const requestBody = {
    UserId: effectiveUserId || undefined,
    StartTimeTicks: 0,
    IsPlayback: true,
    AutoOpenLiveStream: true,
  };

  try {
    const payload = await fetchJsonWithTimeout<EmbyPlaybackInfoResponse>(
      playbackInfoUrl,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      serviceName,
    );

    const streams =
      payload.MediaSources?.[0]?.MediaStreams || payload.MediaStreams || [];
    if (streams.length > 0) {
      return streams;
    }
  } catch {
    // ignore
  }

  try {
    const payload = await fetchJsonWithTimeout<EmbyPlaybackInfoResponse>(
      playbackInfoUrl,
      {
        method: 'GET',
        headers,
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      serviceName,
    );

    const streams =
      payload.MediaSources?.[0]?.MediaStreams || payload.MediaStreams || [];
    if (streams.length > 0) {
      return streams;
    }
  } catch {
    // ignore
  }

  const itemDetailUrl = `${baseUrl}/Items/${encodeURIComponent(sourceItemId)}?Fields=MediaStreams${query.toString() ? `&${query.toString()}` : ''}`;
  const itemDetail = await fetchJsonWithTimeout<EmbyItemDetailResponse>(
    itemDetailUrl,
    {
      method: 'GET',
      headers,
    },
    PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
    serviceName,
  );

  return itemDetail.MediaStreams || [];
}

export async function resolvePrivateLibraryAudioStreams(
  connectorId: string,
  sourceItemId: string,
): Promise<PrivateLibraryAudioStream[]> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === connectorId && item.enabled,
  );

  if (
    !connector ||
    connector.type === 'openlist' ||
    connector.type === 'xiaoya'
  ) {
    return [];
  }

  const auth = await resolveMediaServerAuth(connector);
  const mediaStreams = await fetchPlaybackInfoMediaStreams(
    connector,
    auth,
    sourceItemId,
  );

  return mediaStreams
    .filter((stream) => sanitizeString(stream.Type).toLowerCase() === 'audio')
    .map((stream) => {
      const index = parseAudioStreamIndex(stream.Index);
      if (index === undefined) {
        return null;
      }

      return {
        index,
        displayTitle: sanitizeString(stream.DisplayTitle),
        language: sanitizeString(stream.Language),
        codec: sanitizeString(stream.Codec),
        isDefault: Boolean(stream.IsDefault),
      } as PrivateLibraryAudioStream;
    })
    .filter((stream): stream is PrivateLibraryAudioStream => Boolean(stream))
    .sort((left, right) => left.index - right.index);
}

async function resolveXiaoyaPlaybackUrl(
  connector: PrivateLibraryConnector,
  sourceItemId: string,
): Promise<string> {
  const cachedItems = getConnectorCachedItems(connector.id);
  const cachedItem = cachedItems.find(
    (item) => item.sourceItemId === sourceItemId,
  );
  const fileInfo = await getAlistFileInfo(connector, sourceItemId).catch(
    () => undefined,
  );
  const candidates = [
    await callXiaoyaFsOther(connector, sourceItemId, 'video_preview').catch(
      () => '',
    ),
    await callXiaoyaFsOther(connector, sourceItemId, 'down_url').catch(
      () => '',
    ),
    sanitizeString(cachedItem?.embeddedStreamUrl),
    sanitizeString(fileInfo?.raw_url),
  ];

  const directUrl = candidates.find((item) => /^https?:\/\//i.test(item));
  if (directUrl) {
    return directUrl;
  }

  throw new PrivateLibraryError(
    '该小雅资源暂不支持站内在线播放，请在小雅网页端打开。',
    'upstream',
  );
}

export async function resolveStreamRequest(
  connectorId: string,
  sourceItemId: string,
  audioStreamIndex?: number,
): Promise<{ url: string; headers?: Record<string, string> } | null> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === connectorId && item.enabled,
  );
  if (!connector) {
    return null;
  }

  if (connector.type === 'openlist') {
    const targetPath = sourceItemId.split('::')[1] || sourceItemId;
    const encodedPath = targetPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');

    return {
      url: `${connector.serverUrl}/d${encodedPath.startsWith('/') ? encodedPath : `/${encodedPath}`}`,
      headers: await buildAlistHeaders(connector),
    };
  }

  if (connector.type === 'xiaoya') {
    return {
      url: await resolveXiaoyaPlaybackUrl(connector, sourceItemId),
    };
  }

  const auth = await resolveMediaServerAuth(connector);
  const query = new URLSearchParams();
  query.set('static', 'true');
  if (auth.accessToken) {
    query.set('api_key', auth.accessToken);
  }
  const normalizedAudioStreamIndex = parseAudioStreamIndex(audioStreamIndex);
  if (normalizedAudioStreamIndex !== undefined) {
    query.set('AudioStreamIndex', String(normalizedAudioStreamIndex));
  }

  return {
    url: `${connector.serverUrl}/Videos/${encodeURIComponent(sourceItemId)}/stream?${query.toString()}`,
    headers: buildMediaServerHeaders(connector, auth),
  };
}

export async function resolvePosterRequest(
  connectorId: string,
  sourceItemId: string,
): Promise<{ url: string; headers?: Record<string, string> } | null> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === connectorId && item.enabled,
  );
  if (
    !connector ||
    connector.type === 'openlist' ||
    connector.type === 'xiaoya'
  ) {
    return null;
  }

  const auth = await resolveMediaServerAuth(connector);
  const query = new URLSearchParams();
  query.set('quality', '90');
  query.set('maxWidth', '500');
  if (auth.accessToken) {
    query.set('api_key', auth.accessToken);
  }

  return {
    url: `${connector.serverUrl}/Items/${encodeURIComponent(sourceItemId)}/Images/Primary?${query.toString()}`,
    headers: buildMediaServerHeaders(connector, auth),
  };
}

export async function reportPrivateLibraryProgress(
  username: string,
  payload: PrivateLibraryProgressPayload,
): Promise<PrivateLibraryProgressResult> {
  const cfg = await getPrivateLibraryConfig();
  const connector = cfg.connectors.find(
    (item) => item.id === payload.connectorId && item.enabled,
  );

  if (!connector) {
    return {
      ok: false,
      synced: false,
      detail: 'Private library connector was not found.',
    };
  }

  try {
    const privateProgressKey = buildPrivateProgressKey(
      username,
      connector.type,
      payload.sourceItemId,
    );
    await db.savePlayRecordByKey(username, privateProgressKey, {
      title: payload.sourceItemId,
      source_name: 'private_library',
      cover: '',
      year: '',
      index: 0,
      total_episodes: 0,
      play_time: Math.max(0, Math.floor(payload.positionTicks || 0)),
      total_time: Math.max(0, Math.floor(payload.runtimeTicks || 0)),
      save_time: Date.now(),
      search_title: payload.sourceItemId,
    });
  } catch {
    // ignore internal progress cache failures
  }

  if (connector.type === 'openlist' || connector.type === 'xiaoya') {
    return { ok: true, synced: false };
  }

  const auth = await resolveMediaServerAuth(connector);
  const headers = buildMediaServerHeaders(connector, auth);
  const positionTicks = parseTick(payload.positionTicks);
  const runtimeTicks = parseTick(payload.runtimeTicks);
  const baseUrl = connector.serverUrl.replace(/\/+$/, '');
  const authQuery = auth.accessToken
    ? `?api_key=${encodeURIComponent(auth.accessToken)}`
    : '';
  const effectiveUserId = sanitizeString(connector.userId || auth.userId);
  const body = {
    ItemId: payload.sourceItemId,
    PositionTicks: positionTicks,
    CanSeek: true,
    IsPaused: Boolean(payload.paused),
    PlaybackStartTimeTicks: Date.now() * 10000,
    ...(runtimeTicks > 0 ? { RunTimeTicks: runtimeTicks } : {}),
  };

  const send = async (path: string, initBody?: object) => {
    await sendJsonWithTimeout(
      `${baseUrl}${path}${authQuery}`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(initBody || body),
      },
      PRIVATE_LIBRARY_CONTROL_TIMEOUT_MS,
      connector.type === 'emby' ? 'Emby' : 'Jellyfin',
    );
  };

  try {
    if (payload.event === 'played') {
      if (effectiveUserId) {
        await send(
          `/Users/${encodeURIComponent(effectiveUserId)}/PlayedItems/${encodeURIComponent(payload.sourceItemId)}`,
          {},
        );
      }
      await send('/Sessions/Playing/Stopped');
      return { ok: true, synced: true };
    }

    if (payload.event === 'stopped') {
      await send('/Sessions/Playing/Stopped');
      return { ok: true, synced: true };
    }

    await send('/Sessions/Playing/Progress');
    return { ok: true, synced: true };
  } catch (error) {
    return {
      ok: true,
      synced: false,
      detail: toFriendlyPrivateLibraryMessage(error),
    };
  }
}

export function toPrivateLibraryErrorMessage(error: unknown): string {
  return toFriendlyPrivateLibraryMessage(error);
}
