/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie } from '@/lib/auth';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 处理成人内容模式路径重写
  // 如果路径以 /adult/ 开头，重写到实际 API 路径并添加 adult 标记
  if (pathname.startsWith('/adult/')) {
    const actualPath = pathname.replace('/adult/', '/');
    const url = request.nextUrl.clone();
    url.pathname = actualPath;

    // 添加成人内容标记到查询参数
    url.searchParams.set('adult', '1');

    // 重写请求
    const response = NextResponse.rewrite(url);
    response.headers.set('X-Content-Mode', 'adult');

    // 如果是 API 请求，继续处理认证
    if (actualPath.startsWith('/api')) {
      // 不返回，继续执行下面的认证逻辑
      request = new NextRequest(url, request);
    } else {
      return response;
    }
  }

  // 跳过不需要认证的路径
  if (shouldSkipAuth(pathname)) {
    return NextResponse.next();
  }

  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';

  if (!process.env.PASSWORD) {
    // 如果没有设置密码，重定向到警告页面
    const warningUrl = new URL('/warning', request.url);
    return NextResponse.redirect(warningUrl);
  }

  // 从cookie获取认证信息
  const authInfo = getAuthInfoFromCookie(request);

  if (!authInfo) {
    return handleAuthFailure(request, pathname);
  }

  // localstorage模式：在proxy中完成验证
  if (storageType === 'localstorage') {
    if (!authInfo.password || authInfo.password !== process.env.PASSWORD) {
      return handleAuthFailure(request, pathname);
    }
    return NextResponse.next();
  }

  // 其他模式：只验证签名
  // 检查是否有用户名（非localStorage模式下密码不存储在cookie中）
  if (!authInfo.username || !authInfo.signature) {
    return handleAuthFailure(request, pathname);
  }

  // 验证签名（如果存在）
  if (authInfo.signature) {
    const isValidSignature = await verifySignature(
      authInfo.username,
      authInfo.signature,
      process.env.PASSWORD || '',
    );

    // 签名验证通过即可
    if (isValidSignature) {
      return NextResponse.next();
    }
  }

  // 签名验证失败或不存在签名
  return handleAuthFailure(request, pathname);
}

// 验证签名
async function verifySignature(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);

  try {
    // 导入密钥
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    // 将十六进制字符串转换为Uint8Array
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );

    // 验证签名
    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      messageData,
    );
  } catch (error) {
    console.error('签名验证失败:', error);
    return false;
  }
}

// 处理认证失败的情况
function handleAuthFailure(
  request: NextRequest,
  pathname: string,
): NextResponse {
  // 如果是 API 路由，返回 401 状态码
  if (pathname.startsWith('/api')) {
    return new NextResponse('Unauthorized', { status: 401 });
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
    '/register', // 允许访问注册页面
  ];

  // 本地模式 (无数据库) 下，允许跳过 admin API 鉴权
  // 这是为了解决"鸡生蛋"问题：用户需要先配置系统才能登录，但登录又需要先有配置
  // 安全性说明：仅当 STORAGE_TYPE=localstorage 且没有设置数据库连接时才生效
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const hasRedis = !!(process.env.REDIS_URL || process.env.KV_REST_API_URL);

  if (storageType === 'localstorage' && !hasRedis) {
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
    '/((?!_next/static|_next/image|favicon.ico|login|warning|api/login|api/register|api/logout|api/cron|api/server-config|api/version|VERSION.txt).*)',
  ],
};
