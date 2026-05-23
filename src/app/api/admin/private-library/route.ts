import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig } from '@/lib/admin.types';
import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { getPrivateLibraryConfig } from '@/lib/private-library';
import { normalizePrivateLibraryConfig } from '@/lib/private-library-config';

export const runtime = 'nodejs';

async function ensureAdmin(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isLocalMode && !authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authResult.isLocalMode) {
    const username = authResult.username;
    const adminConfig = await getConfig();
    if (username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (item) => item.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  return null;
}

export async function GET(request: NextRequest) {
  const unauthorized = await ensureAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }

  const config = await getPrivateLibraryConfig();
  return NextResponse.json({ ok: true, config });
}

export async function POST(request: NextRequest) {
  const unauthorized = await ensureAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as { connectors?: unknown[] };
    const normalized = normalizePrivateLibraryConfig(body);
    const adminConfig = (await getConfig()) as AdminConfig;
    adminConfig.PrivateLibraryConfig = normalized;
    await persistAdminConfigMutation(adminConfig);

    return NextResponse.json({ ok: true, config: normalized });
  } catch {
    return NextResponse.json(
      {
        error: '保存私人影库配置失败',
        details: '请检查连接信息后重试',
      },
      { status: 500 },
    );
  }
}
