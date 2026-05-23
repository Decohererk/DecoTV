/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig, getLocalModeConfig } from '@/lib/config';

export const runtime = 'nodejs';

interface AdFilterPayload {
  enabled?: boolean;
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  try {
    const body = (await request.json()) as AdFilterPayload;
    const enabled = body.enabled !== false; // 默认开

    if (authResult.isLocalMode) {
      const localConfig = getLocalModeConfig();
      localConfig.AdFilterConfig = { enabled };
      return NextResponse.json({
        message: '广告过滤配置更新成功（本地模式）',
        storageMode: 'local',
      });
    }

    if (!authResult.isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authResult.username;
    const adminConfig = await getConfig();

    if (username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (item) => item.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    adminConfig.AdFilterConfig = { enabled };

    await persistAdminConfigMutation(adminConfig);

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('更新广告过滤配置失败:', error);
    return NextResponse.json(
      {
        error: '更新广告过滤配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
