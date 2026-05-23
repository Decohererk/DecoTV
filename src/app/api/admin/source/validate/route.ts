/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { API_CONFIG, ApiSite, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

type SourceValidationStatus = 'valid' | 'no_results' | 'invalid';

interface SourceValidationPayload {
  type: 'source_result' | 'source_error';
  source: string;
  status: SourceValidationStatus;
  resultCount?: number;
  message?: string;
}

const VALIDATION_TIMEOUT_MS =
  Number(process.env.SOURCE_VALIDATE_TIMEOUT_MS) || 12000;
const VALIDATION_CONCURRENCY =
  Number(process.env.SOURCE_VALIDATE_CONCURRENCY) || 6;

function buildSearchUrl(apiBaseUrl: string, searchKeyword: string): string {
  try {
    const url = new URL(apiBaseUrl);
    url.searchParams.set('ac', 'videolist');
    url.searchParams.set('wd', searchKeyword);
    return url.toString();
  } catch {
    const separator = apiBaseUrl.includes('?') ? '&' : '?';
    return `${apiBaseUrl}${separator}ac=videolist&wd=${encodeURIComponent(
      searchKeyword,
    )}`;
  }
}

async function readJson(response: Response): Promise<any> {
  const text = await response.text();
  const normalized = text.trim().replace(/^\uFEFF/, '');
  if (!normalized) return null;
  return JSON.parse(normalized);
}

async function validateSource(
  site: ApiSite,
  searchKeyword: string,
): Promise<SourceValidationPayload> {
  if (!site.api) {
    return {
      type: 'source_error',
      source: site.key,
      status: 'invalid',
      message: '源地址为空',
    };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VALIDATION_TIMEOUT_MS);

  try {
    const response = await fetch(buildSearchUrl(site.api, searchKeyword), {
      cache: 'no-store',
      headers: API_CONFIG.search.headers,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        type: 'source_error',
        source: site.key,
        status: 'invalid',
        message: `HTTP ${response.status}`,
      };
    }

    const data = await readJson(response);
    const list = Array.isArray(data?.list) ? data.list : [];

    if (list.length === 0) {
      return {
        type: 'source_result',
        source: site.key,
        status: 'no_results',
        resultCount: 0,
        message: '无搜索结果',
      };
    }

    return {
      type: 'source_result',
      source: site.key,
      status: 'valid',
      resultCount: list.length,
      message: `搜索正常，返回 ${list.length} 条结果`,
    };
  } catch (error: any) {
    const aborted =
      error?.name === 'AbortError' ||
      error?.code === 20 ||
      error?.message?.includes('aborted');

    return {
      type: 'source_error',
      source: site.key,
      status: 'invalid',
      message: aborted ? '请求超时' : error?.message || '连接失败',
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex++];
      await worker(item);
    }
  });
  await Promise.allSettled(workers);
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  if (!authResult.isValid && !authResult.isLocalMode) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const searchKeyword = searchParams.get('q')?.trim();

  if (!searchKeyword) {
    return NextResponse.json({ error: '搜索关键词不能为空' }, { status: 400 });
  }

  const config = await getConfig();
  const apiSites = Array.isArray(config.SourceConfig)
    ? config.SourceConfig
    : [];

  let streamClosed = false;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const safeSend = (payload: unknown) => {
        if (streamClosed) return false;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
          );
          return true;
        } catch (error) {
          console.warn('Failed to enqueue validation data:', error);
          streamClosed = true;
          return false;
        }
      };

      let completedSources = 0;
      const heartbeat = setInterval(() => {
        safeSend({ type: 'ping' });
      }, 15000);

      try {
        safeSend({
          type: 'start',
          totalSources: apiSites.length,
          concurrency: VALIDATION_CONCURRENCY,
        });

        await runWithConcurrency(
          apiSites,
          VALIDATION_CONCURRENCY,
          async (site) => {
            const result = await validateSource(site, searchKeyword);
            completedSources++;
            safeSend(result);
          },
        );

        safeSend({
          type: 'complete',
          completedSources,
        });
      } finally {
        clearInterval(heartbeat);
        if (!streamClosed) {
          try {
            controller.close();
          } catch (error) {
            console.warn('Failed to close validation stream:', error);
          }
        }
      }
    },

    cancel() {
      streamClosed = true;
      console.log('Client disconnected, cancelling validation stream');
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
