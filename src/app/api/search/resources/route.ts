import { NextRequest, NextResponse } from 'next/server';

import { resolveAdultFilter } from '@/lib/adult-filter';
import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getAvailableApiSites, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

// OrionTV 兼容接口 - 获取可用的视频源列表
export async function GET(request: NextRequest) {
  // 使用统一的认证函数，支持本地模式和数据库模式
  const authResult = await verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 获取用户名（本地模式可能没有 username）
  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authInfo?.username || (authResult.isLocalMode ? '__local__' : '');

  try {
    const { searchParams } = new URL(request.url);
    const config = await getAvailableApiSites(username);
    const globalConfig = await getConfig();

    const shouldFilterAdult = resolveAdultFilter(
      searchParams,
      globalConfig.SiteConfig.DisableYellowFilter,
    );

    const apiSites = shouldFilterAdult
      ? config.filter((site) => !site.is_adult)
      : config;

    return NextResponse.json(apiSites, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cookie',
        'X-Adult-Filter': shouldFilterAdult ? 'enabled' : 'disabled', // 调试信息
      },
    });
  } catch {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}

// CORS 预检请求
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Cookie',
      'Access-Control-Max-Age': '86400',
    },
  });
}
