/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { revalidateAdminConfigViews } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { resetConfig } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  // 🔐 使用统一认证函数，正确处理 localstorage 和数据库模式的差异
  const authResult = await verifyApiAuth(request);

  // 本地模式（无数据库）：跳过认证，返回成功
  if (authResult.isLocalMode) {
    return NextResponse.json(
      {
        ok: true,
        storageMode: 'local',
        message: '请在前端清除 localStorage 配置',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 认证失败
  if (!authResult.isValid) {
    console.log('[admin/reset] 认证失败:', {
      hasAuth: !!request.cookies.get('auth'),
      isLocalMode: authResult.isLocalMode,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 仅站长可以重置配置
  if (!authResult.isOwner) {
    return NextResponse.json({ error: '仅支持站长重置配置' }, { status: 401 });
  }

  try {
    await resetConfig();
    revalidateAdminConfigViews();

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'no-store', // 管理员配置不缓存
        },
      },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '重置管理员配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
