/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  if (!authResult.isLocalMode && !authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { serverUrl } = await request.json();

    if (!serverUrl || typeof serverUrl !== 'string') {
      return NextResponse.json(
        { error: '请提供弹幕服务器地址' },
        { status: 400 },
      );
    }

    // 规范化 URL：去尾部斜杠
    const baseUrl = serverUrl.replace(/\/+$/, '');

    // 测试 1：检测服务器是否可达（访问根路径）
    const startTime = Date.now();
    let rootOk = false;
    let rootInfo: Record<string, unknown> = {};
    try {
      const rootResp = await fetch(baseUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: 'application/json' },
      });
      rootOk = rootResp.ok;
      try {
        rootInfo = await rootResp.json();
      } catch {
        // 非 JSON 也算连通
      }
    } catch (err) {
      return NextResponse.json({
        success: false,
        latency: Date.now() - startTime,
        error: `服务器不可达: ${(err as Error).message}`,
      });
    }

    // 测试 2：尝试搜索请求确认 API 可用
    let searchOk = false;
    let searchCount = 0;
    try {
      const searchUrl = `${baseUrl}/api/v2/search/anime?keyword=${encodeURIComponent('测试')}`;
      const searchResp = await fetch(searchUrl, {
        signal: AbortSignal.timeout(10000),
        headers: { Accept: 'application/json' },
      });
      if (searchResp.ok) {
        const searchData = await searchResp.json();
        searchOk = true;
        searchCount = searchData?.animes?.length || 0;
      }
    } catch {
      // 搜索失败不影响整体连通性判断
    }

    const latency = Date.now() - startTime;

    return NextResponse.json({
      success: rootOk,
      latency,
      searchAvailable: searchOk,
      searchResultCount: searchCount,
      serverInfo: rootInfo,
    });
  } catch (error) {
    console.error('弹幕服务器测试失败:', error);
    return NextResponse.json(
      { success: false, error: (error as Error).message },
      { status: 500 },
    );
  }
}
