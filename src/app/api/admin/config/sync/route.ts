/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';

/**
 * POST /api/admin/config/sync
 *
 * 本地模式专用：将前端 localStorage 中的配置同步到后端内存存储
 * 这样搜索和播放功能就能正确读取用户配置的视频源
 */
export async function POST(request: NextRequest) {
  // 验证用户权限
  const authResult = verifyApiAuth(request);

  // 只在本地模式下允许同步
  if (!authResult.isLocalMode) {
    return NextResponse.json(
      { error: '此接口仅在本地模式下可用' },
      { status: 400 },
    );
  }

  if (!authResult.isValid) {
    return NextResponse.json({ error: '未授权' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const config = body.config as AdminConfig;

    if (!config) {
      return NextResponse.json({ error: '缺少配置数据' }, { status: 400 });
    }

    await persistAdminConfigMutation(config);

    console.log(
      '[Config Sync] 配置已同步到内存，视频源数量:',
      config.SourceConfig?.length || 0,
    );

    return NextResponse.json({
      success: true,
      message: '配置同步成功',
      sourceCount: config.SourceConfig?.length || 0,
      liveCount: config.LiveConfig?.length || 0,
    });
  } catch (error) {
    console.error('[Config Sync] 同步配置失败:', error);
    return NextResponse.json({ error: '同步配置失败' }, { status: 500 });
  }
}
