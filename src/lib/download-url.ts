export interface NormalizedDownloadSource {
  sourceUrl: string;
  referer?: string;
  origin?: string;
}

function getDefaultBaseHref(): string {
  if (typeof window !== 'undefined') {
    return window.location.href;
  }
  return 'http://localhost/';
}

function parseHttpUrl(rawUrl: string | null | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function extractOrigin(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function isProxyPlaylistPath(pathname: string): boolean {
  return (
    pathname.endsWith('/api/proxy/m3u8-filter') ||
    pathname.endsWith('/api/proxy/m3u8')
  );
}

export function normalizeDownloadSource(
  rawUrl: string,
  baseHref = getDefaultBaseHref(),
): NormalizedDownloadSource {
  try {
    const parsed = new URL(rawUrl, baseHref);
    const sourceUrl = parsed.toString();

    if (isProxyPlaylistPath(parsed.pathname)) {
      const upstreamUrl = parseHttpUrl(parsed.searchParams.get('url'));
      const explicitReferer = parseHttpUrl(parsed.searchParams.get('referer'));
      const referer = explicitReferer || upstreamUrl || sourceUrl;
      return {
        sourceUrl,
        referer,
        origin: extractOrigin(referer),
      };
    }

    return {
      sourceUrl,
      referer: sourceUrl,
      origin: parsed.origin,
    };
  } catch {
    return { sourceUrl: rawUrl };
  }
}
