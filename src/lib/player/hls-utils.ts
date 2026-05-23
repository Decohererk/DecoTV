export type PlaybackStreamType = 'hls' | 'mp4' | 'flv' | 'unknown';

export type PlaybackStrategy =
  | 'direct'
  | 'manifest-proxy'
  | 'asset-proxy'
  | 'full-proxy'
  | 'native';

export type PlaybackProxyMode = 'smart' | 'direct' | 'proxy' | 'off';

export interface HlsVariant {
  uri: string;
  bandwidth?: number;
  resolution?: string;
  width?: number;
  height?: number;
  codecs?: string;
}

export interface HlsKeyInfo {
  method?: string;
  uri?: string;
  resolvedUri?: string;
}

export interface HlsMapInfo {
  uri?: string;
  resolvedUri?: string;
}

export interface ParsedHlsPlaylist {
  isMaster: boolean;
  variants: HlsVariant[];
  firstSegment?: string;
  firstSegmentResolved?: string;
  key?: HlsKeyInfo;
  map?: HlsMapInfo;
  targetDuration?: number;
}

export interface PlaybackHealthResult {
  ok: boolean;
  playable: boolean;
  recommendedStrategy: Exclude<PlaybackStrategy, 'full-proxy' | 'native'>;
  source?: string;
  urlType: PlaybackStreamType;
  manifest?: {
    ok: boolean;
    status?: number;
    contentType?: string;
    size?: number;
    finalUrl?: string;
    isMaster?: boolean;
    selectedVariant?: HlsVariant;
    targetDuration?: number;
    reason?: string;
  };
  key?: {
    present: boolean;
    ok?: boolean;
    status?: number;
    size?: number;
    reason?: string;
  };
  firstSegment?: {
    ok: boolean;
    status?: number;
    contentType?: string;
    contentLength?: number;
    acceptRanges?: string;
    timeToFirstByteMs?: number;
    firstChunkBytes?: number;
    reason?: string;
  };
  cors?: {
    manifestReadable?: boolean;
    segmentReadable?: boolean;
    checkedInBrowser?: boolean;
    reason?: string;
  };
  timings?: Record<string, number>;
  reason?: string;
  suggestions: string[];
  warnings?: string[];
  nestedProxy?: boolean;
  score?: number;
  grade?: 'A' | 'B' | 'C' | 'D';
  debug?: Record<string, unknown>;

  // NOTE: 新增真实吞吐量测速字段
  firstByteMs?: number;
  sampleBytes?: number;
  sampleDurationMs?: number;
  throughputKBps?: number;
  throughputKbps?: number;
  estimatedPlayable?: boolean;
  requiredBandwidthKbps?: number;
  selectedVariantBandwidthKbps?: number;

  corsOk?: boolean;
  runtimeTarget?: 'vercel' | 'docker' | 'node' | 'unknown';
  smallAsset?: {
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
  };
}

export const DEFAULT_ANDROID_TV_UA =
  'Mozilla/5.0 (Linux; Android 10; AndroidTV) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export function isHlsUrl(url: string): boolean {
  if (!url) return false;
  return (
    /\.m3u8(?:$|[?#])/i.test(url) ||
    /\/m3u8(?:$|[/?#-])/i.test(url) ||
    /\/api\/proxy\/m3u8(?:$|[/?#-])/i.test(url)
  );
}

export function isMp4Url(url: string): boolean {
  if (!url) return false;
  return /\.mp4(?:$|[?#])/i.test(url);
}

export function isFlvUrl(url: string): boolean {
  if (!url) return false;
  return /\.flv(?:$|[?#])/i.test(url);
}

export function isLikelyM3U8Content(
  contentType: string | null | undefined,
  url = '',
): boolean {
  const lower = (contentType || '').toLowerCase();
  return (
    lower.includes('mpegurl') ||
    lower.includes('vnd.apple.mpegurl') ||
    lower.includes('application/x-mpegurl') ||
    lower.includes('audio/mpegurl') ||
    lower.includes('octet-stream') ||
    isHlsUrl(url)
  );
}

export function inferPlaybackType(
  url: string,
  contentType?: string | null,
): PlaybackStreamType {
  const lowerType = (contentType || '').toLowerCase();
  if (isLikelyM3U8Content(contentType, url)) return 'hls';
  if (lowerType.includes('video/mp4') || isMp4Url(url)) return 'mp4';
  if (lowerType.includes('flv') || isFlvUrl(url)) return 'flv';
  return 'unknown';
}

export function sanitizeEpisodeUrl(rawUrl: string): string {
  return (rawUrl || '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\u0026/gi, '&')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, '');
}

export function resolveUrl(baseUrl: string, value: string): string {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

export function getPlaylistBaseUrl(finalUrl: string): string {
  try {
    return new URL('.', finalUrl).toString();
  } catch {
    const idx = finalUrl.lastIndexOf('/');
    return idx >= 0 ? finalUrl.slice(0, idx + 1) : finalUrl;
  }
}

export function unwrapDecoProxyUrl(rawUrl: string): {
  url: string;
  originalUrl: string;
  wasDecoProxy: boolean;
  wasProxy: boolean;
  proxyRoute?: string;
  proxyPath?: string;
  oldSig?: string;
  referer?: string;
} {
  let currentUrl = sanitizeEpisodeUrl(rawUrl);
  let wasDecoProxy = false;
  let firstProxyRoute: string | undefined = undefined;
  let firstOldSig: string | undefined = undefined;
  let firstReferer: string | undefined = undefined;

  const base =
    typeof window !== 'undefined' ? window.location.origin : 'http://local';

  // NOTE: 使用 while(true) 递归解包真正的原始上游 URL
  while (true) {
    try {
      const parsed = new URL(currentUrl, base);
      const isDecoProxy =
        parsed.pathname === '/api/proxy/m3u8' ||
        parsed.pathname === '/api/proxy/m3u8-filter' ||
        parsed.pathname === '/api/proxy/m3u8-asset' ||
        parsed.pathname === '/api/proxy/segment' ||
        parsed.pathname === '/api/proxy/key';

      if (isDecoProxy) {
        const upstream = parsed.searchParams.get('url');
        if (upstream) {
          if (!wasDecoProxy) {
            wasDecoProxy = true;
            firstProxyRoute = parsed.pathname;
            firstOldSig = parsed.searchParams.get('sig') || undefined;
            firstReferer = parsed.searchParams.get('referer') || undefined;
          }
          currentUrl = sanitizeEpisodeUrl(upstream);
          continue;
        }
      }
    } catch {
      // ignore parse failures and stop unwrapping
    }
    break;
  }

  return {
    url: currentUrl,
    originalUrl: currentUrl,
    wasDecoProxy,
    wasProxy: wasDecoProxy,
    proxyRoute: firstProxyRoute,
    proxyPath: firstProxyRoute,
    oldSig: firstOldSig,
    referer: firstReferer,
  };
}

export function hasSuspiciousUrlEncoding(rawUrl: string): string[] {
  const warnings: string[] = [];
  if (!rawUrl || rawUrl.trim() !== rawUrl) warnings.push('url-whitespace');
  if (/\\u0026/i.test(rawUrl)) warnings.push('escaped-ampersand');
  if (/\$/.test(rawUrl)) warnings.push('mac-cms-separator-leftover');
  if (/\s/.test(rawUrl.trim())) warnings.push('url-contains-space');
  return warnings;
}

function parseAttributeList(value: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    result[match[1].toUpperCase()] = match[2].replace(/^"|"$/g, '');
  }
  return result;
}

function parseResolution(value?: string): {
  resolution?: string;
  width?: number;
  height?: number;
} {
  if (!value) return {};
  const match = value.match(/^(\d+)x(\d+)$/i);
  if (!match) return { resolution: value };
  const width = Number(match[1]);
  const height = Number(match[2]);
  return {
    resolution: value,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
  };
}

export function parseHlsPlaylist(
  content: string,
  baseUrl: string,
): ParsedHlsPlaylist {
  const lines = content.split(/\r?\n/);
  const variants: HlsVariant[] = [];
  let firstSegment: string | undefined;
  let key: HlsKeyInfo | undefined;
  let map: HlsMapInfo | undefined;
  let targetDuration: number | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      const duration = Number(line.slice('#EXT-X-TARGETDURATION:'.length));
      if (Number.isFinite(duration)) targetDuration = duration;
      continue;
    }

    if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-KEY:'.length));
      key = {
        method: attrs.METHOD,
        uri: attrs.URI,
        resolvedUri: attrs.URI ? resolveUrl(baseUrl, attrs.URI) : undefined,
      };
      continue;
    }

    if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-MAP:'.length));
      map = {
        uri: attrs.URI,
        resolvedUri: attrs.URI ? resolveUrl(baseUrl, attrs.URI) : undefined,
      };
      continue;
    }

    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = parseAttributeList(line.slice('#EXT-X-STREAM-INF:'.length));
      let uri = '';
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next) continue;
        if (!next.startsWith('#')) {
          uri = next;
          i = j;
        }
        break;
      }
      const resolution = parseResolution(attrs.RESOLUTION);
      variants.push({
        uri: uri ? resolveUrl(baseUrl, uri) : '',
        bandwidth: attrs.BANDWIDTH ? Number(attrs.BANDWIDTH) : undefined,
        codecs: attrs.CODECS,
        ...resolution,
      });
      continue;
    }

    if (!line.startsWith('#') && !firstSegment) {
      firstSegment = line;
    }
  }

  return {
    isMaster: variants.length > 0,
    variants,
    firstSegment,
    firstSegmentResolved: firstSegment
      ? resolveUrl(baseUrl, firstSegment)
      : undefined,
    key,
    map,
    targetDuration,
  };
}

export function chooseDefaultHlsVariant(
  variants: HlsVariant[],
): HlsVariant | undefined {
  if (!variants.length) return undefined;
  const scored = variants
    .filter((variant) => variant.uri)
    .map((variant, index) => {
      const height = variant.height || 0;
      const bandwidth = variant.bandwidth || 0;
      const targetHeight =
        height >= 720 && height <= 1080
          ? 100
          : height > 1080
            ? Math.max(20, 90 - (height - 1080) / 40)
            : height / 12;
      const bitratePenalty = bandwidth > 10_000_000 ? 15 : 0;
      return {
        variant,
        index,
        score:
          targetHeight + Math.min(bandwidth / 500_000, 20) - bitratePenalty,
      };
    });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored[0]?.variant || variants[0];
}

export function scorePlaybackHealth(
  health: Pick<
    PlaybackHealthResult,
    'manifest' | 'key' | 'firstSegment' | 'cors' | 'playable' | 'nestedProxy'
  > & {
    throughputKbps?: number;
    selectedVariantBandwidthKbps?: number;
  },
): { score: number; grade: 'A' | 'B' | 'C' | 'D' } {
  let score = 0;

  // 1. m3u8 列表是否成功获取
  const manifestOk = health.manifest?.ok;
  if (manifestOk) score += 15;

  // 2. 解密 Key 是否成功获取（如果存在）
  const keyOk = !health.key?.present || health.key?.ok;
  if (keyOk) score += 10;

  // 3. 首片/首帧分片基础连通性检测
  const segmentOk = health.firstSegment?.ok;
  if (segmentOk) {
    score += 30;
    const ttfb = health.firstSegment?.timeToFirstByteMs || 0;
    if (ttfb > 0) {
      if (ttfb <= 800) score += 15;
      else if (ttfb <= 2000) score += 10;
      else if (ttfb <= 5000) score += 5;
      else score += 2;
    } else {
      score += 5;
    }
  }

  // 4. 吞吐量吞吐速度加分
  const throughput = health.throughputKbps || 0;
  const reqBandwidth = health.selectedVariantBandwidthKbps
    ? health.selectedVariantBandwidthKbps * 1.2
    : 1000; // 默认标清播放起步带宽 1000 Kbps (125 KB/s)

  let throughputOk = false;
  if (segmentOk && throughput > 0) {
    if (throughput >= reqBandwidth) {
      score += 30;
      throughputOk = true;
    } else if (throughput >= reqBandwidth * 0.7) {
      score += 20;
    } else if (throughput >= reqBandwidth * 0.4) {
      score += 10;
    } else {
      score += 2;
    }
  }

  if (health.cors?.manifestReadable) score += 5;
  if (health.nestedProxy) score -= 8;
  score = Math.max(0, Math.min(100, Math.round(score)));

  // 判定是否可播放：基础连通性全部通过
  const playable = Boolean(health.playable && manifestOk && segmentOk && keyOk);

  let grade: 'A' | 'B' | 'C' | 'D' = 'D';
  if (!playable) {
    grade = 'D';
  } else {
    // NOTE: 只有在基础资源均就绪，且吞吐量满足所选清晰度带宽需求时，才允许评定为 A 级
    if (manifestOk && keyOk && segmentOk && throughputOk && score >= 80) {
      grade = 'A';
    } else if (score >= 60) {
      grade = 'B';
    } else {
      grade = 'C';
    }
  }

  return { score, grade };
}
