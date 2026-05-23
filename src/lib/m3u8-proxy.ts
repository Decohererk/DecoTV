import { createHmac, timingSafeEqual } from 'crypto';

import { DEFAULT_AD_FILTER_CONFIG, filterM3U8 } from '@/lib/ad-filter';
import { getAuthSecret } from '@/lib/auth';
import { getPlaylistBaseUrl, resolveUrl } from '@/lib/player/hls-utils';

function getM3U8ProxySecret(): string | null {
  const explicit =
    process.env.M3U8_PROXY_SIGNING_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    getAuthSecret();

  if (explicit) return explicit;

  return process.env.NODE_ENV === 'production'
    ? null
    : 'dev-m3u8-proxy-signing-secret';
}

function base64Url(input: Buffer): string {
  return input
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function signaturePayload(upstreamUrl: string, referer?: string): string {
  return `${upstreamUrl}\n${referer || ''}`;
}

export function signM3U8ProxyRequest(
  upstreamUrl: string,
  referer?: string,
): string | null {
  const secret = getM3U8ProxySecret();
  if (!secret) return null;

  return base64Url(
    createHmac('sha256', secret)
      .update(signaturePayload(upstreamUrl, referer))
      .digest(),
  );
}

export function verifyM3U8ProxySignature(
  upstreamUrl: string,
  referer: string | undefined,
  signature: string | null,
): boolean {
  if (!signature) return false;

  const expected = signM3U8ProxyRequest(upstreamUrl, referer);
  if (!expected || expected.length !== signature.length) return false;

  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

export type HlsProxyAssetKind = 'segment' | 'key' | 'map' | 'playlist';

export interface BuildHlsProxyUrlOptions {
  requestOrigin: string;
  upstreamUrl: string;
  source?: string | null;
  referer?: string;
  proxyAssets?: boolean;
  adFilter?: boolean;
}

export interface RewriteHlsManifestOptions {
  requestOrigin: string;
  upstreamUrl: string;
  finalUrl?: string;
  source?: string | null;
  referer?: string;
  proxyAssets: boolean;
  adFilter?: boolean;
}

export function inferHlsAssetKind(upstreamUrl: string): HlsProxyAssetKind {
  const pathname = (() => {
    try {
      return new URL(upstreamUrl).pathname.toLowerCase();
    } catch {
      return upstreamUrl.toLowerCase();
    }
  })();

  if (pathname.endsWith('.m3u8')) return 'playlist';
  if (pathname.endsWith('.key')) return 'key';
  if (
    pathname.endsWith('.mp4') ||
    pathname.endsWith('.m4s') ||
    pathname.endsWith('.m4v') ||
    pathname.endsWith('.init')
  ) {
    return 'map';
  }
  return 'segment';
}

function appendCommonProxyParams(
  proxyUrl: URL,
  options: {
    upstreamUrl: string;
    source?: string | null;
    referer?: string;
  },
) {
  proxyUrl.searchParams.set('url', options.upstreamUrl);
  if (options.source) {
    proxyUrl.searchParams.set('source', options.source);
    proxyUrl.searchParams.set('decotv-source', options.source);
  }
  if (options.referer) {
    proxyUrl.searchParams.set('referer', options.referer);
  }
  const signature = signM3U8ProxyRequest(options.upstreamUrl, options.referer);
  if (signature) {
    proxyUrl.searchParams.set('sig', signature);
  }
}

export function buildHlsManifestProxyUrl(
  options: BuildHlsProxyUrlOptions,
): string {
  const proxyUrl = new URL('/api/proxy/m3u8', options.requestOrigin);
  appendCommonProxyParams(proxyUrl, options);
  proxyUrl.searchParams.set('proxyAssets', options.proxyAssets ? '1' : '0');
  if (options.adFilter === false) {
    proxyUrl.searchParams.set('adfilter', 'false');
  }
  return proxyUrl.toString();
}

export function buildHlsAssetProxyUrl(options: {
  requestOrigin: string;
  upstreamUrl: string;
  source?: string | null;
  referer?: string;
  kind?: HlsProxyAssetKind;
}): string {
  const proxyUrl = new URL('/api/proxy/m3u8-asset', options.requestOrigin);
  appendCommonProxyParams(proxyUrl, options);
  proxyUrl.searchParams.set(
    'kind',
    options.kind || inferHlsAssetKind(options.upstreamUrl),
  );
  return proxyUrl.toString();
}

function rewriteUriAttribute(
  line: string,
  baseUrl: string,
  options: RewriteHlsManifestOptions,
  target: 'playlist' | 'asset',
  kind?: HlsProxyAssetKind,
): string {
  return line.replace(/URI="([^"]+)"/g, (match, uri) => {
    const resolved = resolveUrl(baseUrl, uri);
    const nextUrl =
      target === 'playlist'
        ? buildHlsManifestProxyUrl({
            requestOrigin: options.requestOrigin,
            upstreamUrl: resolved,
            source: options.source,
            referer: options.referer,
            proxyAssets: options.proxyAssets,
            adFilter: options.adFilter,
          })
        : options.proxyAssets
          ? buildHlsAssetProxyUrl({
              requestOrigin: options.requestOrigin,
              upstreamUrl: resolved,
              source: options.source,
              referer: options.referer,
              kind,
            })
          : resolved;
    return match.replace(uri, nextUrl);
  });
}

export function rewriteHlsManifest(
  content: string,
  options: RewriteHlsManifestOptions,
): string {
  const baseUrl = getPlaylistBaseUrl(options.finalUrl || options.upstreamUrl);
  const lines = content.split('\n');
  const rewritten: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trimEnd();
    const trimmed = line.trim();

    if (
      trimmed.startsWith('#EXT-X-MEDIA:') ||
      trimmed.startsWith('#EXT-X-I-FRAME-STREAM-INF:')
    ) {
      line = rewriteUriAttribute(line, baseUrl, options, 'playlist');
      rewritten.push(line);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-STREAM-INF:')) {
      rewritten.push(line);
      if (i + 1 < lines.length) {
        i++;
        const nextLine = lines[i].trim();
        if (nextLine && !nextLine.startsWith('#')) {
          const resolved = resolveUrl(baseUrl, nextLine);
          rewritten.push(
            buildHlsManifestProxyUrl({
              requestOrigin: options.requestOrigin,
              upstreamUrl: resolved,
              source: options.source,
              referer: options.referer,
              proxyAssets: options.proxyAssets,
              adFilter: options.adFilter,
            }),
          );
        } else {
          rewritten.push(lines[i]);
        }
      }
      continue;
    }

    if (trimmed.startsWith('#EXT-X-KEY:')) {
      line = rewriteUriAttribute(line, baseUrl, options, 'asset', 'key');
      rewritten.push(line);
      continue;
    }

    if (trimmed.startsWith('#EXT-X-MAP:')) {
      line = rewriteUriAttribute(line, baseUrl, options, 'asset', 'map');
      rewritten.push(line);
      continue;
    }

    if (
      trimmed.startsWith('#EXT-X-PART:') ||
      trimmed.startsWith('#EXT-X-PRELOAD-HINT:')
    ) {
      line = rewriteUriAttribute(line, baseUrl, options, 'asset', 'segment');
      rewritten.push(line);
      continue;
    }

    if (trimmed && !trimmed.startsWith('#')) {
      const resolved = resolveUrl(baseUrl, trimmed);
      rewritten.push(
        options.proxyAssets
          ? buildHlsAssetProxyUrl({
              requestOrigin: options.requestOrigin,
              upstreamUrl: resolved,
              source: options.source,
              referer: options.referer,
              kind: 'segment',
            })
          : resolved,
      );
      continue;
    }

    rewritten.push(line);
  }

  const body = rewritten.join('\n');
  if (
    options.adFilter !== false &&
    !body.includes('#EXT-X-STREAM-INF') &&
    process.env.ENABLE_AD_FILTER !== 'false' &&
    process.env.ENABLE_AD_FILTER !== '0'
  ) {
    return filterM3U8(body, DEFAULT_AD_FILTER_CONFIG).filtered;
  }
  return body;
}
