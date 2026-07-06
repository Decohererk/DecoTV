import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import {
  buildFilterProxyUrl,
  isSourceAdFilterDisabled,
  shouldUseServerSideEpisodeProxy,
} from '@/lib/episode-rewriter';
import { probePlaybackUrl } from '@/lib/playback-probe';
import { resolveExternalPlaybackUrl } from '@/lib/playback-url-resolver';
import { isLikelyHlsUrl } from '@/lib/player/hls-url';
import { getEffectiveRequestOrigin } from '@/lib/request-protocol';

export const runtime = 'nodejs';

const DEFAULT_PROBE_TIMEOUT_MS = 8000;
const MIN_PROBE_TIMEOUT_MS = 2500;
const MAX_PROBE_TIMEOUT_MS = 15000;

function clampProbeTimeout(rawValue: string | null): number {
  const value = Number(rawValue);
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_PROBE_TIMEOUT_MS;
  }
  return Math.max(
    MIN_PROBE_TIMEOUT_MS,
    Math.min(MAX_PROBE_TIMEOUT_MS, Math.round(value)),
  );
}

function buildProbeFailure(input: {
  message: string;
  failureKind:
    | 'empty'
    | 'timeout'
    | 'resolver'
    | 'manifest'
    | 'fragment'
    | 'media'
    | 'network'
    | 'unsupported'
    | 'unknown';
  mediaType?: 'hls' | 'file' | 'page' | 'unknown';
  resolvedUrl?: string;
}) {
  return {
    quality: '未知',
    loadSpeed: '未知',
    pingTime: 0,
    hasError: true,
    status: 'failed',
    message: input.message,
    failureKind: input.failureKind,
    testedAt: Date.now(),
    resolvedUrl: input.resolvedUrl,
    mediaType: input.mediaType || 'unknown',
  };
}

function buildProbePartial(input: {
  message: string;
  failureKind:
    | 'empty'
    | 'timeout'
    | 'resolver'
    | 'manifest'
    | 'fragment'
    | 'media'
    | 'network'
    | 'unsupported'
    | 'unknown';
  mediaType?: 'hls' | 'file' | 'page' | 'unknown';
  resolvedUrl?: string;
}) {
  return {
    quality: '未知',
    loadSpeed: '未知',
    pingTime: 0,
    hasError: false,
    status: 'partial',
    message: input.message,
    playable: false,
    failureKind: input.failureKind,
    testedAt: Date.now(),
    resolvedUrl: input.resolvedUrl,
    mediaType: input.mediaType || 'unknown',
  };
}

function resolveInternalPlaybackUrl(
  request: NextRequest,
  rawUrl: string,
): string | null {
  try {
    const origin = getEffectiveRequestOrigin(request);
    const parsed = new URL(rawUrl, origin);
    if (parsed.origin !== origin) return null;

    if (
      parsed.pathname.startsWith('/api/private-library/') ||
      parsed.pathname.startsWith('/api/proxy/m3u8-filter') ||
      parsed.pathname.startsWith('/api/proxy/m3u8-asset') ||
      parsed.pathname.startsWith('/api/proxy/m3u8')
    ) {
      return parsed.toString();
    }
  } catch {
    if (!/^https?:\/\//i.test(rawUrl)) {
      return new URL(rawUrl, getEffectiveRequestOrigin(request)).toString();
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const username =
    authResult.username || (authResult.isLocalMode ? '__local__' : '');
  const { searchParams } = new URL(request.url);
  const rawUrl = (searchParams.get('url') || '').trim();
  const source = (searchParams.get('source') || '').trim();
  const timeoutMs = clampProbeTimeout(searchParams.get('timeoutMs'));

  if (!rawUrl) {
    return NextResponse.json(
      buildProbeFailure({
        message: '播放地址为空',
        failureKind: 'empty',
      }),
      { status: 400 },
    );
  }

  if (source && source !== 'private_library') {
    const apiSites = await getAvailableApiSites(username);
    if (!apiSites.some((site) => site.key === source)) {
      return NextResponse.json(
        { error: 'Source is not available for current user' },
        { status: 403 },
      );
    }
  }

  const internalPlaybackUrl = resolveInternalPlaybackUrl(request, rawUrl);
  const resolution = internalPlaybackUrl
    ? {
        originalUrl: rawUrl,
        resolvedUrl: internalPlaybackUrl,
        mediaType: isLikelyHlsUrl(internalPlaybackUrl)
          ? ('hls' as const)
          : ('file' as const),
        resolved: false,
        referer: undefined,
        contentType: undefined,
      }
    : await resolveExternalPlaybackUrl(rawUrl);
  let playbackUrl = resolution.resolvedUrl || rawUrl;
  let proxied = false;

  if (!playbackUrl || resolution.mediaType === 'page') {
    return NextResponse.json(
      {
        ...buildProbePartial({
          message:
            resolution.error || '播放页已连通，等待播放时进一步解析媒体地址',
          failureKind: 'resolver',
          mediaType: resolution.mediaType,
          resolvedUrl: playbackUrl || resolution.resolvedUrl,
        }),
        originalUrl: resolution.originalUrl || rawUrl,
        playbackUrl,
        resolved: resolution.resolved,
        proxied,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  try {
    const config = await getConfig();
    if (
      !internalPlaybackUrl &&
      source !== 'private_library' &&
      isLikelyHlsUrl(playbackUrl) &&
      shouldUseServerSideEpisodeProxy(config, request) &&
      !isSourceAdFilterDisabled(config, source)
    ) {
      const proxiedUrl = buildFilterProxyUrl(
        request,
        playbackUrl,
        resolution.referer,
      );
      proxied = proxiedUrl !== playbackUrl;
      playbackUrl = proxiedUrl;
    }
  } catch {
    // Keep the resolved direct URL when config lookup fails.
  }

  const probeResult = await probePlaybackUrl(playbackUrl, {
    request,
    timeoutMs,
    referer: resolution.referer,
    mediaType: resolution.mediaType,
  });

  return NextResponse.json(
    {
      ...probeResult,
      originalUrl: resolution.originalUrl || rawUrl,
      playbackUrl,
      resolvedUrl: playbackUrl || probeResult.resolvedUrl,
      mediaType: probeResult.mediaType || resolution.mediaType,
      resolved: resolution.resolved,
      proxied,
      contentType: resolution.contentType,
      referer: resolution.referer,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
