export interface ImmediatePlaybackSelection {
  url: string;
  cacheKey: string;
  fromCache: boolean;
}

interface PlaybackUrlCache {
  get(key: string): string | undefined;
}

export function buildPlaybackUrlCacheKey(
  rawUrl: string,
  sourceKey = '',
  currentSourceKey = '',
): string {
  return `${sourceKey || currentSourceKey}|${rawUrl.trim()}`;
}

function isInternalPlaybackUrl(rawUrl: string, origin: string): boolean {
  try {
    const parsed = new URL(rawUrl, origin);
    if (parsed.origin !== new URL(origin).origin) return false;

    return (
      parsed.pathname.startsWith('/api/private-library/') ||
      parsed.pathname.startsWith('/api/proxy/m3u8-filter') ||
      parsed.pathname.startsWith('/api/proxy/m3u8-asset') ||
      parsed.pathname.startsWith('/api/proxy/m3u8')
    );
  } catch {
    return !/^https?:\/\//i.test(rawUrl);
  }
}

export function selectImmediatePlaybackUrl(input: {
  rawUrl: string;
  sourceKey?: string;
  currentSourceKey?: string;
  cache: PlaybackUrlCache;
  origin: string;
}): ImmediatePlaybackSelection | null {
  const rawUrl = input.rawUrl.trim();
  const cacheKey = buildPlaybackUrlCacheKey(
    rawUrl,
    input.sourceKey,
    input.currentSourceKey,
  );
  const cachedUrl = input.cache.get(cacheKey)?.trim();
  if (cachedUrl) {
    return { url: cachedUrl, cacheKey, fromCache: true };
  }

  if (
    input.sourceKey === 'private_library' ||
    isInternalPlaybackUrl(rawUrl, input.origin)
  ) {
    return { url: rawUrl, cacheKey, fromCache: false };
  }

  return null;
}
