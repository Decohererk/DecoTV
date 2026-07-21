/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfigResult } from '@/lib/admin.types';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig, getLocalModeConfig } from '@/lib/config';

export const runtime = 'nodejs';

// 扩展返回类型，支持本地模式标识
interface AdminConfigResultWithMode extends AdminConfigResult {
  storageMode: 'cloud' | 'local'; // 标识当前存储模式
}

export async function GET(request: NextRequest) {
  // 🔐 使用统一认证函数，正确处理 localstorage 和数据库模式的差异
  const authResult = await verifyApiAuth(request);

  // 本地存储模式（无数据库）：免登录访问
  // 这解决了"鸡生蛋"问题：用户需要先进入面板配置系统
  if (authResult.isLocalMode) {
    const localConfig = getLocalModeConfig();
    const result: AdminConfigResultWithMode = {
      Role: 'owner', // 本地模式下默认 owner
      Config: localConfig,
      storageMode: 'local', // 告诉前端当前是本地模式（无数据库）
    };

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  }

  // 认证失败
  if (!authResult.isValid) {
    console.log('[admin/config] 认证失败:', {
      hasAuth: !!request.cookies.get('auth'),
      isLocalMode: authResult.isLocalMode,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const username = authResult.username;

  try {
    const config = await getConfig();
    const result: AdminConfigResultWithMode = {
      Role: 'owner',
      Config: config,
      storageMode: 'cloud', // 云端模式
    };
    if (username === process.env.USERNAME) {
      result.Role = 'owner';
    } else {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (user && user.role === 'admin' && !user.banned) {
        result.Role = 'admin';
      } else {
        return NextResponse.json(
          { error: '你是管理员吗你就访问？' },
          { status: 401 },
        );
      }
    }

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'no-store', // 管理员配置不缓存
      },
    });
  } catch (error) {
    console.error('获取管理员配置失败:', error);
    return NextResponse.json(
      {
        error: '获取管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
