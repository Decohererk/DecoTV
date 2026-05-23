/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig, getLocalModeConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 🔐 使用统一认证函数，正确处理 localstorage 和数据库模式的差异
  const authResult = verifyApiAuth(request);

  try {
    const body = await request.json();

    // 本地模式（无数据库）：跳过认证，返回成功
    if (authResult.isLocalMode) {
      const {
        SiteName,
        Announcement,
        SearchDownstreamMaxPage,
        SiteInterfaceCacheTime,
        DoubanProxyType,
        DoubanProxy,
        DoubanImageProxyType,
        DoubanImageProxy,
        TmdbApiKey,
        TmdbProxyType,
        TmdbProxy,
        TmdbReverseProxy,
        DisableYellowFilter,
        FluidSearch,
        SearchResultLoadMode,
        LoginBackground,
      } = body as {
        SiteName: string;
        Announcement: string;
        SearchDownstreamMaxPage: number;
        SiteInterfaceCacheTime: number;
        DoubanProxyType: string;
        DoubanProxy: string;
        DoubanImageProxyType: string;
        DoubanImageProxy: string;
        TmdbApiKey?: string;
        TmdbProxyType?: 'direct' | 'forward' | 'reverse';
        TmdbProxy?: string;
        TmdbReverseProxy?: string;
        DisableYellowFilter: boolean;
        FluidSearch: boolean;
        SearchResultLoadMode?: 'infinite' | 'pagination';
        LoginBackground?: string;
      };

      const normalizedSearchResultLoadMode =
        SearchResultLoadMode === 'pagination' ? 'pagination' : 'infinite';

      const localConfig = getLocalModeConfig();
      localConfig.SiteConfig = {
        SiteName,
        Announcement,
        SearchDownstreamMaxPage,
        SiteInterfaceCacheTime,
        DoubanProxyType,
        DoubanProxy,
        DoubanImageProxyType,
        DoubanImageProxy,
        DisableYellowFilter,
        FluidSearch,
        SearchResultLoadMode: normalizedSearchResultLoadMode,
        LoginBackground,
      };
      localConfig.TMDBConfig = {
        ApiKey: TmdbApiKey || localConfig.TMDBConfig?.ApiKey || '',
        ProxyType: (TmdbProxyType || 'direct') as
          | 'direct'
          | 'forward'
          | 'reverse',
        Proxy: TmdbProxy || '',
        ReverseProxy: TmdbReverseProxy || '',
      };
      return NextResponse.json({
        message: '站点配置更新成功（本地模式）',
        storageMode: 'local',
      });
    }

    // 认证失败
    if (!authResult.isValid) {
      console.log('[admin/site] 认证失败:', {
        hasAuth: !!request.cookies.get('auth'),
        isLocalMode: authResult.isLocalMode,
      });
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authResult.username;

    const {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      TmdbApiKey,
      TmdbProxyType,
      TmdbProxy,
      TmdbReverseProxy,
      DisableYellowFilter,
      FluidSearch,
      SearchResultLoadMode,
      LoginBackground,
    } = body as {
      SiteName: string;
      Announcement: string;
      SearchDownstreamMaxPage: number;
      SiteInterfaceCacheTime: number;
      DoubanProxyType: string;
      DoubanProxy: string;
      DoubanImageProxyType: string;
      DoubanImageProxy: string;
      TmdbApiKey?: string;
      TmdbProxyType?: 'direct' | 'forward' | 'reverse';
      TmdbProxy?: string;
      TmdbReverseProxy?: string;
      DisableYellowFilter: boolean;
      FluidSearch: boolean;
      SearchResultLoadMode?: 'infinite' | 'pagination';
      LoginBackground?: string;
    };

    const normalizedSearchResultLoadMode =
      SearchResultLoadMode === 'pagination' ? 'pagination' : 'infinite';

    // 参数校验
    if (
      typeof SiteName !== 'string' ||
      typeof Announcement !== 'string' ||
      typeof SearchDownstreamMaxPage !== 'number' ||
      typeof SiteInterfaceCacheTime !== 'number' ||
      typeof DoubanProxyType !== 'string' ||
      typeof DoubanProxy !== 'string' ||
      typeof DoubanImageProxyType !== 'string' ||
      typeof DoubanImageProxy !== 'string' ||
      (TmdbApiKey !== undefined && typeof TmdbApiKey !== 'string') ||
      (TmdbProxyType !== undefined && typeof TmdbProxyType !== 'string') ||
      (TmdbProxy !== undefined && typeof TmdbProxy !== 'string') ||
      (TmdbReverseProxy !== undefined &&
        typeof TmdbReverseProxy !== 'string') ||
      typeof DisableYellowFilter !== 'boolean' ||
      typeof FluidSearch !== 'boolean' ||
      (SearchResultLoadMode !== undefined &&
        SearchResultLoadMode !== 'infinite' &&
        SearchResultLoadMode !== 'pagination')
    ) {
      return NextResponse.json({ error: '参数格式错误' }, { status: 400 });
    }

    const adminConfig = await getConfig();

    // 权限校验
    if (username !== process.env.USERNAME) {
      // 管理员
      const user = adminConfig.UserConfig.Users.find(
        (u) => u.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    // 更新缓存中的站点设置
    adminConfig.SiteConfig = {
      SiteName,
      Announcement,
      SearchDownstreamMaxPage,
      SiteInterfaceCacheTime,
      DoubanProxyType,
      DoubanProxy,
      DoubanImageProxyType,
      DoubanImageProxy,
      TmdbProxyType: TmdbProxyType || 'direct',
      TmdbProxy: TmdbProxy || '',
      TmdbReverseProxy: TmdbReverseProxy || '',
      DisableYellowFilter,
      FluidSearch,
      SearchResultLoadMode: normalizedSearchResultLoadMode,
      LoginBackground: LoginBackground || '',
    };

    adminConfig.TMDBConfig = {
      ...(adminConfig.TMDBConfig || {
        ApiKey: process.env.TMDB_API_KEY || '',
      }),
      ApiKey:
        TmdbApiKey !== undefined
          ? TmdbApiKey
          : adminConfig.TMDBConfig?.ApiKey || '',
      ProxyType: (TmdbProxyType || 'direct') as
        | 'direct'
        | 'forward'
        | 'reverse',
      Proxy: TmdbProxy || '',
      ReverseProxy: TmdbReverseProxy || '',
    };

    await persistAdminConfigMutation(adminConfig);

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 不缓存结果
        },
      },
    );
  } catch (error) {
    console.error('更新站点配置失败:', error);
    return NextResponse.json(
      {
        error: '更新站点配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
