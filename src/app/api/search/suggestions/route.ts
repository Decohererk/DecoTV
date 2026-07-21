/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { toSimplified } from '@/lib/chinese';
import { getAvailableApiSites, getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { yellowWords } from '@/lib/yellow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染，避免构建时静态生成报错

export async function GET(request: NextRequest) {
  try {
    // 使用统一的认证函数，支持本地模式和数据库模式
    const authResult = await verifyApiAuth(request);
    if (!authResult.isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // 获取用户名（本地模式可能没有 username）
    const authInfo = getAuthInfoFromCookie(request);
    const username =
      authInfo?.username || (authResult.isLocalMode ? '__local__' : '');

    const config = await getConfig();
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q')?.trim();

    if (!query) {
      return NextResponse.json({ suggestions: [] });
    }

    // 繁体转简体
    let normalizedQuery = query;
    try {
      normalizedQuery = await toSimplified(query);
    } catch (e) {
      console.warn('繁体转简体失败', e);
    }

    // 生成建议
    const suggestions = await generateSuggestions(
      config,
      normalizedQuery,
      username,
    );

    // 从配置中获取缓存时间，如果没有配置则使用默认值300秒（5分钟）
    const cacheTime = config.SiteConfig.SiteInterfaceCacheTime || 300;

    return NextResponse.json(
      { suggestions },
      {
        headers: {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
          'Netlify-Vary': 'query',
        },
      },
    );
  } catch (error) {
    console.error('获取搜索建议失败', error);
    return NextResponse.json({ error: '获取搜索建议失败' }, { status: 500 });
  }
}

async function generateSuggestions(
  config: AdminConfig,
  query: string,
  username: string,
): Promise<
  Array<{
    text: string;
    type: 'exact' | 'related' | 'suggestion';
    score: number;
  }>
> {
  const queryLower = query.toLowerCase();

  const apiSites = await getAvailableApiSites(username);
  let realKeywords: string[] = [];

  if (apiSites.length > 0) {
    // 取第一个可用的数据源进行搜索
    const firstSite = apiSites[0];
    const results = await searchFromApi(firstSite, query);

    realKeywords = Array.from(
      new Set(
        results
          .filter((r: any) => {
            // 成人内容过滤
            if (!config.SiteConfig.DisableYellowFilter) {
              if (firstSite.is_adult) return false;
              const typeName = r.type_name || '';
              if (yellowWords.some((word: string) => typeName.includes(word)))
                return false;
            }
            return true;
          })
          .map((r: any) => r.title)
          .filter(Boolean)
          .flatMap((title: string) => title.split(/[ -:：·、-]/))
          .filter(
            (w: string) => w.length > 1 && w.toLowerCase().includes(queryLower),
          ),
      ),
    ).slice(0, 8);
  }

  // 根据关键词与查询的匹配程度计算分数，并动态确定类型
  const realSuggestions = realKeywords.map((word) => {
    const wordLower = word.toLowerCase();
    const queryWords = queryLower.split(/[ -:：·、-]/);

    // 计算匹配分数：完全匹配得分更高
    let score = 1.0;
    if (wordLower === queryLower) {
      score = 2.0; // 完全匹配
    } else if (
      wordLower.startsWith(queryLower) ||
      wordLower.endsWith(queryLower)
    ) {
      score = 1.8; // 前缀或后缀匹配
    } else if (queryWords.some((qw) => wordLower.includes(qw))) {
      score = 1.5; // 包含查询词
    }

    // 根据匹配程度确定类型
    let type: 'exact' | 'related' | 'suggestion' = 'related';
    if (score >= 2.0) {
      type = 'exact';
    } else if (score >= 1.5) {
      type = 'related';
    } else {
      type = 'suggestion';
    }

    return {
      text: word,
      type,
      score,
    };
  });

  // 按分数降序排列，相同分数按类型优先级排列
  const sortedSuggestions = realSuggestions.sort((a, b) => {
    if (a.score !== b.score) {
      return b.score - a.score; // 分数高的在前
    }
    // 分数相同时，按类型优先级：exact > related > suggestion
    const typePriority = { exact: 3, related: 2, suggestion: 1 };
    return typePriority[b.type] - typePriority[a.type];
  });

  return sortedSuggestions;
}
