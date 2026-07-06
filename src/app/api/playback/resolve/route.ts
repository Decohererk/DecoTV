import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import {
  buildFilterProxyUrl,
  isSourceAdFilterDisabled,
  shouldUseServerSideEpisodeProxy,
} from '@/lib/episode-rewriter';
import { resolveExternalPlaybackUrl } from '@/lib/playback-url-resolver';
import { isLikelyHlsUrl } from '@/lib/player/hls-url';

export const runtime = 'nodejs';

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

  if (!rawUrl) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }

  const resolution = await resolveExternalPlaybackUrl(rawUrl);
  let playbackUrl = resolution.resolvedUrl || rawUrl;
  let proxied = false;

  if (source && source !== 'private_library') {
    const apiSites = await getAvailableApiSites(username);
    if (!apiSites.some((site) => site.key === source)) {
      return NextResponse.json(
        { error: 'Source is not available for current user' },
        { status: 403 },
      );
    }
  }

  try {
    const config = await getConfig();
    if (
      source !== 'private_library' &&
      isLikelyHlsUrl(playbackUrl) &&
      shouldUseServerSideEpisodeProxy(config, request) &&
      !isSourceAdFilterDisabled(config, source)
    ) {
      playbackUrl = buildFilterProxyUrl(
        request,
        playbackUrl,
        resolution.referer,
      );
      proxied = playbackUrl !== resolution.resolvedUrl;
    }
  } catch {
    // Keep the resolved direct URL when config lookup fails.
  }

  return NextResponse.json(
    {
      ...resolution,
      playbackUrl,
      proxied,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=60',
      },
    },
  );
}
