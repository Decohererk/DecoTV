import type { PlaybackHealthResult } from './hls-utils';

export interface SourceQualityRecord {
  sourceKey: string;
  successCount: number;
  failCount: number;
  lastSuccessAt?: number;
  lastFailAt?: number;
  avgTtfb?: number;
  avgFirstSegmentMs?: number;
  badUntil?: number;
  reasons: Record<string, number>;
}

const STORAGE_PREFIX = 'source_quality:';
const BAD_SOURCE_TTL_MS =
  Number(process.env.NEXT_PUBLIC_PLAYBACK_BAD_SOURCE_TTL || 1800) * 1000;
const GOOD_SOURCE_TTL_MS =
  Number(process.env.NEXT_PUBLIC_PLAYBACK_GOOD_SOURCE_TTL || 86400) * 1000;

function now() {
  return Date.now();
}

function readRecord(sourceKey: string): SourceQualityRecord {
  if (typeof window === 'undefined') {
    return {
      sourceKey,
      successCount: 0,
      failCount: 0,
      reasons: {},
    };
  }

  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sourceKey}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SourceQualityRecord>;
      return {
        sourceKey,
        successCount: Number(parsed.successCount) || 0,
        failCount: Number(parsed.failCount) || 0,
        lastSuccessAt: parsed.lastSuccessAt,
        lastFailAt: parsed.lastFailAt,
        avgTtfb: parsed.avgTtfb,
        avgFirstSegmentMs: parsed.avgFirstSegmentMs,
        badUntil: parsed.badUntil,
        reasons: parsed.reasons || {},
      };
    }
  } catch {
    // Ignore broken localStorage entries.
  }

  return {
    sourceKey,
    successCount: 0,
    failCount: 0,
    reasons: {},
  };
}

function writeRecord(record: SourceQualityRecord) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${record.sourceKey}`,
      JSON.stringify(record),
    );
  } catch {
    // Ignore quota/private mode failures.
  }
}

function rollingAverage(current: number | undefined, next: number): number {
  if (!Number.isFinite(next) || next <= 0) return current || 0;
  if (!current || current <= 0) return Math.round(next);
  return Math.round(current * 0.7 + next * 0.3);
}

export function getSourceQualityRecord(sourceKey: string): SourceQualityRecord {
  return readRecord(sourceKey);
}

export function isSourceTemporarilyBad(sourceKey: string): boolean {
  const record = readRecord(sourceKey);
  return Boolean(record.badUntil && record.badUntil > now());
}

export function getSourceQualityWeight(sourceKey: string): number {
  const record = readRecord(sourceKey);
  const currentTime = now();

  if (record.badUntil && record.badUntil > currentTime) {
    return -25;
  }

  let weight = 0;
  if (
    record.lastSuccessAt &&
    currentTime - record.lastSuccessAt < GOOD_SOURCE_TTL_MS
  ) {
    weight += Math.min(20, record.successCount * 4);
  }
  if (
    record.lastFailAt &&
    currentTime - record.lastFailAt < BAD_SOURCE_TTL_MS
  ) {
    weight -= Math.min(20, record.failCount * 5);
  }
  if (record.avgTtfb && record.avgTtfb > 0) {
    if (record.avgTtfb <= 800) weight += 8;
    else if (record.avgTtfb > 5000) weight -= 8;
  }
  return weight;
}

export function markSourcePlaybackSuccess(
  sourceKey: string,
  metrics?: { ttfbMs?: number; firstSegmentMs?: number },
) {
  const record = readRecord(sourceKey);
  record.successCount += 1;
  record.lastSuccessAt = now();
  record.badUntil = undefined;
  if (metrics?.ttfbMs) {
    record.avgTtfb = rollingAverage(record.avgTtfb, metrics.ttfbMs);
  }
  if (metrics?.firstSegmentMs) {
    record.avgFirstSegmentMs = rollingAverage(
      record.avgFirstSegmentMs,
      metrics.firstSegmentMs,
    );
  }
  writeRecord(record);
}

export function markSourcePlaybackFailure(sourceKey: string, reason: string) {
  const record = readRecord(sourceKey);
  record.failCount += 1;
  record.lastFailAt = now();
  const normalizedReason = reason || 'unknown';
  record.reasons[normalizedReason] =
    (record.reasons[normalizedReason] || 0) + 1;
  if (record.failCount >= Math.max(2, record.successCount + 2)) {
    record.badUntil = now() + BAD_SOURCE_TTL_MS;
  }
  writeRecord(record);
}

export function updateSourceQualityFromHealth(
  sourceKey: string,
  health: PlaybackHealthResult,
) {
  if (health.playable) {
    markSourcePlaybackSuccess(sourceKey, {
      ttfbMs: health.firstSegment?.timeToFirstByteMs,
      firstSegmentMs: health.firstSegment?.timeToFirstByteMs,
    });
  } else {
    markSourcePlaybackFailure(sourceKey, health.reason || 'health-failed');
  }
}
