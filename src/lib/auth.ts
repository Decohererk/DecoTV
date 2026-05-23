import { NextRequest } from 'next/server';

import { isPublicAdminAllowed, isPublicMode } from './auth-mode';

// 单例缓存，避免重复打印警告
let cachedSecret: string | null | undefined;
let warnedMissingSecret = false;

// 统一获取鉴权密钥，Docker/开发环境缺失时给出警告，并在非生产环境提供安全性有限的后备值
export function getAuthSecret(): string | null {
  if (cachedSecret !== undefined) return cachedSecret;

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) {
    const isProd = process.env.NODE_ENV === 'production';
    if (!warnedMissingSecret) {
      // eslint-disable-next-line no-console
      console.warn(
        'WARNING: NEXTAUTH_SECRET/AUTH_SECRET is missing. Docker 部署请通过 -e AUTH_SECRET=... 注入，生成命令: openssl rand -base64 32',
      );
      warnedMissingSecret = true;
    }
    // 仅非生产环境提供后备，防止本地/Docker 开发直接 401
    cachedSecret = isProd ? null : 'dev-fallback-secret-do-not-use-in-prod';
    return cachedSecret;
  }

  cachedSecret = secret;
  return secret;
}

// 从cookie获取认证信息 (服务端使用)
export function getAuthInfoFromCookie(request: NextRequest): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
} | null {
  const authCookie = request.cookies.get('auth');

  if (!authCookie) {
    return null;
  }

  try {
    const decoded = decodeURIComponent(authCookie.value);
    const authData = JSON.parse(decoded);
    return authData;
  } catch {
    return null;
  }
}

// 从cookie获取认证信息 (客户端使用)
export function getAuthInfoFromBrowserCookie(): {
  password?: string;
  username?: string;
  signature?: string;
  timestamp?: number;
  role?: 'owner' | 'admin' | 'user' | 'guest';
} | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    // 解析 document.cookie
    const cookies = document.cookie.split(';').reduce(
      (acc, cookie) => {
        const trimmed = cookie.trim();
        const firstEqualIndex = trimmed.indexOf('=');

        if (firstEqualIndex > 0) {
          const key = trimmed.substring(0, firstEqualIndex);
          const value = trimmed.substring(firstEqualIndex + 1);
          if (key && value) {
            acc[key] = value;
          }
        }

        return acc;
      },
      {} as Record<string, string>,
    );

    const authCookie = cookies['auth'];
    if (!authCookie) {
      return null;
    }

    // 处理可能的双重编码
    let decoded = decodeURIComponent(authCookie);

    // 如果解码后仍然包含 %，说明是双重编码，需要再次解码
    if (decoded.includes('%')) {
      decoded = decodeURIComponent(decoded);
    }

    const authData = JSON.parse(decoded);
    return authData;
  } catch {
    return null;
  }
}

/**
 * 验证 API 请求的认证信息
 * 统一处理 localstorage 模式和数据库模式的认证差异
 *
 * @param request NextRequest 对象
 * @returns 验证结果，包含是否通过、用户名（可选）、角色、是否为站长
 */
export function verifyApiAuth(request: NextRequest): {
  isValid: boolean;
  username?: string;
  role?: 'owner' | 'admin' | 'user' | 'guest';
  isOwner: boolean;
  isLocalMode: boolean;
} {
  const storageType = process.env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage';
  const hasRedis = !!(process.env.REDIS_URL || process.env.KV_REST_API_URL);
  const isLocalMode = storageType === 'localstorage' && !hasRedis;

  const authInfo = getAuthInfoFromCookie(request);
  const pathname = request.nextUrl.pathname;
  const isAdminApi = pathname.startsWith('/api/admin');

  if (isPublicMode()) {
    if (isAdminApi) {
      if (isPublicAdminAllowed()) {
        return {
          isValid: true,
          username: process.env.USERNAME || '__public_admin__',
          role: 'owner',
          isOwner: true,
          isLocalMode,
        };
      }
      // public 模式默认不授予后台权限，继续走原密码/签名校验。
    } else {
      // public 前台 API 使用固定 guest 命名空间，避免写入站长账户。
      return {
        isValid: true,
        username: authInfo?.username || '__public_guest__',
        role:
          (authInfo as { role?: 'owner' | 'admin' | 'user' | 'guest' } | null)
            ?.role || 'guest',
        isOwner: false,
        isLocalMode,
      };
    }
  }

  // 无认证信息
  if (!authInfo) {
    return { isValid: false, isOwner: false, isLocalMode };
  }

  // localstorage 模式：验证密码
  if (isLocalMode) {
    const envPassword = process.env.PASSWORD;
    // 未设置密码时直接通过
    if (!envPassword) {
      return { isValid: true, role: 'owner', isOwner: true, isLocalMode };
    }
    // 验证密码
    if (authInfo.password && authInfo.password === envPassword) {
      return { isValid: true, role: 'owner', isOwner: true, isLocalMode };
    }
    return { isValid: false, isOwner: false, isLocalMode };
  }

  // 数据库模式：需要 username 和 signature
  if (!authInfo.username || !authInfo.signature) {
    return { isValid: false, isOwner: false, isLocalMode };
  }

  // 判断是否为站长
  const isOwner = authInfo.username === process.env.USERNAME;

  return {
    isValid: true,
    username: authInfo.username,
    role:
      (authInfo as { role?: 'owner' | 'admin' | 'user' | 'guest' }).role ||
      'user',
    isOwner,
    isLocalMode,
  };
}
