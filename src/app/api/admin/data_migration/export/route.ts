/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gzip } from 'zlib';

import { verifyApiAuth } from '@/lib/auth';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';
import { CURRENT_VERSION } from '@/lib/version';

export const runtime = 'nodejs';

const gzipAsync = promisify(gzip);

interface ExportUserData {
  playRecords: Record<string, unknown>;
  favorites: Record<string, unknown>;
  searchHistory: string[];
  skipConfigs: Record<string, unknown>;
  password: string;
}

async function getUserPassword(username: string): Promise<string | null> {
  try {
    const storage = (db as any).storage;

    if (typeof storage?.client?.get === 'function') {
      const value = await storage.client.get(`u:${username}:pwd`);
      if (typeof value === 'string') return value;
      if (value == null) return null;
      return String(value);
    }

    if (typeof storage?.users?.get === 'function') {
      const value = storage.users.get(username);
      if (typeof value === 'string') return value;
      if (value == null) return null;
      return String(value);
    }

    return null;
  } catch (error) {
    console.error(`获取用户 ${username} 密码失败:`, error);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = verifyApiAuth(req);

    if (authResult.isLocalMode) {
      return NextResponse.json(
        { error: '本地存储模式不支持数据迁移' },
        { status: 400 },
      );
    }

    if (!authResult.isValid) {
      return NextResponse.json({ error: '未登录' }, { status: 401 });
    }

    if (!authResult.isOwner) {
      return NextResponse.json(
        { error: '权限不足，只有站长可以导出数据' },
        { status: 401 },
      );
    }

    const config = await db.getAdminConfig();
    if (!config) {
      return NextResponse.json({ error: '无法获取配置' }, { status: 500 });
    }

    const { password } = (await req.json()) as { password?: unknown };
    if (typeof password !== 'string' || password.length === 0) {
      return NextResponse.json({ error: '请提供加密密码' }, { status: 400 });
    }

    const exportData = {
      timestamp: new Date().toISOString(),
      serverVersion: CURRENT_VERSION,
      data: {
        adminConfig: config,
        userData: {} as Record<string, ExportUserData>,
      },
    };

    let allUsers = await db.getAllUsers();
    const ownerUsername = process.env.USERNAME;
    if (ownerUsername) {
      allUsers.push(ownerUsername);
    }
    allUsers = Array.from(new Set(allUsers));

    for (const username of allUsers) {
      const ownerPassword =
        ownerUsername && username === ownerUsername
          ? process.env.PASSWORD || null
          : null;
      const resolvedPassword =
        ownerPassword || (await getUserPassword(username));

      if (!resolvedPassword) {
        throw new Error(
          `导出失败: 无法读取用户 ${username} 的密码，已阻止生成不完整备份`,
        );
      }

      exportData.data.userData[username] = {
        playRecords: (await db.getAllPlayRecords(username)) as Record<
          string,
          unknown
        >,
        favorites: (await db.getAllFavorites(username)) as Record<
          string,
          unknown
        >,
        searchHistory: await db.getSearchHistory(username),
        skipConfigs: (await db.getAllSkipConfigs(username)) as Record<
          string,
          unknown
        >,
        password: resolvedPassword,
      };
    }

    const jsonData = JSON.stringify(exportData);
    const compressedData = await gzipAsync(jsonData);
    const encryptedData = SimpleCrypto.encrypt(
      compressedData.toString('base64'),
      password,
    );

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
    const filename = `decotv-backup-${timestamp}.dat`;

    return new NextResponse(encryptedData, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': encryptedData.length.toString(),
      },
    });
  } catch (error) {
    console.error('数据导出失败:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导出失败' },
      { status: 500 },
    );
  }
}
