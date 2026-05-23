import type { ApiSite } from '@/lib/config';
import {
  fetchWithValidatedRedirects,
  normalizeHeaderUrl,
  validateProxyTargetUrl,
} from '@/lib/proxy-security';

import {
  chooseDefaultHlsVariant,
  DEFAULT_ANDROID_TV_UA,
  getPlaylistBaseUrl,
  hasSuspiciousUrlEncoding,
  inferPlaybackType,
  isHlsUrl,
  parseHlsPlaylist,
  PlaybackHealthResult,
  PlaybackStrategy,
  PlaybackStreamType,
  resolveUrl,
  sanitizeEpisodeUrl,
  scorePlaybackHealth,
  unwrapDecoProxyUrl,
} from './hls-utils';

export interface PlaybackHealthInput {
  source?: string;
  sourceConfig?: Partial<ApiSite>;
  episodeUrl: string;
  strategy?: PlaybackStrategy | 'smart';
  requestOrigin?: string;
  userAgent?: string;
  referer?: string;
  title?: string;
  episodeIndex?: number;
}

const MAX_PLAYLIST_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;

function getHealthTimeoutMs(sourceConfig?: Partial<ApiSite>): number {
  const sourceTimeout = Number(sourceConfig?.timeoutMs);
  if (Number.isFinite(sourceTimeout) && sourceTimeout > 0) {
    return sourceTimeout;
  }
  return Number(process.env.PLAYBACK_HEALTH_TIMEOUT_MS) || 8000;
}

function shouldTestFirstSegment(): boolean {
  const flag = process.env.PLAYBACK_FIRST_SEGMENT_TEST;
  return flag === undefined || flag === 'true' || flag === '1';
}

function getHeaderRecord(headers?: unknown): Record<string, string> {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(headers as Record<string, unknown>)
      .filter(([, value]) => typeof value === 'string' && value.trim())
      .map(([key, value]) => [key, String(value)]),
  );
}

export function buildPlaybackRequestHeaders(input: {
  url: string;
  sourceConfig?: Partial<ApiSite>;
  userAgent?: string;
  referer?: string;
  range?: string;
}): Record<string, string> {
  const sourceHeaders = getHeaderRecord(input.sourceConfig?.headers);
  const headers: Record<string, string> = {
    Accept: '*/*',
    'User-Agent':
      sourceHeaders['User-Agent'] ||
      sourceHeaders['user-agent'] ||
      input.sourceConfig?.ua ||
      input.userAgent ||
      DEFAULT_ANDROID_TV_UA,
    ...sourceHeaders,
  };

  const explicitReferer = normalizeHeaderUrl(
    input.referer || input.sourceConfig?.referer,
  );
  let inferredReferer: string | undefined;
  try {
    inferredReferer = new URL(input.url).origin + '/';
  } catch {
    inferredReferer = undefined;
  }

  const referer = explicitReferer || inferredReferer;
  if (referer && !headers.Referer && !headers.referer) {
    headers.Referer = referer;
  }

  const explicitOrigin =
    input.sourceConfig?.origin ||
    (() => {
      try {
        return referer ? new URL(referer).origin : undefined;
      } catch {
        return undefined;
      }
    })();
  if (explicitOrigin && !headers.Origin && !headers.origin) {
    headers.Origin = explicitOrigin;
  }

  if (input.range) {
    headers.Range = input.range;
  }

  return headers;
}

async function readTextWithLimit(
  response: Response,
  maxBytes = MAX_PLAYLIST_BYTES,
): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error('playlist-too-large');
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
      throw new Error('playlist-too-large');
    }
    text += decoder.decode(value, { stream: true });
  }

  text += decoder.decode();
  return text;
}

function isHtmlPayload(text: string, contentType: string): boolean {
  const trimmed = text.trimStart().slice(0, 100).toLowerCase();
  return (
    contentType.toLowerCase().includes('text/html') ||
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html')
  );
}

function parseContentLength(headers: Headers): number | undefined {
  const value = Number(headers.get('content-length'));
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function detectRuntimeTarget():
  | 'vercel'
  | 'docker'
  | 'node'
  | 'unknown' {
  if (process.env.VERCEL || process.env.NOW_BUILDER) {
    return 'vercel';
  }
  if (process.env.DOCKER_ENV || process.env.IS_DOCKER) {
    return 'docker';
  }
  if (process.env.NODE_ENV === 'production') {
    return 'node';
  }
  return 'unknown';
}

async function fetchPlaylist(input: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
}): Promise<{
  response: Response;
  text: string;
  durationMs: number;
  retryUsed?: boolean;
  debugInfo?: Record<string, unknown>;
}> {
  await validateProxyTargetUrl(input.url);
  const startedAt = Date.now();
  let response: Response | undefined = undefined;
  let text = '';

  const doFetch = async (headers: Record<string, string>) => {
    const res = await fetchWithValidatedRedirects(
      input.url,
      {
        cache: 'no-store',
        headers,
        method: 'GET',
      },
      { timeoutMs: input.timeoutMs, maxRedirects: MAX_REDIRECTS },
    );
    const txt = await readTextWithLimit(res);
    return { res, txt };
  };

  let retryUsed = false;
  let debugInfo: Record<string, unknown> | undefined;

  try {
    const res = await doFetch(input.headers);
    response = res.res;
    text = res.txt;
  } catch (error) {
    // NOTE: 可能是 HTTP 403 引起的读取失败，或者直接 fetch 报错，尝试兜底重试一次
    if (
      error instanceof Error &&
      (error.message.includes('403') || error.message.includes('status 403'))
    ) {
      // 走向 403 兜底重试流程
    } else {
      throw error;
    }
  }

  // 检查是否为 403
  if (!response || response.status === 403) {
    retryUsed = true;
    let urlOrigin = '';
    try {
      urlOrigin = new URL(input.url).origin;
    } catch {
      // ignore
    }

    const retryHeaders: Record<string, string> = {
      ...input.headers,
      'User-Agent': DEFAULT_ANDROID_TV_UA,
      Referer: urlOrigin ? urlOrigin + '/' : input.headers.Referer || '',
    };
    if (urlOrigin) {
      retryHeaders.Origin = urlOrigin;
    }

    debugInfo = {
      attempt1: {
        status: 403,
        contentType: response?.headers.get('content-type') || '',
        snippet: text ? text.slice(0, 120) : '',
        headers: {
          referer: input.headers.Referer || input.headers.referer || '',
          origin: input.headers.Origin || input.headers.origin || '',
          ua: input.headers['User-Agent'] || input.headers['user-agent'] || '',
        },
      },
    };

    const res = await doFetch(retryHeaders);
    response = res.res;
    text = res.txt;
  }

  if (!response) {
    throw new Error('fetch-playlist-failed');
  }

  return {
    response,
    text,
    durationMs: Date.now() - startedAt,
    retryUsed,
    debugInfo,
  };
}

async function testSmallAsset(input: {
  url: string;
  headers: Record<string, string>;
  timeoutMs: number;
  kind: 'key' | 'segment' | 'map' | 'file';
  requestOrigin?: string;
}): Promise<{
  ok: boolean;
  status?: number;
  contentType?: string;
  contentLength?: number;
  acceptRanges?: string;
  timeToFirstByteMs?: number;
  firstChunkBytes?: number;
  reason?: string;
  corsOk?: boolean;
  sampleBytes?: number;
  sampleDurationMs?: number;
  throughputKbps?: number;
}> {
  try {
    await validateProxyTargetUrl(input.url);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'invalid-url',
    };
  }

  const startedAt = Date.now();
  let response: Response;
  const isLargeTest = input.kind === 'segment' || input.kind === 'file';
  // NOTE: 对首个 ts/m4s 分片使用最大 512KB 的吞吐量下载测试
  const rangeHeader = input.kind === 'key' ? 'bytes=0-255' : 'bytes=0-524287';

  try {
    response = await fetchWithValidatedRedirects(
      input.url,
      {
        cache: 'no-store',
        headers: {
          ...input.headers,
          Range: rangeHeader,
        },
        method: 'GET',
      },
      { timeoutMs: input.timeoutMs, maxRedirects: MAX_REDIRECTS },
    );
  } catch (error) {
    return {
      ok: false,
      timeToFirstByteMs: Date.now() - startedAt,
      reason: error instanceof Error ? error.message : 'upstream-fetch-failed',
    };
  }

  const timeToFirstByteMs = Date.now() - startedAt;
  const status = response.status;
  const contentType = response.headers.get('content-type') || undefined;
  const contentLength = parseContentLength(response.headers);
  const acceptRanges = response.headers.get('accept-ranges') || undefined;

  // NOTE: 基于 Access-Control-Allow-Origin 响应头精准判定跨域 CORS
  const allowOrigin = response.headers.get('access-control-allow-origin');
  let corsOk = false;
  if (allowOrigin) {
    const originLower = allowOrigin.trim().toLowerCase();
    if (originLower === '*') {
      corsOk = true;
    } else if (input.requestOrigin) {
      const reqOriginLower = input.requestOrigin.trim().toLowerCase();
      corsOk =
        originLower.includes(reqOriginLower) ||
        reqOriginLower.includes(originLower);
    } else {
      corsOk = true;
    }
  }

  let firstChunkBytes = 0;
  let sampleBytes = 0;
  let sampleDurationMs = 0;

  try {
    const reader = response.body?.getReader();
    if (reader) {
      const readStartedAt = Date.now();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          if (firstChunkBytes === 0) {
            firstChunkBytes = value.byteLength;
          }
          sampleBytes += value.byteLength;
        }
        const now = Date.now();
        sampleDurationMs = now - readStartedAt;
        // NOTE: 最多下载 512KB 或测试达到 2 秒，提前 cancel 中断下载
        if (
          isLargeTest &&
          (sampleBytes >= 512 * 1024 || sampleDurationMs >= 2000)
        ) {
          await reader.cancel().catch(() => undefined);
          break;
        }
      }
    }
  } catch {
    // 捕获可能的中断读取异常，已下载数据仍然有效
  }

  if (sampleDurationMs === 0) {
    sampleDurationMs = Date.now() - startedAt - timeToFirstByteMs;
  }
  if (sampleDurationMs < 1) sampleDurationMs = 1;

  const throughputKbps = Math.round((sampleBytes * 8) / sampleDurationMs);
  const ok = response.ok || status === 206;

  return {
    ok,
    status,
    contentType,
    contentLength,
    acceptRanges,
    timeToFirstByteMs,
    firstChunkBytes,
    reason: ok ? undefined : `HTTP ${status}`,
    corsOk,
    sampleBytes,
    sampleDurationMs,
    throughputKbps,
  };
}

function detectNestedProxy(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host.includes('pz.v88.qzz.io') ||
      host.includes('v88.qzz.io') ||
      host.includes('proxy') ||
      host.includes('jx.')
    );
  } catch {
    return false;
  }
}

function isMixedContentRisk(url: string, requestOrigin?: string): boolean {
  if (!requestOrigin) return false;
  try {
    return (
      new URL(requestOrigin).protocol === 'https:' &&
      new URL(url).protocol === 'http:'
    );
  } catch {
    return false;
  }
}

function recommendedStrategyFor(input: {
  url: string;
  requestOrigin?: string;
  manifestOk: boolean;
  firstSegmentOk: boolean;
  keyOk: boolean;
  strategy?: PlaybackStrategy | 'smart';
  runtime: 'vercel' | 'docker' | 'node' | 'unknown';
  segmentCorsOk: boolean;
}): PlaybackHealthResult['recommendedStrategy'] {
  if (input.strategy === 'direct') return 'direct';
  if (input.strategy === 'manifest-proxy') return 'manifest-proxy';
  if (input.strategy === 'asset-proxy' || input.strategy === 'full-proxy') {
    return 'asset-proxy';
  }

  // 混合内容限制：由于 HTTPS 加载 HTTP 会产生混合内容拦截
  if (isMixedContentRisk(input.url, input.requestOrigin)) {
    if (input.runtime === 'vercel') {
      return 'manifest-proxy'; // Vercel 不中转分片，这里作为妥协
    }
    return 'asset-proxy';
  }

  // 1. 直连：如果所有条件都通过，且分片跨域 CORS 也可读
  if (
    input.manifestOk &&
    input.firstSegmentOk &&
    input.keyOk &&
    input.segmentCorsOk
  ) {
    return 'direct';
  }

  // 2. 仅代理清单 (manifest-proxy)：当分片 CORS 可读，但列表需要服务端代理时
  if (!input.manifestOk && input.segmentCorsOk) {
    return 'manifest-proxy';
  }

  // 3. 分片代理 (asset-proxy)：当分片跨域不可读或首片请求被拦截时
  if (!input.segmentCorsOk || !input.firstSegmentOk || !input.keyOk) {
    // NOTE: Vercel 等 Serverless 平台不中转分片，退回清单代理并由 UI 给予用户警告
    if (input.runtime === 'vercel') {
      return 'manifest-proxy';
    }
    return 'asset-proxy';
  }

  return 'direct';
}

export async function checkPlaybackHealth(
  input: PlaybackHealthInput,
): Promise<PlaybackHealthResult> {
  const rawUrl = input.episodeUrl || '';
  const unwrapped = unwrapDecoProxyUrl(rawUrl);
  const url = sanitizeEpisodeUrl(unwrapped.url);
  const warnings = hasSuspiciousUrlEncoding(rawUrl);
  const timings: Record<string, number> = {};
  const sourceConfig = input.sourceConfig || {};
  const timeoutMs = getHealthTimeoutMs(sourceConfig);
  const nestedProxy = detectNestedProxy(url);
  const runtime = detectRuntimeTarget();

  if (nestedProxy) warnings.push('nested-proxy');
  if (isMixedContentRisk(url, input.requestOrigin))
    warnings.push('mixed-content');

  if (!url) {
    return {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'unknown',
      reason: 'empty-url',
      suggestions: ['播放地址为空，请换源或重新获取详情。'],
      warnings,
      nestedProxy,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'unknown',
      reason: 'invalid-url',
      suggestions: ['播放地址不是合法 URL。'],
      warnings,
      nestedProxy,
    };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'unknown',
      reason: 'unsupported-protocol',
      suggestions: ['仅支持 http/https 播放地址。'],
      warnings,
      nestedProxy,
    };
  }

  const headers = buildPlaybackRequestHeaders({
    url,
    sourceConfig,
    userAgent: input.userAgent,
    referer: input.referer || unwrapped.referer,
  });
  const urlType = inferPlaybackType(url);

  // 非 HLS 源处理 (如 MP4/FLV)
  if (urlType !== 'hls' && !isHlsUrl(url)) {
    const firstSegment = await testSmallAsset({
      url,
      headers,
      timeoutMs,
      kind: urlType === 'mp4' ? 'file' : 'segment',
      requestOrigin: input.requestOrigin,
    });
    const playable = firstSegment.ok && urlType !== 'flv';
    const base: PlaybackHealthResult = {
      ok: playable,
      playable,
      recommendedStrategy: recommendedStrategyFor({
        url,
        requestOrigin: input.requestOrigin,
        manifestOk: true,
        firstSegmentOk: firstSegment.ok,
        keyOk: true,
        strategy: input.strategy,
        runtime,
        segmentCorsOk: Boolean(firstSegment.corsOk),
      }),
      source: input.source,
      urlType,
      firstSegment,
      cors: {
        checkedInBrowser: false,
        reason: 'server-side-only',
        segmentReadable: firstSegment.corsOk,
      },
      timings,
      reason: playable
        ? undefined
        : urlType === 'flv'
          ? 'flv-not-supported'
          : firstSegment.reason || 'asset-failed',
      suggestions:
        urlType === 'flv'
          ? ['当前播放器未启用 flv.js，建议换 mp4/m3u8 源。']
          : firstSegment.ok
            ? []
            : ['媒体文件首段不可访问，请换源或尝试代理。'],
      warnings,
      nestedProxy,
      firstByteMs: firstSegment.timeToFirstByteMs,
      sampleBytes: firstSegment.sampleBytes,
      sampleDurationMs: firstSegment.sampleDurationMs,
      throughputKbps: firstSegment.throughputKbps,
      throughputKBps:
        firstSegment.sampleBytes && firstSegment.sampleDurationMs
          ? Math.round(firstSegment.sampleBytes / firstSegment.sampleDurationMs)
          : undefined,
      corsOk: Boolean(firstSegment.corsOk),
      runtimeTarget: runtime,
      smallAsset: firstSegment,
    };
    const scored = scorePlaybackHealth(base);
    return { ...base, ...scored };
  }

  let manifestResponse: Response;
  let manifestText: string;
  let manifestDurationMs = 0;
  let isRetryUsed = false;
  let retryDebugInfo: Record<string, unknown> | null = null;

  try {
    const manifest = await fetchPlaylist({ url, headers, timeoutMs });
    manifestResponse = manifest.response;
    manifestText = manifest.text;
    manifestDurationMs = manifest.durationMs;
    timings.manifestMs = manifestDurationMs;
    isRetryUsed = Boolean(manifest.retryUsed);
    retryDebugInfo = manifest.debugInfo || null;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'manifest-fetch-failed';
    return {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'hls',
      manifest: {
        ok: false,
        reason,
      },
      cors: {
        checkedInBrowser: false,
        reason: 'server-side-only',
      },
      timings,
      reason,
      suggestions: ['m3u8 列表无法获取，优先尝试列表代理或换源。'],
      warnings,
      nestedProxy,
      ...scorePlaybackHealth({
        playable: false,
        manifest: { ok: false },
        firstSegment: { ok: false },
        nestedProxy,
      }),
    };
  }

  const manifestStatus = manifestResponse.status;
  const manifestContentType =
    manifestResponse.headers.get('content-type') || '';
  const manifestFinalUrl = manifestResponse.url || url;
  const manifestSize = new Blob([manifestText]).size;

  if (!manifestResponse.ok) {
    const base: PlaybackHealthResult = {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'hls',
      manifest: {
        ok: false,
        status: manifestStatus,
        contentType: manifestContentType,
        size: manifestSize,
        finalUrl: manifestFinalUrl,
        reason: `HTTP ${manifestStatus}`,
      },
      cors: { checkedInBrowser: false, reason: 'server-side-only' },
      timings,
      reason: `manifest-http-${manifestStatus}`,
      suggestions:
        manifestStatus === 403
          ? ['源站返回 403 拒绝访问，疑似防盗链或区域封锁。']
          : ['m3u8 返回非 2xx 状态，建议尝试代理或换源。'],
      warnings,
      nestedProxy,
    };
    return { ...base, ...scorePlaybackHealth(base) };
  }

  if (isHtmlPayload(manifestText, manifestContentType)) {
    const base: PlaybackHealthResult = {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'hls',
      manifest: {
        ok: false,
        status: manifestStatus,
        contentType: manifestContentType,
        size: manifestSize,
        finalUrl: manifestFinalUrl,
        reason: 'html-instead-of-m3u8',
      },
      cors: { checkedInBrowser: false, reason: 'server-side-only' },
      timings,
      reason: 'html-instead-of-m3u8',
      suggestions: ['上游返回 HTML 而不是 m3u8，通常是防盗链或源失效。'],
      warnings,
      nestedProxy,
    };
    return { ...base, ...scorePlaybackHealth(base) };
  }

  if (!manifestText.trimStart().startsWith('#EXTM3U')) {
    const base: PlaybackHealthResult = {
      ok: false,
      playable: false,
      recommendedStrategy: 'manifest-proxy',
      source: input.source,
      urlType: 'hls',
      manifest: {
        ok: false,
        status: manifestStatus,
        contentType: manifestContentType,
        size: manifestSize,
        finalUrl: manifestFinalUrl,
        reason: 'not-m3u8',
      },
      cors: { checkedInBrowser: false, reason: 'server-side-only' },
      timings,
      reason: 'not-m3u8',
      suggestions: ['播放列表格式不正确，请换源。'],
      warnings,
      nestedProxy,
    };
    return { ...base, ...scorePlaybackHealth(base) };
  }

  let playlist = parseHlsPlaylist(
    manifestText,
    getPlaylistBaseUrl(manifestFinalUrl),
  );
  let selectedVariant = chooseDefaultHlsVariant(playlist.variants);

  // 如果是 Master Playlist，获取对应的 Media Playlist
  if (playlist.isMaster && selectedVariant?.uri) {
    try {
      const media = await fetchPlaylist({
        url: selectedVariant.uri,
        headers,
        timeoutMs,
      });
      timings.mediaManifestMs = media.durationMs;
      const mediaBaseUrl = getPlaylistBaseUrl(
        media.response.url || selectedVariant.uri,
      );
      const mediaText = media.text;
      if (media.response.ok && mediaText.trimStart().startsWith('#EXTM3U')) {
        playlist = parseHlsPlaylist(mediaText, mediaBaseUrl);
      }
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : 'media-playlist-fetch-failed';
      const base: PlaybackHealthResult = {
        ok: false,
        playable: false,
        recommendedStrategy: 'manifest-proxy',
        source: input.source,
        urlType: 'hls',
        manifest: {
          ok: false,
          status: manifestStatus,
          contentType: manifestContentType,
          size: manifestSize,
          finalUrl: manifestFinalUrl,
          isMaster: true,
          selectedVariant,
          reason,
        },
        cors: { checkedInBrowser: false, reason: 'server-side-only' },
        timings,
        reason,
        suggestions: ['master playlist 可访问，但清晰度子列表不可访问。'],
        warnings,
        nestedProxy,
      };
      return { ...base, ...scorePlaybackHealth(base) };
    }
  }

  // Key 检测
  let keyResult: PlaybackHealthResult['key'] = {
    present: Boolean(playlist.key?.resolvedUri),
  };
  if (playlist.key?.resolvedUri) {
    const keyStartedAt = Date.now();
    const keyAsset = await testSmallAsset({
      url: playlist.key.resolvedUri,
      headers,
      timeoutMs,
      kind: 'key',
      requestOrigin: input.requestOrigin,
    });
    timings.keyMs = Date.now() - keyStartedAt;
    keyResult = {
      present: true,
      ok: keyAsset.ok,
      status: keyAsset.status,
      size: keyAsset.firstChunkBytes || keyAsset.contentLength,
      reason: keyAsset.reason,
    };
  }

  // 首片分片检测
  let firstSegment: PlaybackHealthResult['firstSegment'] & {
    corsOk?: boolean;
    sampleBytes?: number;
    sampleDurationMs?: number;
    throughputKbps?: number;
  } = {
    ok: Boolean(playlist.firstSegmentResolved),
  };
  if (playlist.firstSegmentResolved && shouldTestFirstSegment()) {
    const segmentTest = await testSmallAsset({
      url: playlist.firstSegmentResolved,
      headers,
      timeoutMs,
      kind: 'segment',
      requestOrigin: input.requestOrigin,
    });
    firstSegment = {
      ok: segmentTest.ok,
      status: segmentTest.status,
      contentType: segmentTest.contentType,
      contentLength: segmentTest.contentLength,
      acceptRanges: segmentTest.acceptRanges,
      timeToFirstByteMs: segmentTest.timeToFirstByteMs,
      firstChunkBytes: segmentTest.firstChunkBytes,
      reason: segmentTest.reason,
      corsOk: segmentTest.corsOk,
      sampleBytes: segmentTest.sampleBytes,
      sampleDurationMs: segmentTest.sampleDurationMs,
      throughputKbps: segmentTest.throughputKbps,
    };
    timings.firstSegmentMs = segmentTest.timeToFirstByteMs || 0;
  } else if (!playlist.firstSegmentResolved) {
    firstSegment = {
      ok: false,
      reason: 'first-segment-missing',
    };
  }

  // NOTE: 在这里根据测速结果执行 ABR 智能降级
  const speed = firstSegment.throughputKbps || 0;
  if (playlist.isMaster && speed > 0 && playlist.variants.length > 0) {
    // 筛选出带宽需求 <= 实际吞吐量 80% 的 variants
    const acceptable = playlist.variants.filter((v) => {
      const bw = v.bandwidth || 0;
      return bw === 0 || bw / 1000 <= speed * 0.8;
    });

    if (acceptable.length > 0) {
      selectedVariant = chooseDefaultHlsVariant(acceptable) || acceptable[0];
    } else {
      // 吞吐量过低时强选最低码率以保障流畅播放
      const sortedByBw = [...playlist.variants].sort(
        (a, b) => (a.bandwidth || 0) - (b.bandwidth || 0),
      );
      selectedVariant = sortedByBw[0];
    }
  }

  const selectedVariantBandwidthKbps = selectedVariant?.bandwidth
    ? Math.round(selectedVariant.bandwidth / 1000)
    : undefined;
  const requiredBandwidthKbps = selectedVariantBandwidthKbps
    ? Math.round(selectedVariantBandwidthKbps * 1.2)
    : undefined;

  const manifestOk = true;
  const keyOk = !keyResult.present || Boolean(keyResult.ok);
  const playable = manifestOk && firstSegment.ok && keyOk;
  const segmentCorsOk =
    firstSegment.corsOk === undefined ? true : firstSegment.corsOk;

  const recommendedStrategy = recommendedStrategyFor({
    url,
    requestOrigin: input.requestOrigin,
    manifestOk,
    firstSegmentOk: Boolean(firstSegment.ok),
    keyOk,
    strategy: input.strategy,
    runtime,
    segmentCorsOk,
  });

  // 吞吐量估算播放能力
  const estimatedPlayable = Boolean(
    playable &&
    (!selectedVariantBandwidthKbps ||
      !speed ||
      speed >= selectedVariantBandwidthKbps * 0.4),
  );

  if (runtime === 'vercel' && !segmentCorsOk) {
    warnings.push('vercel-unsuitable-for-segment-proxy');
  }

  const base: PlaybackHealthResult = {
    ok: manifestOk,
    playable,
    recommendedStrategy,
    source: input.source,
    urlType: 'hls' as PlaybackStreamType,
    manifest: {
      ok: true,
      status: manifestStatus,
      contentType: manifestContentType,
      size: manifestSize,
      finalUrl: manifestFinalUrl,
      isMaster: Boolean(playlist.isMaster),
      selectedVariant,
      targetDuration: playlist.targetDuration,
    },
    key: keyResult,
    firstSegment,
    cors: {
      checkedInBrowser: false,
      reason: 'server-side-only',
      manifestReadable: true, // 服务端拉取成功代表跨域在网关处待定，至少可读
      segmentReadable: segmentCorsOk,
    },
    timings,
    reason: playable
      ? undefined
      : !keyOk
        ? 'key-failed'
        : firstSegment.reason || 'segment-failed',
    suggestions: playable
      ? []
      : !keyOk
        ? ['AES key 无法获取，建议尝试分片代理或换源。']
        : ['首个分片无法获取，建议尝试分片代理或换源。'],
    warnings,
    nestedProxy,
    // 注入吞吐量和测速属性
    firstByteMs: firstSegment.timeToFirstByteMs,
    sampleBytes: firstSegment.sampleBytes,
    sampleDurationMs: firstSegment.sampleDurationMs,
    throughputKbps: speed || undefined,
    throughputKBps:
      firstSegment.sampleBytes && firstSegment.sampleDurationMs
        ? Math.round(firstSegment.sampleBytes / firstSegment.sampleDurationMs)
        : undefined,
    estimatedPlayable,
    requiredBandwidthKbps,
    selectedVariantBandwidthKbps,
    corsOk: segmentCorsOk,
    runtimeTarget: runtime,
    smallAsset: firstSegment,
    debug: {
      checkedUrl: url,
      unwrappedProxy: unwrapped.wasProxy ? unwrapped.proxyPath : undefined,
      manifestDurationMs,
      firstSegmentHost: playlist.firstSegmentResolved
        ? new URL(resolveUrl(url, playlist.firstSegmentResolved)).hostname
        : undefined,
      retryUsed: isRetryUsed,
      retryDebugInfo,
      runtime,
    },
  };

  return { ...base, ...scorePlaybackHealth(base) };
}
