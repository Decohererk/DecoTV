import { NextRequest, NextResponse } from 'next/server';

import {
  isTmdbEnabled,
  TmdbError,
  tmdbGetCredits,
  tmdbGetEpisodeDetail,
  tmdbGetImages,
  tmdbGetMovieDetail,
  tmdbGetSimilar,
  tmdbGetTvDetail,
  tmdbSearch,
} from '@/lib/tmdb';

export const runtime = 'nodejs';

type SearchType = 'movie' | 'tv' | 'multi';
type DetailType = 'movie' | 'tv';

function mapTmdbError(error: unknown): {
  status: number;
  error: string;
  details?: string;
} {
  if (error instanceof TmdbError) {
    if (error.code === 'disabled') {
      return { status: 400, error: 'TMDB 未启用' };
    }

    if (error.code === 'timeout') {
      return {
        status: 504,
        error: 'TMDB 请求超时',
        details: '请检查网络或代理配置',
      };
    }

    if (error.code === 'network') {
      return {
        status: 502,
        error: '无法连接到 TMDB',
        details: '请检查网络或代理配置',
      };
    }

    return {
      status: error.status || 502,
      error: 'TMDB 服务暂时不可用',
    };
  }

  return {
    status: 500,
    error: 'TMDB 请求失败',
  };
}

function parsePositiveInt(value: string | null): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function isSearchType(value: string | null): value is SearchType {
  return value === 'movie' || value === 'tv' || value === 'multi';
}

function isDetailType(value: string | null): value is DetailType {
  return value === 'movie' || value === 'tv';
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const action = (searchParams.get('action') || '').trim();

  if (!(await isTmdbEnabled())) {
    return NextResponse.json({ error: 'TMDB 未启用' }, { status: 400 });
  }

  try {
    if (action === 'search') {
      const type = searchParams.get('type');
      const query = (searchParams.get('query') || '').trim();
      const page = parsePositiveInt(searchParams.get('page')) || 1;

      if (!isSearchType(type)) {
        return NextResponse.json(
          { error: 'type 必须是 movie、tv 或 multi' },
          { status: 400 },
        );
      }

      if (!query) {
        return NextResponse.json({ error: 'query 不能为空' }, { status: 400 });
      }

      return NextResponse.json(await tmdbSearch(type, query, page));
    }

    if (action === 'detail') {
      const type = searchParams.get('type');
      const id = parsePositiveInt(searchParams.get('id'));

      if (!isDetailType(type)) {
        return NextResponse.json(
          { error: 'type 必须是 movie 或 tv' },
          { status: 400 },
        );
      }

      if (!id) {
        return NextResponse.json({ error: 'id 无效' }, { status: 400 });
      }

      return NextResponse.json(
        type === 'movie'
          ? await tmdbGetMovieDetail(id)
          : await tmdbGetTvDetail(id),
      );
    }

    if (action === 'credits') {
      const type = searchParams.get('type');
      const id = parsePositiveInt(searchParams.get('id'));
      if (!isDetailType(type) || !id) {
        return NextResponse.json({ error: 'type 或 id 无效' }, { status: 400 });
      }
      return NextResponse.json(await tmdbGetCredits(type, id));
    }

    if (action === 'images') {
      const type = searchParams.get('type');
      const id = parsePositiveInt(searchParams.get('id'));
      if (!isDetailType(type) || !id) {
        return NextResponse.json({ error: 'type 或 id 无效' }, { status: 400 });
      }
      return NextResponse.json(await tmdbGetImages(type, id));
    }

    if (action === 'similar') {
      const type = searchParams.get('type');
      const id = parsePositiveInt(searchParams.get('id'));
      if (!isDetailType(type) || !id) {
        return NextResponse.json({ error: 'type 或 id 无效' }, { status: 400 });
      }
      return NextResponse.json(await tmdbGetSimilar(type, id));
    }

    if (action === 'episode') {
      const id = parsePositiveInt(searchParams.get('id'));
      const season = parsePositiveInt(searchParams.get('season'));
      const episode = parsePositiveInt(searchParams.get('episode'));

      if (!id || !season || !episode) {
        return NextResponse.json(
          { error: 'id、season 和 episode 必须是正整数' },
          { status: 400 },
        );
      }

      return NextResponse.json(await tmdbGetEpisodeDetail(id, season, episode));
    }

    return NextResponse.json(
      { error: '不支持的 TMDB action' },
      { status: 400 },
    );
  } catch (error) {
    const mapped = mapTmdbError(error);
    return NextResponse.json(
      {
        error: mapped.error,
        ...(mapped.details ? { details: mapped.details } : {}),
      },
      { status: mapped.status },
    );
  }
}
