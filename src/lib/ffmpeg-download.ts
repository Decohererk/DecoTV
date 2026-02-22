import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const JOBS_SYMBOL = Symbol.for('decotv.ffmpeg.jobs');
const FFMPEG_SUPPORT_SYMBOL = Symbol.for('decotv.ffmpeg.support');

const MIN_PROGRESS = 0;
const MAX_PROGRESS = 100;
const DEFAULT_RETENTION_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT = 2;
const FFMPEG_SUPPORT_CACHE_TTL_MS = 30_000;

export type FfmpegJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'completed'
  | 'error';

export interface FfmpegJobSnapshot {
  id: string;
  title: string;
  sourceUrl: string;
  fileName: string;
  status: FfmpegJobStatus;
  progress: number;
  speed: string;
  downloadedBytes: number;
  durationSeconds: number | null;
  createdAt: number;
  updatedAt: number;
  error?: string;
}

interface InternalFfmpegJob extends FfmpegJobSnapshot {
  outputPath: string;
  process: ChildProcessWithoutNullStreams | null;
  stopReason: 'pause' | 'remove' | null;
}

interface StartFfmpegDownloadInput {
  sourceUrl: string;
  title: string;
  fileNameHint?: string;
}

interface FfmpegOutputFile {
  path: string;
  fileName: string;
}

export interface FfmpegRuntimeSupport {
  supported: boolean;
  reason?: string;
}

interface FfmpegRuntimeSupportCache {
  checkedAt: number;
  value: FfmpegRuntimeSupport;
}

function getJobsMap(): Map<string, InternalFfmpegJob> {
  const globalStore = globalThis as typeof globalThis & {
    [JOBS_SYMBOL]?: Map<string, InternalFfmpegJob>;
  };

  if (!globalStore[JOBS_SYMBOL]) {
    globalStore[JOBS_SYMBOL] = new Map<string, InternalFfmpegJob>();
  }

  return globalStore[JOBS_SYMBOL];
}

function getSupportCache(): FfmpegRuntimeSupportCache | undefined {
  const globalStore = globalThis as typeof globalThis & {
    [FFMPEG_SUPPORT_SYMBOL]?: FfmpegRuntimeSupportCache;
  };

  return globalStore[FFMPEG_SUPPORT_SYMBOL];
}

function setSupportCache(value: FfmpegRuntimeSupport): void {
  const globalStore = globalThis as typeof globalThis & {
    [FFMPEG_SUPPORT_SYMBOL]?: FfmpegRuntimeSupportCache;
  };

  globalStore[FFMPEG_SUPPORT_SYMBOL] = {
    checkedAt: Date.now(),
    value,
  };
}

function getRetentionMs(): number {
  const raw = Number.parseInt(
    process.env.FFMPEG_JOB_RETENTION_MS || `${DEFAULT_RETENTION_MS}`,
    10,
  );
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_RETENTION_MS;
}

function getMaxConcurrentJobs(): number {
  const raw = Number.parseInt(
    process.env.FFMPEG_MAX_CONCURRENT_JOBS || `${DEFAULT_MAX_CONCURRENT}`,
    10,
  );
  if (Number.isFinite(raw) && raw > 0) return raw;
  return DEFAULT_MAX_CONCURRENT;
}

function getFfmpegPath(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg';
}

function getFfprobePath(): string {
  return process.env.FFPROBE_PATH || 'ffprobe';
}

function canRunFfmpegInServerless(): boolean {
  const forceEnable = process.env.FFMPEG_ALLOW_SERVERLESS?.trim();
  return forceEnable === '1' || forceEnable?.toLowerCase() === 'true';
}

function isLikelyServerless(): boolean {
  if (process.env.VERCEL === '1') return true;
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return true;
  if (process.env.NETLIFY === 'true') return true;
  return false;
}

function getDefaultOutputDir(): string {
  const configured = process.env.FFMPEG_DOWNLOAD_DIR?.trim();
  if (configured) {
    return path.resolve(configured);
  }

  if (process.env.VERCEL === '1') {
    return path.resolve('/tmp', 'decotv-ffmpeg-downloads');
  }

  return path.resolve(process.cwd(), '.cache', 'ffmpeg-downloads');
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return MIN_PROGRESS;
  return Math.min(MAX_PROGRESS, Math.max(MIN_PROGRESS, value));
}

function sanitizeFileName(input: string): string {
  return input
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

async function getOutputDir(): Promise<string> {
  const outputDir = getDefaultOutputDir();
  await fs.mkdir(outputDir, { recursive: true });
  return outputDir;
}

export async function getFfmpegRuntimeSupport(
  forceRefresh = false,
): Promise<FfmpegRuntimeSupport> {
  if (!forceRefresh) {
    const cached = getSupportCache();
    if (cached && Date.now() - cached.checkedAt < FFMPEG_SUPPORT_CACHE_TTL_MS) {
      return cached.value;
    }
  }

  if (isLikelyServerless() && !canRunFfmpegInServerless()) {
    const unsupported: FfmpegRuntimeSupport = {
      supported: false,
      reason:
        '该功能仅支持 Docker/VPS 部署，当前环境不支持 FFmpeg 二进制运行。',
    };
    setSupportCache(unsupported);
    return unsupported;
  }

  try {
    await execFileAsync(getFfmpegPath(), ['-version'], {
      timeout: 10_000,
      maxBuffer: 1024 * 256,
    });
    const supported: FfmpegRuntimeSupport = { supported: true };
    setSupportCache(supported);
    return supported;
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'ffmpeg binary unavailable';
    const unsupported: FfmpegRuntimeSupport = {
      supported: false,
      reason: `FFmpeg 不可用: ${message}`,
    };
    setSupportCache(unsupported);
    return unsupported;
  }
}

function parseProgressKV(line: string): [string, string] | null {
  const index = line.indexOf('=');
  if (index <= 0) return null;
  const key = line.slice(0, index).trim();
  const value = line.slice(index + 1).trim();
  if (!key) return null;
  return [key, value];
}

async function probeDurationSeconds(sourceUrl: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync(
      getFfprobePath(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        sourceUrl,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );

    const parsed = Number.parseFloat(stdout.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function jobToSnapshot(job: InternalFfmpegJob): FfmpegJobSnapshot {
  return {
    id: job.id,
    title: job.title,
    sourceUrl: job.sourceUrl,
    fileName: job.fileName,
    status: job.status,
    progress: clampProgress(job.progress),
    speed: job.speed,
    downloadedBytes: job.downloadedBytes,
    durationSeconds: job.durationSeconds,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
  };
}

function countRunningJobs(jobs: Map<string, InternalFfmpegJob>): number {
  let count = 0;
  jobs.forEach((job) => {
    if (job.status === 'running') count += 1;
  });
  return count;
}

function cleanupExpiredJobs(): void {
  const jobs = getJobsMap();
  const now = Date.now();
  const retentionMs = getRetentionMs();

  jobs.forEach((job, id) => {
    if (job.process) return;
    if (!['paused', 'completed', 'error'].includes(job.status)) return;
    if (now - job.updatedAt <= retentionMs) return;

    jobs.delete(id);
    void fs.unlink(job.outputPath).catch(() => undefined);
  });
}

async function runQueuedJob(job: InternalFfmpegJob): Promise<void> {
  if (job.status !== 'queued' || job.process) return;

  job.status = 'running';
  job.error = undefined;
  job.updatedAt = Date.now();
  job.stopReason = null;

  job.durationSeconds = await probeDurationSeconds(job.sourceUrl);
  job.updatedAt = Date.now();

  const args = [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-i',
    job.sourceUrl,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    job.outputPath,
  ];

  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawn(getFfmpegPath(), args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.end();
  } catch (error) {
    job.status = 'error';
    job.error = error instanceof Error ? error.message : 'ffmpeg spawn failed';
    job.updatedAt = Date.now();
    kickQueuedJobs();
    return;
  }

  job.process = child;
  let stderrTail = '';
  let settled = false;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    const lines = chunk.split(/\r?\n/);
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      const kv = parseProgressKV(line);
      if (!kv) continue;

      const [key, value] = kv;
      if (key === 'total_size') {
        const bytes = Number.parseInt(value, 10);
        if (Number.isFinite(bytes) && bytes >= 0) {
          job.downloadedBytes = bytes;
        }
      } else if (key === 'speed') {
        job.speed = value;
      } else if (key === 'out_time_ms') {
        const outTimeMs = Number.parseInt(value, 10);
        if (
          Number.isFinite(outTimeMs) &&
          outTimeMs > 0 &&
          job.durationSeconds &&
          job.durationSeconds > 0
        ) {
          const outSeconds = outTimeMs / 1_000_000;
          const progress = (outSeconds / job.durationSeconds) * 100;
          job.progress = clampProgress(Math.min(99.5, progress));
        }
      } else if (key === 'progress' && value === 'end') {
        job.progress = 100;
      }
      job.updatedAt = Date.now();
    }
  });

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderrTail = `${stderrTail}${chunk}`.slice(-1500);
  });

  const finalize = async (
    status: FfmpegJobStatus,
    errorMessage?: string,
  ): Promise<void> => {
    if (settled) return;
    settled = true;
    job.process = null;
    job.status = status;
    job.error = errorMessage;
    if (status === 'completed') {
      job.progress = 100;
      try {
        const stat = await fs.stat(job.outputPath);
        job.downloadedBytes = stat.size;
      } catch {
        // ignore
      }
    } else if (status !== 'running') {
      job.speed = '0x';
    }
    job.updatedAt = Date.now();
    kickQueuedJobs();
  };

  child.once('error', async (error) => {
    if (job.stopReason === 'pause' || job.stopReason === 'remove') {
      await finalize('paused');
      return;
    }
    await finalize(
      'error',
      error instanceof Error ? error.message : 'ffmpeg process error',
    );
  });

  child.once('close', async (code) => {
    const stopReason = job.stopReason;
    job.stopReason = null;

    if (stopReason === 'pause') {
      await finalize('paused');
      return;
    }
    if (stopReason === 'remove') {
      return;
    }

    if (code === 0) {
      await finalize('completed');
      return;
    }

    await finalize(
      'error',
      stderrTail.trim() || `ffmpeg exited with code ${code ?? 'unknown'}`,
    );
  });
}

function kickQueuedJobs(): void {
  cleanupExpiredJobs();
  const jobs = getJobsMap();
  const maxConcurrent = getMaxConcurrentJobs();

  while (countRunningJobs(jobs) < maxConcurrent) {
    const nextJob = Array.from(jobs.values())
      .filter((job) => job.status === 'queued' && !job.process)
      .sort((a, b) => a.createdAt - b.createdAt)[0];

    if (!nextJob) return;
    void runQueuedJob(nextJob);
  }
}

export async function startFfmpegDownload(
  input: StartFfmpegDownloadInput,
): Promise<FfmpegJobSnapshot> {
  cleanupExpiredJobs();
  const runtimeSupport = await getFfmpegRuntimeSupport();
  if (!runtimeSupport.supported) {
    throw new Error(
      runtimeSupport.reason ||
        '该功能仅支持 Docker/VPS 部署，当前环境不支持 FFmpeg 二进制运行。',
    );
  }

  const safeTitle = sanitizeFileName(
    input.fileNameHint || input.title || 'video',
  );
  const id = randomUUID().replace(/-/g, '');
  const outputDir = await getOutputDir();
  const outputPath = path.join(outputDir, `${id}_${safeTitle || 'video'}.mp4`);

  const now = Date.now();
  const job: InternalFfmpegJob = {
    id,
    title: input.title,
    sourceUrl: input.sourceUrl,
    fileName: `${safeTitle || 'video'}.mp4`,
    outputPath,
    status: 'queued',
    progress: 0,
    speed: '0x',
    downloadedBytes: 0,
    durationSeconds: null,
    createdAt: now,
    updatedAt: now,
    process: null,
    stopReason: null,
  };

  getJobsMap().set(id, job);
  kickQueuedJobs();
  return jobToSnapshot(job);
}

export function listFfmpegJobs(): FfmpegJobSnapshot[] {
  cleanupExpiredJobs();
  return Array.from(getJobsMap().values())
    .map((job) => jobToSnapshot(job))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getFfmpegJob(id: string): FfmpegJobSnapshot | null {
  cleanupExpiredJobs();
  const job = getJobsMap().get(id);
  if (!job) return null;
  return jobToSnapshot(job);
}

export function pauseFfmpegJob(id: string): FfmpegJobSnapshot | null {
  const job = getJobsMap().get(id);
  if (!job) return null;

  if (job.status === 'queued') {
    job.status = 'paused';
    job.updatedAt = Date.now();
    return jobToSnapshot(job);
  }

  if (job.status === 'running' && job.process) {
    job.stopReason = 'pause';
    try {
      job.process.kill('SIGTERM');
    } catch {
      // ignore kill errors
    }
  }

  return jobToSnapshot(job);
}

export async function resumeFfmpegJob(
  id: string,
): Promise<FfmpegJobSnapshot | null> {
  const job = getJobsMap().get(id);
  if (!job) return null;

  if (job.status === 'running' || job.status === 'queued') {
    return jobToSnapshot(job);
  }

  try {
    await fs.unlink(job.outputPath);
  } catch {
    // ignore missing file
  }

  job.status = 'queued';
  job.progress = 0;
  job.speed = '0x';
  job.downloadedBytes = 0;
  job.durationSeconds = null;
  job.error = undefined;
  job.updatedAt = Date.now();
  job.stopReason = null;

  kickQueuedJobs();
  return jobToSnapshot(job);
}

export async function removeFfmpegJob(id: string): Promise<boolean> {
  const jobs = getJobsMap();
  const job = jobs.get(id);
  if (!job) return false;

  jobs.delete(id);

  if (job.process) {
    job.stopReason = 'remove';
    try {
      job.process.kill('SIGTERM');
    } catch {
      // ignore kill errors
    }
  }

  try {
    await fs.unlink(job.outputPath);
  } catch {
    // ignore
  }

  kickQueuedJobs();
  return true;
}

export async function getFfmpegOutputFile(
  id: string,
): Promise<FfmpegOutputFile | null> {
  const job = getJobsMap().get(id);
  if (!job || job.status !== 'completed') return null;

  try {
    await fs.access(job.outputPath);
    return {
      path: job.outputPath,
      fileName: job.fileName,
    };
  } catch {
    return null;
  }
}
