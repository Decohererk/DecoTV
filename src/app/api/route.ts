/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

// 根路径 API - 为 OrionTV 提供服务器信息和健康检查
// 支持成人内容模式检测
export async function GET(request: NextRequest) {
  console.log('Root API called:', request.url);

  const authInfo = getAuthInfoFromCookie(request);
  const { searchParams } = new URL(request.url);
  const config = await getConfig();

  // 检测成人内容模式
  const adultParam = searchParams.get('adult');
  const filterParam = searchParams.get('filter');
  const contentMode = request.headers.get('X-Content-Mode');

  let adultFilterEnabled = !config.SiteConfig.DisableYellowFilter;

  // URL参数或路径模式覆盖全局配置
  if (adultParam === '1' || adultParam === 'true' || contentMode === 'adult') {
    adultFilterEnabled = false;
  } else if (adultParam === '0' || adultParam === 'false') {
    adultFilterEnabled = true;
  } else if (filterParam === 'off' || filterParam === 'disable') {
    adultFilterEnabled = false;
  } else if (filterParam === 'on' || filterParam === 'enable') {
    adultFilterEnabled = true;
  }

  return NextResponse.json(
    {
      server: 'DecoTV',
      version: CURRENT_VERSION,
      siteName: config.SiteConfig.SiteName,
      status: 'online',
      user: authInfo?.username || 'guest',
      authenticated: !!authInfo,
      adultFilterEnabled,
      contentMode: adultFilterEnabled ? 'family' : 'adult',
      storageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
      message: authInfo ? '服务器运行正常' : '服务器运行正常，请先登录',
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Cookie',
        'X-Adult-Filter': adultFilterEnabled ? 'enabled' : 'disabled',
      },
    },
  );
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
