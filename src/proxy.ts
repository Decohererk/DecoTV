import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';
import { isPublicAdminAllowed, isPublicMode } from '@/lib/auth-mode';
import { verifyAuthToken } from '@/lib/auth-signature';

export async function proxy(request: NextRequest) {
  let pathname = request.nextUrl.pathname;
  let contentMode: string | null = null;

  const rewriteUrl = request.nextUrl.clone();
  let shouldRewrite = false;

  while (true) {
    const qualityMatch = pathname.match(/^\/quality\/([^/]+)(\/.*)$/i);
    const shortQualityMatch = pathname.match(
      /^\/q(360|480|720|1080|1440|2160)(\/.*)$/i,
    );

    if (pathname.startsWith('/adult/')) {
      pathname = pathname.replace('/adult/', '/');
      rewriteUrl.searchParams.set('adult', '1');
      contentMode = 'adult';
      shouldRewrite = true;
      continue;
    }

    if (qualityMatch) {
      pathname = qualityMatch[2] || '/';
      rewriteUrl.searchParams.set('minResolution', qualityMatch[1]);
      shouldRewrite = true;
      continue;
    }

    if (shortQualityMatch) {
      pathname = shortQualityMatch[2] || '/';
      rewriteUrl.searchParams.set('minResolution', shortQualityMatch[1]);
      shouldRewrite = true;
      continue;
    }

    break;
  }

  // 处理成人内容和质量过滤路径重写。
  // 例如 /adult/quality/720/api/search -> /api/search?adult=1&minResolution=720
  if (shouldRewrite) {
    rewriteUrl.pathname = pathname;
    const response = NextResponse.rewrite(rewriteUrl);
    if (contentMode) {
      response.headers.set('X-Content-Mode', contentMode);
    }

    // 如果是 API 请求，继续处理认证
    if (pathname.startsWith('/api')) {
      // 不返回，继续执行下面的认证逻辑
      request = new NextRequest(rewriteUrl, request);
      pathname = request.nextUrl.pathname;
    } else {
      return response;
    }
  }

  if (isPublicMode() && isPublicModeAllowedPath(pathname)) {
    return NextResponse.next();
  }

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  if (request.method === 'OPTIONS' && pathname.startsWith('/api/proxy')) {
    return NextResponse.next();
  }

  if (!process.env.PASSWORD) {
    // 如果没有设置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo || !authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（签名内容包含 username/role/签发时间/过期时间，过期即失效）
  const isValidSignature = await verifyAuthToken(authInfo);
  if (!isValidSignature) {
    return handleAuthFailure(request, pathname);
  }

  return NextResponse.next();
}

function isPublicModeAllowedPath(pathname: string): boolean {
  if (pathname.startsWith('/admin') || pathname.startsWith('/api/admin')) {
    return isPublicAdminAllowed();
  }

  const publicPages = [
    '/',
    '/search',
    '/douban',
    '/play',
    '/live',
    '/source-browser',
    '/netdisk',
    '/my-library',
  ];

  if (
    publicPages.some(
      (path) =>
        pathname === path || (path !== '/' && pathname.startsWith(path)),
    )
  ) {
    return true;
  }

  const publicApis = [
    '/api/search',
    '/api/categories',
    '/api/detail',
    '/api/playrecords',
    '/api/favorites',
    '/api/searchhistory',
    '/api/skipconfigs',
    '/api/skip-presets',
    '/api/douban',
    '/api/image-proxy',
    '/api/proxy',
    '/api/live',
    '/api/pansou',
    '/api/playback',
    '/api/tmdb',
    '/api/private-library',
    '/api/source-browser',
    '/api/danmu-external',
  ];

  return publicApis.some((path) => pathname.startsWith(path));
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string,
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    const headers = new Headers();
    if (pathname.startsWith('/api/proxy')) {
      headers.set('Access-Control-Allow-Origin', '*');
      headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      headers.set(
        'Access-Control-Allow-Headers',
        'Content-Type, Range, Origin, Accept',
      );
      headers.set(
        'Access-Control-Expose-Headers',
        'Content-Length, Content-Range, Accept-Ranges, Content-Type',
      );
    }
    return new NextResponse('Unauthorized', { status: 401, headers });
  }

  // 否则重定向到登录页面
  const loginUrl = new URL('/login', request.url);
  // 保留完整的URL，包括查询参数
  const fullUrl = `${pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set('redirect', fullUrl);
  return NextResponse.redirect(loginUrl);
}

// 判断是否需要跳过认证的路径
function shouldSkipAuth(pathname: string): boolean {
  const skipPaths = [
    '/_next',
    '/favicon.ico',
    '/robots.txt',
    '/manifest.json',
    '/icons/',
    '/logo.png',
    '/screenshot.png',
    '/api/tvbox/config',
    '/api/tvbox/diagnose',
    '/api/tvbox/douban',
    '/api/tvbox/search',
    '/api/proxy/spider.jar',
    '/api/proxy/m3u8-filter',
    '/api/proxy/m3u8-asset',
    '/register', // 允许访问注册页面
  ];

  // 本地模式 (无数据库) 下，允许跳过 admin API 鉴权
  // 这是为了解决"鸡生蛋"问题：用户需要先配置系统才能登录，但登录又需要先有配置
  // 安全性说明：仅当 STORAGE_TYPE=localstorage 且没有设置数据库连接时才生效
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const hasRedis = !!(process.env.REDIS_URL || process.env.KV_REST_API_URL);

  if (
    storageType === 'localstorage' &&
    !hasRedis &&
    (!isPublicMode() || isPublicAdminAllowed())
  ) {
    // 本地模式下允许访问 admin 相关 API（用于获取/保存配置）
    const localModeAllowedPaths = [
      '/api/admin/config',
      '/api/admin/site',
      '/api/admin/source',
      '/api/admin/category',
      '/api/admin/pansou',
      '/api/admin/live',
      '/api/admin/user',
      '/api/admin/config_file',
      '/api/admin/reset',
      '/admin', // 允许直接访问 admin 页面
    ];

    if (localModeAllowedPaths.some((path) => pathname.startsWith(path))) {
      return true;
    }
  }

  return skipPaths.some((path) => pathname.startsWith(path));
}

// 配置 proxy 匹配规则
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/version|VERSION.txt|version.json).*)',
  ],
};
