import { NextResponse } from 'next/server';

import {
  fetchDoubanJson,
  isDoubanFetchError,
  resolveServerDoubanProxyConfig,
} from '@/lib/douban-proxy';
import { resolveImageUrlCandidates } from '@/lib/image-url';

export const runtime = 'nodejs';

interface DoubanCategoryProbeResponse {
  items?: unknown[];
}

interface ImageProbeAttempt {
  provider: string;
  ok: boolean;
  status?: number;
  durationMs: number;
  reason?: string;
}

const TEST_IMAGE_URL =
  'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg';

function inferImageProvider(url: string): string {
  if (url.startsWith('/api/image-proxy') || url.includes('/api/image-proxy')) {
    return 'server';
  }
  if (url.includes('img.doubanio.cmliussss.com')) {
    return 'cmliussss-cdn-ali';
  }
  if (url.includes('img.doubanio.cmliussss.net')) {
    return 'cmliussss-cdn-tencent';
  }
  if (url.includes('img3.doubanio.com')) {
    return 'img3';
  }
  if (url === TEST_IMAGE_URL) {
    return 'direct';
  }
  return 'custom';
}

async function probeImageCandidates(request: Request): Promise<{
  ok: boolean;
  provider?: string;
  durationMs?: number;
  attempts: ImageProbeAttempt[];
}> {
  const { searchParams } = new URL(request.url);
  const proxyType = searchParams.get('proxyType') || 'auto';
  const proxyUrl = searchParams.get('proxyUrl') || '';
  const candidates = resolveImageUrlCandidates(TEST_IMAGE_URL, {
    doubanImageProxy: { proxyType, proxyUrl },
  }).filter((candidate) => candidate !== '/poster-fallback.svg');
  const attempts: ImageProbeAttempt[] = [];

  for (const candidate of candidates) {
    const absoluteUrl = candidate.startsWith('/')
      ? new URL(candidate, request.url).toString()
      : candidate;
    const provider = inferImageProvider(candidate);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const startedAt = Date.now();

    try {
      const response = await fetch(absoluteUrl, {
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Referer: 'https://movie.douban.com/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          Accept:
            'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        },
      });
      const durationMs = Date.now() - startedAt;
      const contentType = response.headers.get('content-type') || '';
      await response.body?.cancel().catch(() => undefined);

      if (response.ok && (!contentType || contentType.startsWith('image/'))) {
        attempts.push({
          provider,
          ok: true,
          status: response.status,
          durationMs,
        });
        return { ok: true, provider, durationMs, attempts };
      }

      attempts.push({
        provider,
        ok: false,
        status: response.status,
        durationMs,
        reason: contentType || response.statusText || 'not image',
      });
    } catch (error) {
      attempts.push({
        provider,
        ok: false,
        durationMs: Date.now() - startedAt,
        reason:
          error instanceof DOMException && error.name === 'AbortError'
            ? 'timeout'
            : error instanceof Error
              ? error.message
              : 'unknown error',
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  return { ok: false, attempts };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const target = searchParams.get('target') || 'data';

  if (target === 'image') {
    const result = await probeImageCandidates(request);
    return NextResponse.json(result, {
      status: result.ok ? 200 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  const params = new URLSearchParams({
    start: '0',
    limit: '1',
    category: '热门',
    type: '全部',
  });
  const probeUrl = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/movie?${params.toString()}`;

  try {
    const proxyConfig = await resolveServerDoubanProxyConfig(request);
    const result = await fetchDoubanJson<DoubanCategoryProbeResponse>(
      probeUrl,
      proxyConfig,
    );

    return NextResponse.json(
      {
        ok: true,
        provider: result.provider,
        durationMs: result.durationMs,
        attempts: result.attempts,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
          'X-DecoTV-Douban-Provider': result.provider,
          'X-DecoTV-Douban-Duration': result.durationMs.toString(),
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: (error as Error).message,
        attempts: isDoubanFetchError(error) ? error.attempts : undefined,
      },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
