import type { ApiSite } from '@/lib/config';
import { buildHlsManifestProxyUrl } from '@/lib/m3u8-proxy';

import {
  inferPlaybackType,
  PlaybackHealthResult,
  PlaybackProxyMode,
  PlaybackStrategy,
  PlaybackStreamType,
  sanitizeEpisodeUrl,
  unwrapDecoProxyUrl,
} from './hls-utils';
import { checkPlaybackHealth } from './stream-health';

export interface ResolvePlayableUrlInput {
  sourceKey?: string;
  sourceName?: string;
  sourceConfig?: Partial<ApiSite>;
  episodeUrl: string;
  title?: string;
  episodeIndex?: number;
  requestOrigin: string;
  userAgent?: string;
  referer?: string;
  proxyMode?: PlaybackProxyMode;
  strategy?: PlaybackStrategy | 'smart';
}

export interface ResolvePlayableUrlOutput {
  finalUrl: string;
  originalUrl: string;
  type: PlaybackStreamType;
  strategy: PlaybackStrategy;
  health?: PlaybackHealthResult;
  warnings: string[];
  debug: Record<string, unknown>;
}

function getDefaultProxyMode(): PlaybackProxyMode {
  const raw = (process.env.NEXT_PUBLIC_PLAYBACK_PROXY_MODE || 'smart').trim();
  if (raw === 'direct' || raw === 'proxy' || raw === 'off') return raw;
  return 'smart';
}

function healthChecksEnabled(): boolean {
  const raw = process.env.PLAYBACK_HEALTH_CHECK;
  return raw === undefined || raw === 'true' || raw === '1';
}

function strategyFromMode(
  mode: PlaybackProxyMode,
  preferred?: PlaybackStrategy | 'smart',
): PlaybackStrategy | 'smart' {
  if (preferred && preferred !== 'smart') return preferred;
  if (mode === 'direct' || mode === 'off') return 'direct';
  if (mode === 'proxy') return 'asset-proxy';
  return 'smart';
}

function buildFinalUrl(input: {
  strategy: PlaybackStrategy;
  originalUrl: string;
  requestOrigin: string;
  sourceKey?: string;
  referer?: string;
}): string {
  switch (input.strategy) {
    case 'manifest-proxy':
      return buildHlsManifestProxyUrl({
        requestOrigin: input.requestOrigin,
        upstreamUrl: input.originalUrl,
        source: input.sourceKey,
        referer: input.referer,
        proxyAssets: false,
      });
    case 'asset-proxy':
    case 'full-proxy':
      return buildHlsManifestProxyUrl({
        requestOrigin: input.requestOrigin,
        upstreamUrl: input.originalUrl,
        source: input.sourceKey,
        referer: input.referer,
        proxyAssets: true,
      });
    case 'native':
    case 'direct':
    default:
      return input.originalUrl;
  }
}

export async function resolvePlayableUrl(
  input: ResolvePlayableUrlInput,
): Promise<ResolvePlayableUrlOutput> {
  const unwrapped = unwrapDecoProxyUrl(input.episodeUrl);
  const originalUrl = sanitizeEpisodeUrl(unwrapped.url);
  const type = inferPlaybackType(originalUrl);
  const warnings: string[] = [];
  if (unwrapped.wasProxy) warnings.push('unwrapped-existing-proxy');

  const mode = input.proxyMode || getDefaultProxyMode();
  const requestedStrategy = strategyFromMode(mode, input.strategy);
  let health: PlaybackHealthResult | undefined;
  let strategy: PlaybackStrategy =
    requestedStrategy === 'smart' ? 'direct' : requestedStrategy;

  if (type === 'flv') {
    strategy = 'direct';
    warnings.push('flv-not-supported-by-default-player');
  } else if (type !== 'hls') {
    strategy = mode === 'proxy' ? 'asset-proxy' : 'direct';
  } else if (mode === 'off' || mode === 'direct') {
    strategy = 'direct';
  } else if (requestedStrategy !== 'smart') {
    strategy = requestedStrategy;
  } else if (healthChecksEnabled()) {
    health = await checkPlaybackHealth({
      source: input.sourceKey,
      sourceConfig: input.sourceConfig,
      episodeUrl: originalUrl,
      requestOrigin: input.requestOrigin,
      userAgent: input.userAgent,
      referer: input.referer || unwrapped.referer,
      title: input.title,
      episodeIndex: input.episodeIndex,
      strategy: 'smart',
    });
    strategy = health.recommendedStrategy;
  }

  if (mode === 'proxy' && type === 'hls') {
    strategy = 'asset-proxy';
  }

  const finalUrl = buildFinalUrl({
    strategy,
    originalUrl,
    requestOrigin: input.requestOrigin,
    sourceKey: input.sourceKey,
    referer: input.referer || unwrapped.referer,
  });

  return {
    finalUrl,
    originalUrl,
    type,
    strategy,
    health,
    warnings,
    debug: {
      proxyMode: mode,
      requestedStrategy,
      sourceName: input.sourceName,
      unwrappedProxyPath: unwrapped.proxyPath,
      // NOTE: 保留诊断面板所需要的解包前后全套 URL 与签名信息
      originalEpisodeUrl: input.episodeUrl,
      unwrappedUrl: originalUrl,
      wasDecoProxy: unwrapped.wasDecoProxy,
      proxyRouteBefore: unwrapped.proxyRoute,
      finalResolvedUrl: finalUrl,
    },
  };
}
