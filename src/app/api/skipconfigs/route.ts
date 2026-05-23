/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { SkipConfig } from '@/lib/types';

export const runtime = 'nodejs';

async function resolveUsername(
  request: NextRequest,
): Promise<{ username: string } | NextResponse> {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authResult.username ||
    authInfo?.username ||
    (authResult.isLocalMode ? '__local__' : '');

  if (!username) {
    return NextResponse.json({ error: '未登录' }, { status: 401 });
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

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveUsername(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const source = searchParams.get('source');
    const id = searchParams.get('id');

    if (source && id) {
      // 获取单个配置
      const config = await db.getSkipConfig(auth.username, source, id);
      return NextResponse.json(config);
    } else {
      // 获取所有配置
      const configs = await db.getAllSkipConfigs(auth.username);
      return NextResponse.json(configs);
    }
  } catch (error) {
    console.error('获取跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '获取跳过片头片尾配置失败' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveUsername(request);
    if (auth instanceof NextResponse) return auth;

    const body = await request.json();
    const { key, config } = body;

    if (!key || !config) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 解析key为source和id
    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json({ error: '无效的key格式' }, { status: 400 });
    }

    // 验证配置格式
    const skipConfig: SkipConfig = {
      enable: Boolean(config.enable),
      intro_time: Number(config.intro_time) || 0,
      outro_time: Number(config.outro_time) || 0,
      preset_id:
        typeof config.preset_id === 'string' && config.preset_id
          ? config.preset_id
          : undefined,
      preset_name:
        typeof config.preset_name === 'string' && config.preset_name
          ? String(config.preset_name).trim().slice(0, 20)
          : undefined,
      preset_category:
        typeof config.preset_category === 'string' && config.preset_category
          ? (config.preset_category as SkipConfig['preset_category'])
          : undefined,
      preset_pinned: Boolean(config.preset_pinned),
    };

    await db.setSkipConfig(auth.username, source, id, skipConfig);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('保存跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '保存跳过片头片尾配置失败' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolveUsername(request);
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (!key) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 });
    }

    // 解析key为source和id
    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json({ error: '无效的key格式' }, { status: 400 });
    }

    await db.deleteSkipConfig(auth.username, source, id);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('删除跳过片头片尾配置失败:', error);
    return NextResponse.json(
      { error: '删除跳过片头片尾配置失败' },
      { status: 500 },
    );
  }
}
