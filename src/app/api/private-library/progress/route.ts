import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import {
  reportPrivateLibraryProgress,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';

export const runtime = 'nodejs';

interface ProgressBody {
  connectorId?: string;
  sourceItemId?: string;
  event?: 'progress' | 'stopped' | 'played';
  positionTicks?: number;
  runtimeTicks?: number;
  paused?: boolean;
}

function isValidEvent(
  value: ProgressBody['event'],
): value is 'progress' | 'stopped' | 'played' {
  return value === 'progress' || value === 'stopped' || value === 'played';
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as ProgressBody;
    const connectorId = (body.connectorId || '').trim();
    const sourceItemId = (body.sourceItemId || '').trim();
    const event = body.event || 'progress';
    const authInfo = getAuthInfoFromCookie(request);
    const username =
      authInfo?.username || (authResult.isLocalMode ? '__local__' : '');

    if (!username) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!connectorId || !sourceItemId) {
      return NextResponse.json(
        { error: 'connectorId 和 sourceItemId 不能为空' },
        { status: 400 },
      );
    }

    if (!isValidEvent(event)) {
      return NextResponse.json(
        { error: 'event 必须是 progress、stopped 或 played' },
        { status: 400 },
      );
    }

    const result = await reportPrivateLibraryProgress(username, {
      connectorId,
      sourceItemId,
      event,
      positionTicks: Number(body.positionTicks || 0),
      runtimeTicks: Number(body.runtimeTicks || 0),
      paused: Boolean(body.paused),
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.detail || '播放进度同步失败' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      ok: true,
      synced: result.synced,
      ...(result.detail ? { details: result.detail } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '播放进度同步失败',
        details: toPrivateLibraryErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
