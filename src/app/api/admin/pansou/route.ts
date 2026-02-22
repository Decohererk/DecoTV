/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { normalizePanSouConfig } from '@/lib/pansou';

export const runtime = 'nodejs';

type PanSouConfigPayload = Partial<NonNullable<AdminConfig['PanSouConfig']>> & {
  serverUrl?: string;
  token?: string;
  username?: string;
  password?: string;
};

type PanSouConfig = NonNullable<AdminConfig['PanSouConfig']>;

function buildPanSouConfig(payload: PanSouConfigPayload): PanSouConfig {
  return normalizePanSouConfig(payload);
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  if (!authResult.isLocalMode && !authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as PanSouConfigPayload;
    const nextPanSouConfig = buildPanSouConfig(body);

    const adminConfig = await getConfig();

    if (!authResult.isLocalMode) {
      const username = authResult.username;

      if (username !== process.env.USERNAME) {
        const user = adminConfig.UserConfig.Users.find(
          (item) => item.username === username,
        );
        if (!user || user.role !== 'admin' || user.banned) {
          return NextResponse.json({ error: '权限不足' }, { status: 401 });
        }
      }
    }

    adminConfig.PanSouConfig = nextPanSouConfig;
    await persistAdminConfigMutation(adminConfig);

    return NextResponse.json(
      {
        ok: true,
        storageMode: authResult.isLocalMode ? 'local' : 'cloud',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('更新 PanSou 配置失败:', error);
    return NextResponse.json(
      {
        error: '更新 PanSou 配置失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
