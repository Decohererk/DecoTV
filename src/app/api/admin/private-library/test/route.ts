import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  testConnector,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';
import { normalizePrivateLibraryConfig } from '@/lib/private-library-config';

export const runtime = 'nodejs';

async function ensureAdmin(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isLocalMode && !authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authResult.isLocalMode) {
    const username = authResult.username;
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      const user = config.UserConfig.Users.find(
        (item) => item.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  return null;
}

export async function POST(request: NextRequest) {
  const unauthorized = await ensureAdmin(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = (await request.json()) as { connector?: unknown };
    const parsed = normalizePrivateLibraryConfig({
      connectors: body.connector ? [body.connector] : [],
    });
    const connector = parsed.connectors[0];

    if (!connector) {
      return NextResponse.json(
        { ok: false, error: '连接配置无效，请检查服务地址和类型' },
        { status: 400 },
      );
    }

    const result = await testConnector(connector);
    if (!result.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: result.detail || '连通性测试失败',
        },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: '连通性测试失败',
        details: toPrivateLibraryErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
