/* eslint-disable no-console,no-case-declarations */

import { NextRequest, NextResponse } from 'next/server';

import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { deleteCachedLiveChannels, refreshLiveChannels } from '@/lib/live';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  // 🔐 使用统一认证函数，正确处理 localstorage 和数据库模式的差异
  const authResult = await verifyApiAuth(request);

  // 本地模式（无数据库）：跳过认证，返回成功
  if (authResult.isLocalMode) {
    return NextResponse.json(
      {
        ok: true,
        storageMode: 'local',
        message: '请在前端保存配置到 localStorage',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // 认证失败
  if (!authResult.isValid) {
    console.log('[admin/live] 认证失败:', {
      hasAuth: !!request.cookies.get('auth'),
      isLocalMode: authResult.isLocalMode,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 权限检查（仅数据库模式需要）
    const username = authResult.username;
    const config = await getConfig();
    if (username && username !== process.env.USERNAME) {
      // 管理员
      const user = config.UserConfig.Users.find((u) => u.username === username);
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    const body = await request.json();
    const { action, key, name, url, ua, epg } = body;

    if (!config) {
      return NextResponse.json({ error: '配置不存在' }, { status: 404 });
    }

    // 确保 LiveConfig 存在
    if (!config.LiveConfig) {
      config.LiveConfig = [];
    }

    switch (action) {
      case 'add':
        // 检查是否已存在相同的 key
        if (config.LiveConfig.some((l) => l.key === key)) {
          return NextResponse.json(
            { error: '直播源 key 已存在' },
            { status: 400 },
          );
        }

        const liveInfo = {
          key: key as string,
          name: name as string,
          url: url as string,
          ua: ua || '',
          epg: epg || '',
          from: 'custom' as 'custom' | 'config',
          channelNumber: 0,
          disabled: false,
        };

        try {
          const nums = await refreshLiveChannels(liveInfo);
          liveInfo.channelNumber = nums;
        } catch (error) {
          console.error('刷新直播源失败:', error);
          liveInfo.channelNumber = 0;
        }

        // 添加新的直播源
        config.LiveConfig.push(liveInfo);
        break;

      case 'delete':
        // 删除直播源
        const deleteIndex = config.LiveConfig.findIndex((l) => l.key === key);
        if (deleteIndex === -1) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }

        const liveSource = config.LiveConfig[deleteIndex];
        if (liveSource.from === 'config') {
          return NextResponse.json(
            { error: '不能删除配置文件中的直播源' },
            { status: 400 },
          );
        }

        deleteCachedLiveChannels(key);

        config.LiveConfig.splice(deleteIndex, 1);
        break;

      case 'enable':
        // 启用直播源
        const enableSource = config.LiveConfig.find((l) => l.key === key);
        if (!enableSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }
        enableSource.disabled = false;
        break;

      case 'disable':
        // 禁用直播源
        const disableSource = config.LiveConfig.find((l) => l.key === key);
        if (!disableSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }
        disableSource.disabled = true;
        break;

      case 'edit':
        // 编辑直播源
        const editSource = config.LiveConfig.find((l) => l.key === key);
        if (!editSource) {
          return NextResponse.json({ error: '直播源不存在' }, { status: 404 });
        }

        // 配置文件中的直播源不允许编辑
        if (editSource.from === 'config') {
          return NextResponse.json(
            { error: '不能编辑配置文件中的直播源' },
            { status: 400 },
          );
        }

        // 更新字段（除了 key 和 from）
        editSource.name = name as string;
        editSource.url = url as string;
        editSource.ua = ua || '';
        editSource.epg = epg || '';

        // 刷新频道数
        try {
          const nums = await refreshLiveChannels(editSource);
          editSource.channelNumber = nums;
        } catch (error) {
          console.error('刷新直播源失败:', error);
          editSource.channelNumber = 0;
        }
        break;

      case 'sort':
        // 排序直播源
        const { order } = body;
        if (!Array.isArray(order)) {
          return NextResponse.json(
            { error: '排序数据格式错误' },
            { status: 400 },
          );
        }

        // 创建新的排序后的数组
        const sortedLiveConfig: typeof config.LiveConfig = [];
        order.forEach((key) => {
          const source = config.LiveConfig?.find((l) => l.key === key);
          if (source) {
            sortedLiveConfig.push(source);
          }
        });

        // 添加未在排序列表中的直播源（保持原有顺序）
        config.LiveConfig.forEach((source) => {
          if (!order.includes(source.key)) {
            sortedLiveConfig.push(source);
          }
        });

        config.LiveConfig = sortedLiveConfig;
        break;

      default:
        return NextResponse.json({ error: '未知操作' }, { status: 400 });
    }

    await persistAdminConfigMutation(config);

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '操作失败' },
      { status: 500 },
    );
  }
}
