/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig, refineConfig } from '@/lib/config';

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
    console.log('[admin/config_file] 认证失败:', {
      hasAuth: !!request.cookies.get('auth'),
      isLocalMode: authResult.isLocalMode,
    });
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 检查用户权限
    let adminConfig = await getConfig();

    // 仅站长可以修改配置文件
    if (!authResult.isOwner) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以修改配置文件' },
        { status: 401 },
      );
    }

    // 获取请求体
    const body = await request.json();
    const { configFile, subscriptionUrl, autoUpdate, lastCheckTime } = body;

    // 允许空内容，表示清空配置
    if (configFile !== undefined && typeof configFile !== 'string') {
      return NextResponse.json(
        { error: '配置文件内容格式错误' },
        { status: 400 },
      );
    }

    // 如果不为空，验证 JSON 格式
    if (configFile && configFile.trim()) {
      try {
        JSON.parse(configFile);
      } catch {
        return NextResponse.json(
          { error: '配置文件格式错误，请检查 JSON 语法' },
          { status: 400 },
        );
      }
    }

    // 如果配置文件被清空，删除所有 from='config' 的视频源（保留 from='custom'）
    if (!configFile || !configFile.trim()) {
      adminConfig.SourceConfig = adminConfig.SourceConfig.filter(
        (source) => source.from === 'custom',
      );
      console.log('配置文件已清空，已删除所有系统预设视频源，保留自定义源');
    }

    adminConfig.ConfigFile = configFile || '';
    if (!adminConfig.ConfigSubscribtion) {
      adminConfig.ConfigSubscribtion = {
        URL: '',
        AutoUpdate: false,
        LastCheck: '',
      };
    }

    // 更新订阅配置
    if (subscriptionUrl !== undefined) {
      adminConfig.ConfigSubscribtion.URL = subscriptionUrl;
    }
    if (autoUpdate !== undefined) {
      adminConfig.ConfigSubscribtion.AutoUpdate = autoUpdate;
    }
    adminConfig.ConfigSubscribtion.LastCheck = lastCheckTime || '';

    adminConfig = refineConfig(adminConfig);
    await persistAdminConfigMutation(adminConfig);
    return NextResponse.json({
      success: true,
      message: '配置文件更新成功',
    });
  } catch (error) {
    console.error('更新配置文件失败:', error);
    return NextResponse.json(
      {
        error: '更新配置文件失败',
        details: (error as Error).message,
      },
      { status: 500 },
    );
  }
}
