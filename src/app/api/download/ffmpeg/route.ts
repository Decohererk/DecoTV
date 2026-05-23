import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  type FfmpegJobSnapshot,
  getFfmpegJob,
  getFfmpegRuntimeSupport,
  listFfmpegJobs,
  pauseFfmpegJob,
  removeFfmpegJob,
  resumeFfmpegJob,
  startFfmpegDownload,
} from '@/lib/ffmpeg-download';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

type StartActionPayload = {
  action: 'start';
  sourceUrl: string;
  title: string;
  fileNameHint?: string;
  referer?: string;
  origin?: string;
  ua?: string;
};

type UpdateActionPayload = {
  action: 'pause' | 'resume' | 'remove';
  id: string;
};

type RequestPayload = StartActionPayload | UpdateActionPayload;

function withDownloadUrl(job: FfmpegJobSnapshot) {
  return {
    ...job,
    downloadUrl:
      job.status === 'completed'
        ? `/api/download/ffmpeg/file?id=${encodeURIComponent(job.id)}`
        : null,
  };
}

function parseHttpUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeHeaderValue(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  if (!value || /[\r\n]/.test(value)) return undefined;
  return value;
}

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    .trim();
  const protocol =
    forwardedProto || request.nextUrl.protocol.replace(':', '') || 'http';
  const host =
    forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${protocol}://${host}`;
}

function shouldForwardSameOriginAuth(
  request: NextRequest,
  targetUrl: string,
): boolean {
  try {
    const target = new URL(targetUrl);
    return (
      target.origin === getRequestOrigin(request) &&
      target.pathname.startsWith('/api/')
    );
  } catch {
    return false;
  }
}

function buildDockerInternalSourceUrl(
  request: NextRequest,
  sourceUrl: string,
): string {
  if (process.env.DOCKER_ENV !== 'true') {
    return sourceUrl;
  }

  try {
    const target = new URL(sourceUrl);
    if (
      target.origin !== getRequestOrigin(request) ||
      !target.pathname.startsWith('/api/')
    ) {
      return sourceUrl;
    }

    const internal = new URL(target.toString());
    internal.protocol = 'http:';
    internal.hostname = '127.0.0.1';
    internal.port = process.env.PORT || '3000';
    internal.username = '';
    internal.password = '';
    return internal.toString();
  } catch {
    return sourceUrl;
  }
}

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return unauthorized();
  }

  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (id) {
    const job = getFfmpegJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job: withDownloadUrl(job) });
  }

  const jobs = listFfmpegJobs().map((job) => withDownloadUrl(job));
  return NextResponse.json({ jobs });
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return unauthorized();
  }

  let payload: RequestPayload;
  try {
    payload = (await request.json()) as RequestPayload;
  } catch {
    return NextResponse.json(
      { error: 'Invalid request body' },
      { status: 400 },
    );
  }

  if (payload.action === 'start') {
    const sourceUrl = parseHttpUrl(payload.sourceUrl);
    if (!sourceUrl) {
      return NextResponse.json(
        { error: 'Invalid sourceUrl, only http/https is supported' },
        { status: 400 },
      );
    }
    if (!payload.title?.trim()) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 });
    }

    const runtimeSupport = await getFfmpegRuntimeSupport();
    if (!runtimeSupport.supported) {
      return NextResponse.json(
        {
          error:
            runtimeSupport.reason ||
            '该功能仅支持 Docker/VPS 部署，当前环境不支持 FFmpeg 二进制运行。',
          recommendation:
            '请使用“下载当前集”浏览器下载，或切换到 Docker/VPS 部署。',
        },
        { status: 501 },
      );
    }

    let job: FfmpegJobSnapshot;
    try {
      job = await startFfmpegDownload({
        sourceUrl: buildDockerInternalSourceUrl(request, sourceUrl),
        title: payload.title.trim(),
        fileNameHint: payload.fileNameHint?.trim(),
        requestHeaders: {
          referer: normalizeHeaderValue(payload.referer),
          origin: normalizeHeaderValue(payload.origin),
          userAgent: normalizeHeaderValue(payload.ua),
          cookie: shouldForwardSameOriginAuth(request, sourceUrl)
            ? normalizeHeaderValue(request.headers.get('cookie') || undefined)
            : undefined,
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: 'FFmpeg 任务启动失败',
          details: error instanceof Error ? error.message : String(error),
          recommendation:
            '请使用“下载当前集”浏览器下载，或切换到 Docker/VPS 部署。',
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      {
        job: withDownloadUrl(job),
      },
      { status: 202 },
    );
  }

  if (!payload.id?.trim()) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }
  const id = payload.id.trim();

  if (payload.action === 'pause') {
    const job = pauseFfmpegJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job: withDownloadUrl(job) });
  }

  if (payload.action === 'resume') {
    const runtimeSupport = await getFfmpegRuntimeSupport();
    if (!runtimeSupport.supported) {
      return NextResponse.json(
        {
          error:
            runtimeSupport.reason ||
            '该功能仅支持 Docker/VPS 部署，当前环境不支持 FFmpeg 二进制运行。',
          recommendation:
            '请使用“下载当前集”浏览器下载，或切换到 Docker/VPS 部署。',
        },
        { status: 501 },
      );
    }

    const job = await resumeFfmpegJob(id);
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ job: withDownloadUrl(job) });
  }

  if (payload.action === 'remove') {
    const removed = await removeFfmpegJob(id);
    if (!removed) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }
    return NextResponse.json({ removed: true });
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 });
}
