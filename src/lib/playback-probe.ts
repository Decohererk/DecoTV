import {
  fetchWithValidatedRedirects,
  normalizeHeaderUrl,
  validateProxyTargetUrl,
} from './proxy-security';
import { getEffectiveRequestOrigin } from './request-protocol';

type PlaybackProbeStatus = 'ok' | 'partial' | 'failed';
type PlaybackProbeFailureKind =
  | 'empty'
  | 'timeout'
  | 'resolver'
  | 'manifest'
  | 'fragment'
  | 'media'
  | 'network'
  | 'unsupported'
  | 'unknown';
type PlaybackProbeMediaType = 'hls' | 'file' | 'page' | 'unknown';

export interface PlaybackProbeResult {
  quality: string;
  loadSpeed: string;
  pingTime: number;
  speedKBps?: number;
  startupTimeMs?: number;
  hasError: boolean;
  status: PlaybackProbeStatus;
  message?: string;
  playable?: boolean;
  testedAt: number;
  resolvedUrl?: string;
  mediaType?: PlaybackProbeMediaType;
  failureKind?: PlaybackProbeFailureKind;
}

interface ProbeFetchOptions {
  request: Request;
  timeoutMs: number;
  referer?: string;
}

interface ProbeFetchResponse {
  response: Response;
  elapsedMs: number;
  url: string;
}

interface PlaylistInspection {
  isHls: boolean;
  isMaster: boolean;
  quality: string;
  firstVariantUrl?: string;
  firstSegmentUrl?: string;
}

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const TV_UA =
  'Mozilla/5.0 (Linux; Android 10; AndroidTV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const MAX_REDIRECTS = 3;
const PLAYLIST_MAX_BYTES = 2 * 1024 * 1024;
const MEDIA_PROBE_BYTES = 384 * 1024;
const MAX_PROBE_FETCH_ATTEMPTS = 8;

function qualityFromWidth(width: number): string {
  if (!width || width <= 0) return '未知';
  if (width >= 3840) return '4K';
  if (width >= 2560) return '2K';
  if (width >= 1920) return '1080p';
  if (width >= 1280) return '720p';
  if (width >= 854) return '480p';
  return 'SD';
}

function formatVideoLoadSpeed(speedKBps?: number): string {
  if (!speedKBps || !Number.isFinite(speedKBps) || speedKBps <= 0) {
    return '未知';
  }
  return `${(speedKBps / 1024).toFixed(2)} MB/s`;
}

function buildResult(input: {
  quality?: string;
  pingTime?: number;
  speedKBps?: number;
  startupTimeMs?: number;
  status: PlaybackProbeStatus;
  message?: string;
  playable?: boolean;
  failureKind?: PlaybackProbeFailureKind;
  resolvedUrl?: string;
  mediaType?: PlaybackProbeMediaType;
}): PlaybackProbeResult {
  return {
    quality: input.quality || '未知',
    loadSpeed: formatVideoLoadSpeed(input.speedKBps),
    pingTime: Math.max(0, Math.round(input.pingTime || 0)),
    speedKBps: input.speedKBps,
    startupTimeMs:
      typeof input.startupTimeMs === 'number'
        ? Math.max(0, Math.round(input.startupTimeMs))
        : undefined,
    hasError: input.status === 'failed',
    status: input.status,
    message: input.message,
    playable: input.playable,
    testedAt: Date.now(),
    resolvedUrl: input.resolvedUrl,
    mediaType: input.mediaType,
    failureKind: input.failureKind,
  };
}

function isAbortLikeError(error: unknown): boolean {
  return (
    error instanceof DOMException ||
    (error instanceof Error &&
      /abort|aborted|timeout|timed out/i.test(error.message))
  );
}

function resolveFetchUrl(rawUrl: string, request: Request): URL {
  return new URL(rawUrl, getEffectiveRequestOrigin(request));
}

function isSameOriginUrl(url: URL, request: Request): boolean {
  return url.origin === getEffectiveRequestOrigin(request);
}

function unwrapSameOriginM3u8ProxyUrl(
  rawUrl: string,
  request: Request,
): { url: string; referer?: string } | null {
  try {
    const parsed = resolveFetchUrl(rawUrl, request);
    if (!isSameOriginUrl(parsed, request)) return null;
    if (
      !parsed.pathname.startsWith('/api/proxy/m3u8-filter') &&
      !parsed.pathname.startsWith('/api/proxy/m3u8')
    ) {
      return null;
    }

    const upstreamUrl = parsed.searchParams.get('url');
    if (!upstreamUrl || !/^https?:\/\//i.test(upstreamUrl)) return null;
    return {
      url: upstreamUrl,
      referer: parsed.searchParams.get('referer') || undefined,
    };
  } catch {
    return null;
  }
}

function isRecoverableManifestStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function shouldRetryProbeStatus(status: number): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    isRecoverableManifestStatus(status)
  );
}

function shouldFallbackToDirectManifestStatus(status: number): boolean {
  return (
    status === 401 || status === 403 || isRecoverableManifestStatus(status)
  );
}

function withRequestCookie(headers: Headers, request: Request) {
  const cookie = request.headers.get('cookie');
  if (cookie && !headers.has('cookie')) {
    headers.set('cookie', cookie);
  }
}

function createProbeHeaders(
  options: ProbeFetchOptions,
  initHeaders?: RequestInit['headers'],
  overrides?: {
    referer?: string;
    userAgent?: string;
    includeOrigin?: boolean;
  },
) {
  const headers = new Headers(initHeaders);
  if (!headers.has('User-Agent')) {
    headers.set(
      'User-Agent',
      overrides?.userAgent ||
        options.request.headers.get('user-agent') ||
        DEFAULT_UA,
    );
  }
  const referer = overrides?.referer || options.referer;
  if (referer && !headers.has('Referer')) {
    headers.set('Referer', referer);
    if (overrides?.includeOrigin !== false && !headers.has('Origin')) {
      try {
        headers.set('Origin', new URL(referer).origin);
      } catch {
        // ignore invalid referer origins
      }
    }
  }
  return headers;
}

function pushUnique<T>(items: T[], item: T) {
  if (!items.includes(item)) items.push(item);
}

function buildRefererCandidates(
  targetUrl: URL,
  options: ProbeFetchOptions,
): Array<string | undefined> {
  const candidates: Array<string | undefined> = [];
  const explicitReferer = normalizeHeaderUrl(options.referer);
  const inboundReferer = normalizeHeaderUrl(
    options.request.headers.get('referer'),
  );

  pushUnique(candidates, explicitReferer);
  try {
    pushUnique(candidates, targetUrl.origin + '/');
    pushUnique(candidates, new URL('.', targetUrl).toString());
  } catch {
    // ignore invalid URL-derived referers
  }
  pushUnique(candidates, inboundReferer);
  pushUnique(candidates, undefined);

  return candidates;
}

function buildProbeHeaderAttempts(
  targetUrl: URL,
  options: ProbeFetchOptions,
  initHeaders?: RequestInit['headers'],
): Headers[] {
  const attempts: Headers[] = [];
  const seen = new Set<string>();
  const requestUa = options.request.headers.get('user-agent') || DEFAULT_UA;
  const userAgents: string[] = [];

  pushUnique(userAgents, requestUa);
  pushUnique(userAgents, DEFAULT_UA);
  pushUnique(userAgents, TV_UA);

  const pushAttempt = (
    referer: string | undefined,
    userAgent: string,
    includeOrigin: boolean,
  ) => {
    const headers = createProbeHeaders(options, initHeaders, {
      referer,
      userAgent,
      includeOrigin,
    });
    const key = JSON.stringify({
      accept: headers.get('accept'),
      range: headers.get('range'),
      referer: headers.get('referer'),
      origin: headers.get('origin'),
      userAgent: headers.get('user-agent'),
    });
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push(headers);
  };

  pushAttempt(options.referer, requestUa, true);

  for (const referer of buildRefererCandidates(targetUrl, options)) {
    for (const userAgent of userAgents) {
      pushAttempt(referer, userAgent, true);
    }
  }

  for (const referer of buildRefererCandidates(targetUrl, options)) {
    pushAttempt(referer, DEFAULT_UA, false);
  }

  return attempts.slice(0, MAX_PROBE_FETCH_ATTEMPTS);
}

async function fetchSameOriginWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchProbeUrl(
  rawUrl: string,
  init: RequestInit,
  options: ProbeFetchOptions,
): Promise<ProbeFetchResponse> {
  const targetUrl = resolveFetchUrl(rawUrl, options.request);
  const headers = createProbeHeaders(options, init.headers);
  const startedAt = Date.now();

  if (isSameOriginUrl(targetUrl, options.request)) {
    withRequestCookie(headers, options.request);
    const response = await fetchSameOriginWithTimeout(
      targetUrl.toString(),
      {
        ...init,
        headers,
      },
      options.timeoutMs,
    );
    return {
      response,
      elapsedMs: Date.now() - startedAt,
      url: response.url || targetUrl.toString(),
    };
  }

  const validatedUrl = await validateProxyTargetUrl(targetUrl.toString());
  const attempts = buildProbeHeaderAttempts(targetUrl, options, init.headers);
  let lastError: unknown;

  for (let index = 0; index < attempts.length; index++) {
    try {
      const response = await fetchWithValidatedRedirects(
        validatedUrl,
        {
          ...init,
          headers: attempts[index],
        },
        { timeoutMs: options.timeoutMs, maxRedirects: MAX_REDIRECTS },
      );

      if (
        !shouldRetryProbeStatus(response.status) ||
        index === attempts.length - 1
      ) {
        return {
          response,
          elapsedMs: Date.now() - startedAt,
          url: response.url || validatedUrl,
        };
      }

      await response.body?.cancel().catch(() => undefined);
    } catch (error) {
      lastError = error;
      if (index === attempts.length - 1) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('Probe fetch failed');
}

async function readTextWithLimit(response: Response, maxBytes: number) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
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
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error('Playlist too large');
    }

    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

async function readBytesWithLimit(response: Response, maxBytes: number) {
  if (!response.body) return 0;

  const reader = response.body.getReader();
  let received = 0;

  while (received < maxBytes) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
  }

  await reader.cancel().catch(() => undefined);
  return received;
}

function resolvePlaylistUrl(
  baseUrl: string,
  value: string,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function parseResolutionWidth(line: string): number {
  const match = line.match(/\bRESOLUTION=(\d+)x(\d+)/i);
  if (!match) return 0;
  const width = Number(match[1]);
  return Number.isFinite(width) ? width : 0;
}

function extractUriAttribute(line: string): string | undefined {
  const match = line.match(/\bURI=(?:"([^"]+)"|([^,\s]+))/i);
  return match?.[1] || match?.[2] || undefined;
}

export function inspectHlsPlaylist(
  content: string,
  playlistUrl: string,
): PlaylistInspection {
  const lines = content.split(/\r?\n/);
  const isHls = lines.some((line) => line.trim() === '#EXTM3U');
  const variants: string[] = [];
  const segments: string[] = [];
  let maxWidth = 0;
  let pendingVariant = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pendingVariant = true;
      maxWidth = Math.max(maxWidth, parseResolutionWidth(line));
      continue;
    }

    if (
      line.startsWith('#EXT-X-MEDIA:') ||
      line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')
    ) {
      maxWidth = Math.max(maxWidth, parseResolutionWidth(line));
      const uri = extractUriAttribute(line);
      const resolved = uri ? resolvePlaylistUrl(playlistUrl, uri) : undefined;
      if (resolved) variants.push(resolved);
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    const resolved = resolvePlaylistUrl(playlistUrl, line);
    if (!resolved) {
      pendingVariant = false;
      continue;
    }

    if (pendingVariant) {
      variants.push(resolved);
      pendingVariant = false;
    } else {
      segments.push(resolved);
    }
  }

  return {
    isHls,
    isMaster: variants.length > 0,
    quality: qualityFromWidth(maxWidth),
    firstVariantUrl: variants[0],
    firstSegmentUrl: segments[0],
  };
}

function isLikelyHlsContentType(contentType: string | null): boolean {
  const lower = (contentType || '').toLowerCase();
  return (
    lower.includes('mpegurl') ||
    lower.includes('vnd.apple.mpegurl') ||
    lower.includes('x-mpegurl')
  );
}

function isLikelyMediaContentType(contentType: string | null): boolean {
  const lower = (contentType || '').toLowerCase();
  return (
    lower.startsWith('video/') ||
    lower.startsWith('audio/') ||
    lower.includes('octet-stream')
  );
}

function speedFromBytes(
  loadedBytes: number,
  elapsedMs: number,
): number | undefined {
  if (loadedBytes <= 0) return undefined;
  // Sub-millisecond reads (small probes, warm caches, mocked fetches in
  // tests) can report elapsedMs === 0; clamp to 1ms so a successful read
  // always yields a finite speed instead of undefined.
  const effectiveElapsedMs = Math.max(elapsedMs, 1);
  return loadedBytes / 1024 / (effectiveElapsedMs / 1000);
}

async function probeMediaBytes(
  url: string,
  options: ProbeFetchOptions,
  mediaType: PlaybackProbeMediaType,
): Promise<PlaybackProbeResult> {
  const startedAt = Date.now();
  const responseInfo = await fetchProbeUrl(
    url,
    {
      cache: 'no-store',
      headers: {
        Accept: '*/*',
        Range: `bytes=0-${MEDIA_PROBE_BYTES - 1}`,
      },
    },
    options,
  );

  if (!responseInfo.response.ok && responseInfo.response.status !== 206) {
    await responseInfo.response.body?.cancel().catch(() => undefined);
    return buildResult({
      status: 'failed',
      message: `媒体分片不可访问：HTTP ${responseInfo.response.status}`,
      failureKind: 'fragment',
      pingTime: responseInfo.elapsedMs,
      resolvedUrl: url,
      mediaType,
    });
  }

  const readStartedAt = Date.now();
  const loadedBytes = await readBytesWithLimit(
    responseInfo.response,
    MEDIA_PROBE_BYTES,
  );
  const readElapsedMs = Math.max(
    Date.now() - readStartedAt,
    responseInfo.elapsedMs,
  );
  const speedKBps = speedFromBytes(loadedBytes, readElapsedMs);

  if (!loadedBytes) {
    return buildResult({
      status: 'partial',
      message: '媒体地址可访问，但未读取到测速数据',
      failureKind: 'fragment',
      pingTime: responseInfo.elapsedMs,
      playable: true,
      resolvedUrl: url,
      mediaType,
    });
  }

  return buildResult({
    status: 'ok',
    message: '媒体分片可访问',
    pingTime: responseInfo.elapsedMs,
    startupTimeMs: Date.now() - startedAt,
    speedKBps,
    playable: true,
    resolvedUrl: url,
    mediaType,
  });
}

async function probeHlsPlaybackUrl(
  url: string,
  options: ProbeFetchOptions,
): Promise<PlaybackProbeResult> {
  const startedAt = Date.now();
  const playlistInfo = await fetchProbeUrl(
    url,
    {
      cache: 'no-store',
      headers: {
        Accept:
          'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*;q=0.6',
      },
    },
    options,
  );

  if (!playlistInfo.response.ok) {
    await playlistInfo.response.body?.cancel().catch(() => undefined);
    const fallbackTarget = unwrapSameOriginM3u8ProxyUrl(url, options.request);
    if (
      fallbackTarget &&
      shouldFallbackToDirectManifestStatus(playlistInfo.response.status)
    ) {
      try {
        const directResult = await probeHlsPlaybackUrl(fallbackTarget.url, {
          ...options,
          referer: fallbackTarget.referer || options.referer,
        });

        if (directResult.status !== 'failed') {
          return {
            ...directResult,
            message:
              directResult.message || '代理清单异常，直连播放清单验证可用',
            resolvedUrl: fallbackTarget.url,
          };
        }
      } catch {
        // Fall through to a recoverable partial manifest result.
      }
    }

    if (isRecoverableManifestStatus(playlistInfo.response.status)) {
      return buildResult({
        status: 'partial',
        message: `播放清单暂时不可访问：HTTP ${playlistInfo.response.status}，播放时将继续尝试`,
        failureKind: 'manifest',
        pingTime: playlistInfo.elapsedMs,
        playable: false,
        resolvedUrl: url,
        mediaType: 'hls',
      });
    }

    return buildResult({
      status: 'failed',
      message: `播放清单不可访问：HTTP ${playlistInfo.response.status}`,
      failureKind: 'manifest',
      pingTime: playlistInfo.elapsedMs,
      resolvedUrl: url,
      mediaType: 'hls',
    });
  }

  const content = await readTextWithLimit(
    playlistInfo.response,
    PLAYLIST_MAX_BYTES,
  );
  const contentType = playlistInfo.response.headers.get('content-type');
  if (
    !content.trimStart().startsWith('#EXTM3U') &&
    !isLikelyHlsContentType(contentType)
  ) {
    return buildResult({
      status: 'failed',
      message: '上游返回的不是 HLS 播放清单',
      failureKind: 'manifest',
      pingTime: playlistInfo.elapsedMs,
      resolvedUrl: playlistInfo.url || url,
      mediaType: 'hls',
    });
  }

  let inspection = inspectHlsPlaylist(content, playlistInfo.url || url);
  let quality = inspection.quality;
  let mediaPlaylistLatency = playlistInfo.elapsedMs;

  if (inspection.isMaster && inspection.firstVariantUrl) {
    try {
      const variantInfo = await fetchProbeUrl(
        inspection.firstVariantUrl,
        {
          cache: 'no-store',
          headers: {
            Accept:
              'application/vnd.apple.mpegurl,application/x-mpegURL,text/plain,*/*;q=0.6',
          },
        },
        options,
      );
      mediaPlaylistLatency += variantInfo.elapsedMs;

      if (variantInfo.response.ok) {
        const variantContent = await readTextWithLimit(
          variantInfo.response,
          PLAYLIST_MAX_BYTES,
        );
        const variantInspection = inspectHlsPlaylist(
          variantContent,
          variantInfo.url || inspection.firstVariantUrl,
        );
        inspection = {
          ...variantInspection,
          quality: quality !== '未知' ? quality : variantInspection.quality,
        };
      } else {
        await variantInfo.response.body?.cancel().catch(() => undefined);
      }
    } catch {
      // Keep the master playlist result as partial connectivity evidence.
    }
  }

  quality = quality !== '未知' ? quality : inspection.quality;

  if (!inspection.firstSegmentUrl) {
    return buildResult({
      status: 'partial',
      message: '播放清单可访问，未找到首个媒体分片',
      failureKind: 'fragment',
      quality,
      pingTime: mediaPlaylistLatency,
      playable: true,
      resolvedUrl: playlistInfo.url || url,
      mediaType: 'hls',
    });
  }

  try {
    const segmentResult = await probeMediaBytes(
      inspection.firstSegmentUrl,
      options,
      'hls',
    );

    if (segmentResult.status === 'ok') {
      return {
        ...segmentResult,
        quality,
        pingTime: playlistInfo.elapsedMs || segmentResult.pingTime,
        startupTimeMs: Date.now() - startedAt,
        resolvedUrl: playlistInfo.url || url,
        mediaType: 'hls',
      };
    }

    return buildResult({
      status: 'partial',
      message: '播放清单可访问，首片段测速未完成',
      failureKind: 'fragment',
      quality,
      pingTime: playlistInfo.elapsedMs || segmentResult.pingTime,
      playable: true,
      resolvedUrl: playlistInfo.url || url,
      mediaType: 'hls',
    });
  } catch (error) {
    return buildResult({
      status: 'partial',
      message: isAbortLikeError(error)
        ? '播放清单可访问，首片段测速超时'
        : '播放清单可访问，首片段测速失败',
      failureKind: 'fragment',
      quality,
      pingTime: playlistInfo.elapsedMs,
      playable: true,
      resolvedUrl: playlistInfo.url || url,
      mediaType: 'hls',
    });
  }
}

export async function probePlaybackUrl(
  playbackUrl: string,
  options: ProbeFetchOptions & {
    mediaType?: PlaybackProbeMediaType;
  },
): Promise<PlaybackProbeResult> {
  if (!playbackUrl) {
    return buildResult({
      status: 'failed',
      message: '播放地址为空',
      failureKind: 'empty',
      mediaType: 'unknown',
    });
  }

  try {
    if (options.mediaType === 'hls') {
      return await probeHlsPlaybackUrl(playbackUrl, options);
    }

    if (options.mediaType === 'file') {
      return await probeMediaBytes(playbackUrl, options, 'file');
    }

    const responseInfo = await fetchProbeUrl(
      playbackUrl,
      {
        cache: 'no-store',
        headers: {
          Accept:
            'application/vnd.apple.mpegurl,application/x-mpegURL,video/*,audio/*,*/*;q=0.5',
          Range: `bytes=0-${MEDIA_PROBE_BYTES - 1}`,
        },
      },
      options,
    );

    const contentType = responseInfo.response.headers.get('content-type');
    if (
      isLikelyHlsContentType(contentType) ||
      responseInfo.url.toLowerCase().includes('.m3u8')
    ) {
      await responseInfo.response.body?.cancel().catch(() => undefined);
      return await probeHlsPlaybackUrl(
        responseInfo.url || playbackUrl,
        options,
      );
    }

    if (isLikelyMediaContentType(contentType)) {
      if (!responseInfo.response.ok && responseInfo.response.status !== 206) {
        await responseInfo.response.body?.cancel().catch(() => undefined);
        return buildResult({
          status: 'failed',
          message: `媒体地址不可访问：HTTP ${responseInfo.response.status}`,
          failureKind: 'network',
          pingTime: responseInfo.elapsedMs,
          resolvedUrl: playbackUrl,
          mediaType: 'file',
        });
      }

      const readStartedAt = Date.now();
      const loadedBytes = await readBytesWithLimit(
        responseInfo.response,
        MEDIA_PROBE_BYTES,
      );
      const speedKBps = speedFromBytes(
        loadedBytes,
        Math.max(Date.now() - readStartedAt, responseInfo.elapsedMs),
      );

      return buildResult({
        status: loadedBytes > 0 ? 'ok' : 'partial',
        message:
          loadedBytes > 0
            ? '媒体地址可访问'
            : '媒体地址可访问，但未读取到测速数据',
        failureKind: loadedBytes > 0 ? undefined : 'media',
        pingTime: responseInfo.elapsedMs,
        startupTimeMs: loadedBytes > 0 ? responseInfo.elapsedMs : undefined,
        speedKBps,
        playable: true,
        resolvedUrl: responseInfo.url || playbackUrl,
        mediaType: 'file',
      });
    }

    await responseInfo.response.body?.cancel().catch(() => undefined);
    return buildResult({
      status: responseInfo.response.ok ? 'partial' : 'failed',
      message: responseInfo.response.ok
        ? '播放地址可访问，但媒体类型未知'
        : `播放地址不可访问：HTTP ${responseInfo.response.status}`,
      failureKind: responseInfo.response.ok ? 'unknown' : 'network',
      pingTime: responseInfo.elapsedMs,
      playable: responseInfo.response.ok,
      resolvedUrl: responseInfo.url || playbackUrl,
      mediaType: 'unknown',
    });
  } catch (error) {
    const isTimeout = isAbortLikeError(error);
    return buildResult({
      status: isTimeout ? 'partial' : 'failed',
      message: isTimeout ? '预检超时，播放时继续尝试' : '播放源预检失败',
      playable: false,
      failureKind: isTimeout ? 'timeout' : 'network',
      resolvedUrl: playbackUrl,
      mediaType: options.mediaType || 'unknown',
    });
  }
}
