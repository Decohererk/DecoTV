/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

// 最大保存条数（与客户端保持一致）
const HISTORY_LIMIT = 20;

async function resolveUsername(
  request: NextRequest,
): Promise<{ username: string } | NextResponse> {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authResult.username ||
    authInfo?.username ||
    (authResult.isLocalMode ? '__local__' : '');

  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authResult.isLocalMode && authResult.role !== 'guest') {
    const config = await getConfig();
    if (username !== process.env.ADMIN_USERNAME) {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user) {
        return NextResponse.json({ error: '用户不存在' }, { status: 401 });
      }
      if (user.banned) {
        return NextResponse.json({ error: '用户已被封禁' }, { status: 401 });
      }
    }
  }

  return { username };
}

/**
 * GET /api/searchhistory
 * 返回 string[]
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await resolveUsername(request);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const history = await db.getSearchHistory(auth.username);
    return NextResponse.json(history, { status: 200 });
  } catch (err) {
    console.error('获取搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

/**
 * POST /api/searchhistory
 * body: { keyword: string }
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await resolveUsername(request);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const body = await request.json();
    const keyword: string = body.keyword?.trim();

    if (!keyword) {
      return NextResponse.json(
        { error: 'Keyword is required' },
        { status: 400 },
      );
    }

    await db.addSearchHistory(auth.username, keyword);

    // 再次获取最新列表，确保客户端与服务端同步
    const history = await db.getSearchHistory(auth.username);
    return NextResponse.json(history.slice(0, HISTORY_LIMIT), { status: 200 });
  } catch (err) {
    console.error('添加搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/searchhistory?keyword=<kw>
 *
 * 1. 不带 keyword -> 清空全部搜索历史
 * 2. 带 keyword=<kw> -> 删除单条关键字
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolveUsername(request);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const { searchParams } = new URL(request.url);
    const kw = searchParams.get('keyword')?.trim();

    await db.deleteSearchHistory(auth.username, kw || undefined);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (err) {
    console.error('删除搜索历史失败', err);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
