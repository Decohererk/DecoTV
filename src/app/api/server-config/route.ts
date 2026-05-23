/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthMode, isPublicAdminAllowed } from '@/lib/auth-mode';
import { getConfig } from '@/lib/config';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  console.log('server-config called: ', request.url);

  const { searchParams } = new URL(request.url);
  const config = await getConfig();

  // 检查是否通过URL参数控制成人内容过滤
  const adultParam = searchParams.get('adult');
  const filterParam = searchParams.get('filter');

  let adultFilterEnabled = !config.SiteConfig.DisableYellowFilter;

  // URL参数覆盖全局配置
  if (adultParam === '1' || adultParam === 'true') {
    adultFilterEnabled = false;
  } else if (adultParam === '0' || adultParam === 'false') {
    adultFilterEnabled = true;
  } else if (filterParam === 'off' || filterParam === 'disable') {
    adultFilterEnabled = false;
  } else if (filterParam === 'on' || filterParam === 'enable') {
    adultFilterEnabled = true;
  }

  const result = {
    SiteName: config.SiteConfig.SiteName,
    StorageType: process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage',
    AuthMode: getAuthMode(),
    PublicAllowAdmin: isPublicAdminAllowed(),
    Version: CURRENT_VERSION,
    EnableRegistration: process.env.NEXT_PUBLIC_ENABLE_REGISTRATION === 'true',
    // 🔒 成人内容过滤状态（新增）
    AdultFilterEnabled: adultFilterEnabled,
    // 🖼️ 登录页面背景图
    LoginBackground:
      config.SiteConfig.LoginBackground ||
      'https://pan.yyds.nyc.mn/background.png',
    PrivateLibraryEnabled: Boolean(
      config.PrivateLibraryConfig?.connectors?.some((item) => item.enabled),
    ),
    SearchResultLoadMode:
      config.SiteConfig.SearchResultLoadMode === 'pagination'
        ? 'pagination'
        : 'infinite',
    PlaybackProxyMode: process.env.NEXT_PUBLIC_PLAYBACK_PROXY_MODE || 'smart',
    PlaybackMaxAutoSwitch: Number(process.env.PLAYBACK_MAX_AUTO_SWITCH) || 3,
    // 提供说明信息
    AdultFilterInfo: {
      enabled: adultFilterEnabled,
      source: adultParam || filterParam ? 'url_param' : 'global_config',
      message: adultFilterEnabled
        ? '成人内容过滤已启用（家庭安全模式）'
        : '成人内容过滤已禁用（完整内容模式）',
    },
  };
  return NextResponse.json(result);
}
