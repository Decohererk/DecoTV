/* eslint-disable no-console */
import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import path from 'path';

import { BUILD_TIMESTAMP, CURRENT_VERSION } from '@/lib/version';

export const dynamic = 'force-dynamic';

// 远程版本源配置
const UPDATE_REPO = process.env.NEXT_PUBLIC_UPDATE_REPO || 'Decohererk/DecoTV';
const UPDATE_REF = process.env.NEXT_PUBLIC_UPDATE_REF || 'main';

// 多个镜像源
const REMOTE_VERSION_URLS = [
  `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@${UPDATE_REF}/VERSION.txt`,
  `https://fastly.jsdelivr.net/gh/${UPDATE_REPO}@${UPDATE_REF}/VERSION.txt`,
  `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_REF}/VERSION.txt`,
];

const FETCH_TIMEOUT = 5000;

/**
 * 带超时的 fetch（服务端版本）
 */
async function fetchWithTimeout(
  url: string,
  timeout: number,
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${url}?_t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'DecoTV-VersionCheck/1.0',
      },
    });

    if (!response.ok) return null;
    return (await response.text()).trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 获取本地版本时间戳
 */
async function getLocalTimestamp(): Promise<string> {
  // 方法1: 从文件系统读取
  const possiblePaths = [
    path.join(process.cwd(), 'public', 'VERSION.txt'),
    path.join(process.cwd(), 'VERSION.txt'),
    path.join(process.cwd(), '.next', 'static', 'VERSION.txt'),
  ];

  for (const filePath of possiblePaths) {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const timestamp = content.trim();
      if (/^\d{14}$/.test(timestamp)) {
        return timestamp;
      }
    } catch {
      continue;
    }
  }

  // 方法2: 使用构建时注入的环境变量（如果有）
  if (
    process.env.BUILD_TIMESTAMP &&
    /^\d{14}$/.test(process.env.BUILD_TIMESTAMP)
  ) {
    return process.env.BUILD_TIMESTAMP;
  }

  // 方法3: 使用硬编码的默认值（从 version.ts 导入）
  return BUILD_TIMESTAMP;
}

/**
 * 获取远程版本时间戳
 */
async function getRemoteTimestamp(): Promise<string | null> {
  // 并行请求所有源
  const results = await Promise.allSettled(
    REMOTE_VERSION_URLS.map((url) => fetchWithTimeout(url, FETCH_TIMEOUT)),
  );

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      const timestamp = result.value;
      if (/^\d{14}$/.test(timestamp)) {
        return timestamp;
      }
    }
  }

  return null;
}

/**
 * 版本检查 API
 * GET /api/version/check - 完整的版本检测，包含本地和远程版本比较
 *
 * 此 API 在服务端执行版本检测，解决客户端 CORS 和网络问题
 */
export async function GET() {
  try {
    // 获取本地版本
    const localTimestamp = await getLocalTimestamp();

    // 获取远程版本
    const remoteTimestamp = await getRemoteTimestamp();

    // 比较版本
    let hasUpdate = false;
    if (remoteTimestamp) {
      const localNum = BigInt(localTimestamp);
      const remoteNum = BigInt(remoteTimestamp);
      hasUpdate = remoteNum > localNum;
    }

    return NextResponse.json({
      success: true,
      version: CURRENT_VERSION,
      localTimestamp,
      remoteTimestamp,
      hasUpdate,
      displayVersion: `v${CURRENT_VERSION}`,
      serverTime: Date.now(),
    });
  } catch (error) {
    console.error('版本检查 API 错误:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 500 },
    );
  }
}
