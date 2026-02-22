export type DownloadStatus =
  | 'queued'
  | 'parsing'
  | 'downloading'
  | 'paused'
  | 'merging'
  | 'completed'
  | 'error';

export type DownloadMediaType = 'm3u8' | 'file';

export type DownloadChannel = 'browser' | 'ffmpeg';

export interface DownloadTask {
  id: string;
  title: string;
  sourceUrl: string;
  fileName: string;
  mediaType: DownloadMediaType;
  downloadChannel: DownloadChannel;
  status: DownloadStatus;
  totalSegments: number;
  downloadedSegments: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  mergeProgress: number;
  createdAt: number;
  updatedAt: number;
  segmentUrls: string[];
  segmentRanges?: Record<number, string>;
  playlistUrl?: string;
  requestReferer?: string;
  requestOrigin?: string;
  requestUa?: string;
  ffmpegJobId?: string;
  downloadUrl?: string;
  error?: string;
}

export interface DownloadRequest {
  title: string;
  sourceUrl: string;
  fileNameHint?: string;
  channel?: DownloadChannel;
  referer?: string;
  origin?: string;
  ua?: string;
}

export interface ParsedM3U8Result {
  playlistUrl: string;
  segmentUrls: string[];
  segmentRanges: Record<number, string>;
  durationSeconds: number;
  encrypted: boolean;
  containerExtension: 'ts' | 'mp4';
}

export function createDownloadId(): string {
  return `dl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeFileName(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 3);
  const value = bytes / 1024 ** power;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[power]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return '0 B/s';
  }
  return `${formatBytes(bytesPerSecond)}/s`;
}

export function formatTaskProgress(task: DownloadTask): number {
  if (task.totalSegments <= 0) return 0;
  return Math.min(
    100,
    Math.round((task.downloadedSegments / task.totalSegments) * 100),
  );
}
