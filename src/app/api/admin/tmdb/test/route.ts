import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { isTmdbEnabled, TmdbError, tmdbSearch } from '@/lib/tmdb';

export const runtime = 'nodejs';

async function ensureAdmin(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isLocalMode && !authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authResult.isLocalMode) {
    const username = authResult.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      const user = config.UserConfig.Users.find(
        (item) => item.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  return null;
}

function mapTmdbError(error: unknown): string {
  if (error instanceof TmdbError) {
    if (error.code === 'disabled') {
      return 'TMDB API Key 未配置';
    }

    if (error.code === 'timeout') {
      return 'TMDB 请求超时，请检查代理或网络';
    }

    if (error.code === 'network') {
      return '无法连接到 TMDB，请检查代理配置';
    }

    return 'TMDB 服务暂时不可用';
  }

  return 'TMDB 连通性测试失败';
}

export async function GET(request: NextRequest) {
  const unauthorized = await ensureAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    if (!(await isTmdbEnabled())) {
      return NextResponse.json(
        { ok: false, error: 'TMDB API Key 未配置' },
        { status: 400 },
      );
    }

    const data = await tmdbSearch('movie', 'Inception', 1);
    return NextResponse.json({
      ok: true,
      sampleCount: data.results?.length || 0,
      message: 'TMDB 连通性测试通过',
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: mapTmdbError(error),
      },
      { status: 500 },
    );
  }
}
