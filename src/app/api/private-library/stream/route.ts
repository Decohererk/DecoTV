import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  resolveStreamRequest,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';

export const runtime = 'nodejs';

function mapStreamError(status: number): string {
  if (status === 401 || status === 403) {
    return '私人影库鉴权失败，请检查连接配置';
  }

  if (status === 404) {
    return '未找到对应的私有媒体文件';
  }

  if (status >= 500) {
    return '上游媒体服务暂时不可用';
  }

  return '私有媒体流请求失败';
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const connectorId = (searchParams.get('connectorId') || '').trim();
    const sourceItemId = (searchParams.get('sourceItemId') || '').trim();
    const rawAudioStreamIndex = (
      searchParams.get('audioStreamIndex') || ''
    ).trim();
    const audioStreamIndex =
      rawAudioStreamIndex && /^\d+$/.test(rawAudioStreamIndex)
        ? Number(rawAudioStreamIndex)
        : undefined;

    if (!connectorId || !sourceItemId) {
      return NextResponse.json(
        { error: 'connectorId 和 sourceItemId 不能为空' },
        { status: 400 },
      );
    }

    const stream = await resolveStreamRequest(
      connectorId,
      sourceItemId,
      audioStreamIndex,
    );
    if (!stream) {
      return NextResponse.json(
        { error: '未找到可用的私有媒体流' },
        { status: 404 },
      );
    }

    const range = request.headers.get('range') || '';
    const response = await fetch(stream.url, {
      headers: {
        ...(stream.headers || {}),
        ...(range ? { Range: range } : {}),
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: mapStreamError(response.status) },
        { status: response.status },
      );
    }

    const headers = new Headers();
    const passthrough = [
      'content-type',
      'content-length',
      'accept-ranges',
      'content-range',
      'cache-control',
      'etag',
      'last-modified',
    ];

    passthrough.forEach((name) => {
      const value = response.headers.get(name);
      if (value) {
        headers.set(name, value);
      }
    });
    headers.set(
      'Cache-Control',
      headers.get('Cache-Control') || 'private, no-store',
    );

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '代理私有媒体流失败',
        details: toPrivateLibraryErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
