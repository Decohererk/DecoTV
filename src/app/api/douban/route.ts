import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import {
  fetchDoubanJson,
  fetchDoubanText,
  isDoubanFetchError,
  resolveServerDoubanProxyConfig,
} from '@/lib/douban-proxy';
import { DoubanItem, DoubanResult } from '@/lib/types';

interface DoubanApiResponse {
  subjects: Array<{
    id: string;
    title: string;
    cover: string;
    rate: string;
  }>;
}

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const type = searchParams.get('type');
  const tag = searchParams.get('tag');
  const pageSize = parseInt(searchParams.get('pageSize') || '16');
  const pageStart = parseInt(searchParams.get('pageStart') || '0');

  // 验证参数
  if (!type || !tag) {
    return NextResponse.json(
      { error: '缺少必要参数: type 或 tag' },
      { status: 400 },
    );
  }

  if (!['tv', 'movie'].includes(type)) {
    return NextResponse.json(
      { error: 'type 参数必须是 tv 或 movie' },
      { status: 400 },
    );
  }

  if (pageSize < 1 || pageSize > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 },
    );
  }

  if (pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 },
    );
  }

  if (tag === 'top250') {
    return handleTop250(pageStart, request);
  }

  const targetParams = new URLSearchParams({
    type,
    tag,
    sort: 'recommend',
    page_limit: pageSize.toString(),
    page_start: pageStart.toString(),
  });
  const target = `https://movie.douban.com/j/search_subjects?${targetParams.toString()}`;

  try {
    const proxyConfig = await resolveServerDoubanProxyConfig(request);
    const doubanResult = await fetchDoubanJson<DoubanApiResponse>(
      target,
      proxyConfig,
    );
    const doubanData = doubanResult.data;

    // 转换数据格式
    const list: DoubanItem[] = doubanData.subjects.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.cover,
      rate: item.rate,
      year: '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
        'X-DecoTV-Douban-Provider': doubanResult.provider,
        'X-DecoTV-Douban-Duration': doubanResult.durationMs.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取豆瓣数据失败',
        details: (error as Error).message,
        providerAttempts: isDoubanFetchError(error)
          ? error.attempts
          : undefined,
      },
      { status: 500 },
    );
  }
}

async function handleTop250(pageStart: number, request: Request) {
  const target = `https://movie.douban.com/top250?start=${pageStart}&filter=`;

  try {
    const proxyConfig = await resolveServerDoubanProxyConfig(request);
    const doubanResult = await fetchDoubanText(target, proxyConfig);
    const html = doubanResult.data;

    // 通过正则同时捕获影片 id、标题、封面以及评分
    const moviePattern =
      /<div class="item">[\s\S]*?<a[^>]+href="https?:\/\/movie\.douban\.com\/subject\/(\d+)\/"[\s\S]*?<img[^>]+alt="([^"]+)"[^>]*src="([^"]+)"[\s\S]*?<span class="rating_num"[^>]*>([^<]*)<\/span>[\s\S]*?<\/div>/g;
    const movies: DoubanItem[] = [];
    let match;

    while ((match = moviePattern.exec(html)) !== null) {
      const id = match[1];
      const title = match[2];
      const cover = match[3];
      const rate = match[4] || '';

      // 处理图片 URL，确保使用 HTTPS
      const processedCover = cover.replace(/^http:/, 'https:');

      movies.push({
        id: id,
        title: title,
        poster: processedCover,
        rate: rate,
        year: '',
      });
    }

    const apiResponse: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: movies,
    };

    const cacheTime = await getCacheTime();
    return NextResponse.json(apiResponse, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Netlify-Vary': 'query',
        'X-DecoTV-Douban-Provider': doubanResult.provider,
        'X-DecoTV-Douban-Duration': doubanResult.durationMs.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '获取豆瓣 Top250 数据失败',
        details: (error as Error).message,
        providerAttempts: isDoubanFetchError(error)
          ? error.attempts
          : undefined,
      },
      { status: 500 },
    );
  }
}
