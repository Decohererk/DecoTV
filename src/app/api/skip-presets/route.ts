/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import type { SkipPreset } from '@/lib/types';

export const runtime = 'nodejs';

function normalizePresetName(name: unknown): string {
  return String(name || '')
    .trim()
    .slice(0, 20);
}

function normalizePreset(preset: unknown): SkipPreset | null {
  if (!preset || typeof preset !== 'object') return null;

  const payload = preset as Record<string, unknown>;
  const name = normalizePresetName(payload.name);
  if (!name) return null;

  const category = String(payload.category || '通用').trim();
  const allowedCategories = new Set([
    '通用',
    '动漫',
    '欧美剧',
    '日剧',
    '韩剧',
    '综艺',
    '纪录片',
  ]);

  return {
    id:
      typeof payload.id === 'string' && payload.id
        ? payload.id
        : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    category: allowedCategories.has(category)
      ? (category as SkipPreset['category'])
      : '通用',
    pinned: Boolean(payload.pinned),
    lastUsedAt: Number(payload.lastUsedAt) || 0,
    enable: Boolean(payload.enable),
    intro_time: Math.max(0, Number(payload.intro_time) || 0),
    outro_time: Math.min(0, Number(payload.outro_time) || 0),
    updatedAt: Number(payload.updatedAt) || Date.now(),
  };
}

async function ensureAuthorized(
  request: NextRequest,
): Promise<{ username: string } | { error: NextResponse }> {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return {
      error: NextResponse.json({ error: '未登录' }, { status: 401 }),
    };
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authResult.username ||
    authInfo?.username ||
    (authResult.isLocalMode ? '__local__' : '');

  if (!username) {
    return {
      error: NextResponse.json({ error: '未登录' }, { status: 401 }),
    };
  }

  if (!authResult.isLocalMode && authResult.role !== 'guest') {
    const config = await getConfig();
    if (username !== process.env.ADMIN_USERNAME) {
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user) {
        return {
          error: NextResponse.json({ error: '用户不存在' }, { status: 401 }),
        };
      }
      if (user.banned) {
        return {
          error: NextResponse.json({ error: '用户已被封禁' }, { status: 401 }),
        };
      }
    }
  }

  return { username };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await ensureAuthorized(request);
    if ('error' in auth) return auth.error;

    const presets = await db.getSkipPresets(auth.username);
    return NextResponse.json(presets);
  } catch (error) {
    console.error('获取跳过预设组失败:', error);
    return NextResponse.json({ error: '获取跳过预设组失败' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await ensureAuthorized(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const input = Array.isArray(body?.presets) ? body.presets : [];

    const sanitized = input
      .map((item: unknown) => normalizePreset(item))
      .filter((item: SkipPreset | null): item is SkipPreset => item !== null)
      .sort((a: SkipPreset, b: SkipPreset) => b.updatedAt - a.updatedAt)
      .slice(0, 50);

    await db.setSkipPresets(auth.username, sanitized);
    return NextResponse.json({ success: true, presets: sanitized });
  } catch (error) {
    console.error('保存跳过预设组失败:', error);
    return NextResponse.json({ error: '保存跳过预设组失败' }, { status: 500 });
  }
}
