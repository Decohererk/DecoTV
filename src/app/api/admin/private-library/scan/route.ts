import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  getPrivateLibraryConfig,
  scanConnector,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';

export const runtime = 'nodejs';

interface ScanBody {
  connectorId?: string;
}

interface ScanResultItem {
  ok: boolean;
  count: number;
  error?: string;
}

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
    const body = (await request.json().catch(() => ({}))) as ScanBody;
    const connectorId = (body.connectorId || '').trim();
    const cfg = await getPrivateLibraryConfig();
    const targets = cfg.connectors.filter(
      (item) => item.enabled && (!connectorId || item.id === connectorId),
    );

    if (targets.length === 0) {
      return NextResponse.json(
        { error: '未找到可扫描的私人影库连接' },
        { status: 404 },
      );
    }

    const result: Record<string, ScanResultItem> = {};
    for (const connector of targets) {
      try {
        const items = await scanConnector(connector);
        result[connector.id] = {
          ok: true,
          count: items.length,
        };
      } catch (error) {
        result[connector.id] = {
          ok: false,
          count: 0,
          error: toPrivateLibraryErrorMessage(error),
        };
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch {
    return NextResponse.json(
      {
        error: '扫描私人影库失败',
        details: '请稍后重试或检查服务连接状态',
      },
      { status: 500 },
    );
  }
}
