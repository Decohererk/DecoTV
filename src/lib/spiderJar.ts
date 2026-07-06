/*
 * Safe spider.jar provider.
 * - Uses the bundled fallback JAR by default.
 * - Fetches a remote JAR only when explicitly enabled and pinned by SHA-256.
 * - Reuses the proxy URL validator so redirects cannot reach private hosts.
 */
import crypto from 'crypto';

import { fetchWithValidatedRedirects } from '@/lib/proxy-security';

type SpiderSecurityMode = 'fallback-only' | 'remote-pinned';

const REMOTE_ENABLE_ENV = 'ALLOW_REMOTE_SPIDER_JAR';
const REMOTE_URL_ENV = 'SPIDER_JAR_URL';
const REMOTE_URLS_ENV = 'SPIDER_JAR_URLS';
const REMOTE_SHA256_ENV = 'SPIDER_JAR_SHA256';
const LEGACY_REMOTE_SHA256_ENV = 'REMOTE_SPIDER_JAR_SHA256';
const MAX_REMOTE_JAR_BYTES = 20 * 1024 * 1024;

// Bundled minimal fallback JAR. This keeps TVBox endpoints reachable without
// silently trusting third-party binary code.
const FALLBACK_JAR_BASE64 =
  'UEsDBBQACAgIACVFfFcAAAAAAAAAAAAAAAAJAAAATUVUQS1JTkYvUEsHCAAAAAACAAAAAAAAACVFfFcAAAAAAAAAAAAAAAANAAAATUVUQS1JTkYvTUFOSUZFU1QuTUZNYW5pZmVzdC1WZXJzaW9uOiAxLjAKQ3JlYXRlZC1CeTogMS44LjBfNDIxIChPcmFjbGUgQ29ycG9yYXRpb24pCgpQSwcIj79DCUoAAABLAAAAUEsDBBQACAgIACVFfFcAAAAAAAAAAAAAAAAMAAAATWVkaWFVdGlscy5jbGFzczWRSwrCQBBER3trbdPxm4BuBHfiBxHFH4hCwJX4ATfFCrAxnWnYgZCTuPIIHkCPYE+lM5NoILPpoqvrVVd1JslCaLB3MpILJ5xRz5gbMeMS+oyeBOc4xSWucYsZN3CHe7zgiQue8YJXvOEdH/jEFz7whW984weZ+Ecm/pGJf2TiH5n4Ryb+kYl/ZOIfmfhHJv6RiX9k4h+Z+Ecm/pGJf2TiH5n4Ryb+kYl/ZOIfGQaaaXzgE1/4xje+8Y1vfOMb3/jGN77xjW98q9c0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdM0TdOI06nO7p48NRQjICAgICAgICAgICAgICAoKCgoKCgoKCgoKCgoKChoqKioqKioqKio;';

const FALLBACK_BUFFER = Buffer.from(FALLBACK_JAR_BASE64, 'base64');

export interface SpiderJarInfo {
  buffer: Buffer;
  md5: string;
  sha256: string;
  source: string;
  success: boolean;
  cached: boolean;
  timestamp: number;
  size: number;
  tried: number;
  hashVerified: boolean;
  remoteEnabled: boolean;
  securityMode: SpiderSecurityMode;
}

interface RemoteSpiderJarConfig {
  enabled: boolean;
  expectedSha256?: string;
  candidates: string[];
  ready: boolean;
  reason?: 'remote_disabled' | 'missing_sha256' | 'missing_urls';
}

let cache: SpiderJarInfo | null = null;
const failedSources: Set<string> = new Set();
let lastFailureReset = Date.now();

const SUCCESS_TTL = 4 * 60 * 60 * 1000;
const FAILURE_TTL = 10 * 60 * 1000;
const FAILURE_RESET_INTERVAL = 2 * 60 * 60 * 1000;

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());
}

function normalizeSha256(value: string | undefined): string | undefined {
  const normalized = (value || '')
    .trim()
    .toLowerCase()
    .replace(/^sha256:/, '');
  return /^[a-f0-9]{64}$/.test(normalized) ? normalized : undefined;
}

function parseRemoteUrls(rawValues: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const rawValue of rawValues) {
    for (const rawUrl of (rawValue || '').split(/[\s,]+/)) {
      const trimmed = rawUrl.trim();
      if (!trimmed) continue;

      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          continue;
        }
        if (parsed.username || parsed.password) continue;

        const normalized = parsed.toString();
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      } catch {
        // Ignore invalid configured URLs.
      }
    }
  }

  return urls;
}

function getRemoteSpiderJarConfig(): RemoteSpiderJarConfig {
  const enabled = isTruthy(process.env[REMOTE_ENABLE_ENV]);
  const expectedSha256 = normalizeSha256(
    process.env[REMOTE_SHA256_ENV] || process.env[LEGACY_REMOTE_SHA256_ENV],
  );
  const candidates = parseRemoteUrls([
    process.env[REMOTE_URL_ENV],
    process.env[REMOTE_URLS_ENV],
  ]);

  let reason: RemoteSpiderJarConfig['reason'];
  if (!enabled) {
    reason = 'remote_disabled';
  } else if (!expectedSha256) {
    reason = 'missing_sha256';
  } else if (candidates.length === 0) {
    reason = 'missing_urls';
  }

  return {
    enabled,
    expectedSha256,
    candidates,
    ready: enabled && Boolean(expectedSha256) && candidates.length > 0,
    reason,
  };
}

export function getSpiderJarSecurityStatus() {
  const config = getRemoteSpiderJarConfig();
  const mode: SpiderSecurityMode = config.ready
    ? 'remote-pinned'
    : 'fallback-only';

  return {
    mode,
    reason: config.reason,
    remoteEnabled: config.enabled,
    hashConfigured: Boolean(config.expectedSha256),
    expectedSha256: config.expectedSha256,
    candidateCount: config.candidates.length,
    candidates: config.candidates,
    env: {
      enable: REMOTE_ENABLE_ENV,
      urls: `${REMOTE_URL_ENV} or ${REMOTE_URLS_ENV}`,
      sha256: REMOTE_SHA256_ENV,
    },
  };
}

function md5(buf: Buffer): string {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function fetchRemote(
  url: string,
  expectedSha256: string,
  timeoutMs = 5000,
): Promise<Buffer | null> {
  try {
    const response = await fetchWithValidatedRedirects(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/java-archive, application/zip, */*',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Connection: 'close',
          'User-Agent': 'DecoTV/1.5 spider-jar-fetcher',
        },
      },
      { timeoutMs, maxRedirects: 3 },
    );

    if (!response.ok) return null;

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_REMOTE_JAR_BYTES) return null;

    const arrayBuffer = await response.arrayBuffer();
    if (
      arrayBuffer.byteLength < 1000 ||
      arrayBuffer.byteLength > MAX_REMOTE_JAR_BYTES
    ) {
      return null;
    }

    const bytes = new Uint8Array(arrayBuffer);
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) return null;

    const buffer = Buffer.from(arrayBuffer);
    if (sha256(buffer) !== expectedSha256) return null;

    return buffer;
  } catch {
    return null;
  }
}

function buildFallbackInfo(
  now: number,
  tried: number,
  config: RemoteSpiderJarConfig,
): SpiderJarInfo {
  return {
    buffer: FALLBACK_BUFFER,
    md5: md5(FALLBACK_BUFFER),
    sha256: sha256(FALLBACK_BUFFER),
    source: 'fallback',
    success: false,
    cached: false,
    timestamp: now,
    size: FALLBACK_BUFFER.length,
    tried,
    hashVerified: false,
    remoteEnabled: config.enabled,
    securityMode: config.ready ? 'remote-pinned' : 'fallback-only',
  };
}

export function getFallbackSpiderJarInfo(tried = 0): SpiderJarInfo {
  return buildFallbackInfo(Date.now(), tried, getRemoteSpiderJarConfig());
}

export async function getSpiderJar(
  forceRefresh = false,
): Promise<SpiderJarInfo> {
  const now = Date.now();
  const remoteConfig = getRemoteSpiderJarConfig();
  const securityMode: SpiderSecurityMode = remoteConfig.ready
    ? 'remote-pinned'
    : 'fallback-only';

  if (now - lastFailureReset > FAILURE_RESET_INTERVAL) {
    failedSources.clear();
    lastFailureReset = now;
  }

  if (!forceRefresh && cache) {
    const ttl = cache.success ? SUCCESS_TTL : FAILURE_TTL;
    const cacheMatchesConfig =
      cache.securityMode === securityMode &&
      (!remoteConfig.ready ||
        !cache.success ||
        cache.sha256 === remoteConfig.expectedSha256);

    if (cacheMatchesConfig && now - cache.timestamp < ttl) {
      return { ...cache, cached: true };
    }
  }

  let tried = 0;

  if (remoteConfig.ready && remoteConfig.expectedSha256) {
    const activeCandidates = remoteConfig.candidates.filter(
      (url) => !failedSources.has(url),
    );
    const candidatesToTry =
      activeCandidates.length > 0 ? activeCandidates : remoteConfig.candidates;

    for (const url of candidatesToTry) {
      tried += 1;
      const buffer = await fetchRemote(url, remoteConfig.expectedSha256);

      if (buffer) {
        failedSources.delete(url);

        const info: SpiderJarInfo = {
          buffer,
          md5: md5(buffer),
          sha256: sha256(buffer),
          source: url,
          success: true,
          cached: false,
          timestamp: now,
          size: buffer.length,
          tried,
          hashVerified: true,
          remoteEnabled: true,
          securityMode,
        };
        cache = info;
        return info;
      }

      failedSources.add(url);
    }
  }

  const fallbackInfo = buildFallbackInfo(now, tried, remoteConfig);
  cache = fallbackInfo;
  return fallbackInfo;
}

export function getSpiderStatus() {
  return cache ? { ...cache, buffer: undefined } : null;
}

export function resetSpiderJarCacheForTests() {
  cache = null;
  failedSources.clear();
  lastFailureReset = Date.now();
}
