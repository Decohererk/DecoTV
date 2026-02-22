/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

type StreamType = 'm3u8' | 'mp4' | 'flv' | 'unknown';

function detectTypeFromContentType(contentType: string | null): StreamType {
  if (!contentType) return 'unknown';
  const lowerContentType = contentType.toLowerCase();

  if (
    lowerContentType.includes('application/vnd.apple.mpegurl') ||
    lowerContentType.includes('application/x-mpegurl') ||
    lowerContentType.includes('audio/mpegurl') ||
    lowerContentType.includes('mpegurl')
  ) {
    return 'm3u8';
  }

  if (lowerContentType.includes('video/mp4')) {
    return 'mp4';
  }

  if (
    lowerContentType.includes('video/x-flv') ||
    lowerContentType.includes('application/x-flv') ||
    lowerContentType.includes('flv')
  ) {
    return 'flv';
  }

  return 'unknown';
}

function detectTypeFromUrl(rawUrl: string): StreamType {
  const lowerUrl = rawUrl.toLowerCase();

  if (lowerUrl.includes('.m3u8')) return 'm3u8';
  if (lowerUrl.includes('.mp4')) return 'mp4';
  if (lowerUrl.includes('.flv')) return 'flv';

  return 'unknown';
}

async function sniffTypeFromBody(response: Response): Promise<StreamType> {
  const reader = response.body?.getReader();
  if (!reader) return 'unknown';

  try {
    const chunks: Uint8Array[] = [];
    let totalLength = 0;

    while (totalLength < 2048) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      totalLength += value.byteLength;
      if (totalLength >= 2048) break;
    }

    if (chunks.length === 0) {
      return 'unknown';
    }

    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }

    // FLV 文件头: "FLV"
    if (
      merged.length >= 3 &&
      merged[0] === 0x46 &&
      merged[1] === 0x4c &&
      merged[2] === 0x56
    ) {
      return 'flv';
    }

    // MP4 文件签名: 第 4-7 字节为 "ftyp"
    if (
      merged.length >= 12 &&
      merged[4] === 0x66 &&
      merged[5] === 0x74 &&
      merged[6] === 0x79 &&
      merged[7] === 0x70
    ) {
      return 'mp4';
    }

    // M3U8 文本头
    const textHead = new TextDecoder('utf-8')
      .decode(merged)
      .trimStart()
      .toUpperCase();
    if (textHead.startsWith('#EXTM3U')) {
      return 'm3u8';
    }

    return 'unknown';
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');
  const source = searchParams.get('decotv-source');

  if (!url) {
    return NextResponse.json({ error: 'Missing url' }, { status: 400 });
  }
  const config = await getConfig();
  const liveSource = config.LiveConfig?.find((s: any) => s.key === source);
  if (!liveSource) {
    return NextResponse.json({ error: 'Source not found' }, { status: 404 });
  }
  const ua = liveSource.ua || 'AptvPlayer/1.4.10';

  try {
    const startedAt = Date.now();
    const decodedUrl = decodeURIComponent(url);
    const targetUrl = new URL(decodedUrl);
    let detectedType = detectTypeFromUrl(decodedUrl);

    const requestHeaders = new Headers();
    requestHeaders.set('User-Agent', ua);
    requestHeaders.set('Accept', '*/*');
    requestHeaders.set(
      'Referer',
      `${targetUrl.protocol}//${targetUrl.host}${targetUrl.pathname}`,
    );
    requestHeaders.set('Origin', `${targetUrl.protocol}//${targetUrl.host}`);

    let response = await fetch(decodedUrl, {
      cache: 'no-cache',
      redirect: 'follow',
      headers: {
        ...Object.fromEntries(requestHeaders.entries()),
        Range: 'bytes=0-2047',
      },
    });

    if (response.status === 416) {
      response = await fetch(decodedUrl, {
        cache: 'no-cache',
        redirect: 'follow',
        headers: requestHeaders,
      });
    }

    if (!response.ok && response.status !== 206) {
      return NextResponse.json(
        {
          error: 'Failed to fetch',
          message: response.statusText,
          latencyMs: Date.now() - startedAt,
        },
        { status: 500 },
      );
    }

    const contentType = response.headers.get('Content-Type');
    const contentTypeType = detectTypeFromContentType(contentType);
    if (contentTypeType !== 'unknown') {
      detectedType = contentTypeType;
    } else {
      const redirectedType = detectTypeFromUrl(response.url);
      if (redirectedType !== 'unknown') {
        detectedType = redirectedType;
      } else {
        const sniffedType = await sniffTypeFromBody(response);
        if (sniffedType !== 'unknown') {
          detectedType = sniffedType;
        }
      }
    }

    if (response.body) {
      response.body.cancel().catch(() => {});
    }

    const latencyMs = Date.now() - startedAt;
    return NextResponse.json(
      {
        success: true,
        type: detectedType === 'unknown' ? 'm3u8' : detectedType,
        latencyMs,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch', message: error },
      { status: 500 },
    );
  }
}
