/* eslint-disable @typescript-eslint/no-explicit-any,no-console */

import { NextRequest, NextResponse } from 'next/server';
import { promisify } from 'util';
import { gunzip } from 'zlib';

import {
  persistAdminConfigMutation,
  revalidateAdminConfigViews,
} from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { configSelfCheck } from '@/lib/config';
import { SimpleCrypto } from '@/lib/crypto';
import { db } from '@/lib/db';

export const runtime = 'nodejs';

const gunzipAsync = promisify(gunzip);

interface ImportedUserData {
  username: string;
  password: string;
  playRecords: Record<string, unknown>;
  favorites: Record<string, unknown>;
  searchHistory: string[];
  skipConfigs: Record<string, unknown>;
}

interface NormalizedImportPayload {
  adminConfig: Record<string, unknown>;
  users: ImportedUserData[];
  timestamp: string | null;
  serverVersion: string | null;
}

interface DataSnapshot {
  adminConfig: Record<string, unknown> | null;
  users: ImportedUserData[];
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function ensureObjectRecord(
  value: unknown,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> {
  const record = asRecord(value);
  return record || fallback;
}

function ensureStringArray(value: unknown, fieldName: string): string[] {
  if (value == null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new HttpError(400, `备份文件格式无效: ${fieldName} 不是数组`);
  }

  for (const item of value) {
    if (typeof item !== 'string') {
      throw new HttpError(
        400,
        `备份文件格式无效: ${fieldName} 包含非字符串元素`,
      );
    }
  }

  return value;
}

function normalizeUserEntry(
  usernameRaw: unknown,
  payloadRaw: unknown,
): ImportedUserData {
  const username =
    typeof usernameRaw === 'string' ? usernameRaw.trim() : String(usernameRaw);

  if (!username) {
    throw new HttpError(400, '备份文件格式无效: 存在空用户名');
  }

  const payload = asRecord(payloadRaw);
  if (!payload) {
    throw new HttpError(400, `备份文件格式无效: 用户 ${username} 数据不是对象`);
  }

  if (typeof payload.password !== 'string' || payload.password.length === 0) {
    throw new HttpError(400, `备份文件格式无效: 用户 ${username} 缺少有效密码`);
  }

  return {
    username,
    password: payload.password,
    playRecords: ensureObjectRecord(payload.playRecords),
    favorites: ensureObjectRecord(payload.favorites),
    searchHistory: ensureStringArray(
      payload.searchHistory,
      `${username}.searchHistory`,
    ),
    skipConfigs: ensureObjectRecord(payload.skipConfigs),
  };
}

function normalizeUsers(raw: unknown): ImportedUserData[] {
  const parsedUsers: ImportedUserData[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      const record = asRecord(item);
      if (!record) {
        throw new HttpError(400, '备份文件格式无效: userData 数组元素不是对象');
      }
      parsedUsers.push(normalizeUserEntry(record.username, record));
    }
  } else {
    const record = asRecord(raw);
    if (!record) {
      throw new HttpError(400, '备份文件格式无效: userData 不是对象');
    }

    const nestedUsers = record.users;
    if (Array.isArray(nestedUsers)) {
      return normalizeUsers(nestedUsers);
    }

    for (const [username, payload] of Object.entries(record)) {
      parsedUsers.push(normalizeUserEntry(username, payload));
    }
  }

  if (parsedUsers.length === 0) {
    throw new HttpError(400, '备份文件格式无效: userData 为空');
  }

  const dedup = new Set<string>();
  for (const user of parsedUsers) {
    if (dedup.has(user.username)) {
      throw new HttpError(
        400,
        `备份文件格式无效: 用户 ${user.username} 重复出现`,
      );
    }
    dedup.add(user.username);
  }

  return parsedUsers;
}

function normalizeImportPayload(raw: unknown): NormalizedImportPayload {
  const topLevel = asRecord(raw);
  if (!topLevel) {
    throw new HttpError(400, '备份文件格式无效: 顶层结构错误');
  }

  const data = asRecord(topLevel.data);
  if (!data) {
    throw new HttpError(400, '备份文件格式无效: 缺少 data');
  }

  const adminConfig = asRecord(data.adminConfig);
  if (!adminConfig) {
    throw new HttpError(400, '备份文件格式无效: 缺少 adminConfig');
  }

  const userData = data.userData ?? data.users;
  const users = normalizeUsers(userData);

  return {
    adminConfig,
    users,
    timestamp:
      typeof topLevel.timestamp === 'string' ? topLevel.timestamp : null,
    serverVersion:
      typeof topLevel.serverVersion === 'string'
        ? topLevel.serverVersion
        : null,
  };
}

function getInternalStorage(): any {
  const storage = (db as any).storage;
  if (!storage) {
    throw new Error('内部存储实例不可用');
  }
  return storage;
}

async function readStoredPassword(username: string): Promise<string | null> {
  const storage = getInternalStorage();

  if (typeof storage.client?.get === 'function') {
    const value = await storage.client.get(`u:${username}:pwd`);
    if (typeof value === 'string') return value;
    if (value == null) return null;
    return String(value);
  }

  if (typeof storage.users?.get === 'function') {
    const value = storage.users.get(username);
    if (typeof value === 'string') return value;
    if (value == null) return null;
    return String(value);
  }

  return null;
}

async function captureCurrentSnapshot(): Promise<DataSnapshot> {
  const adminConfig = (await db.getAdminConfig()) as Record<
    string,
    unknown
  > | null;
  const usernames = Array.from(new Set(await db.getAllUsers()));
  const users: ImportedUserData[] = [];

  for (const username of usernames) {
    const password = await readStoredPassword(username);
    if (!password) {
      throw new Error(
        `无法读取现有用户 ${username} 的密码，已阻止导入以避免不可回滚`,
      );
    }

    users.push({
      username,
      password,
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
    });
  }

  return { adminConfig, users };
}

async function importUserData(users: ImportedUserData[]): Promise<void> {
  const storage = getInternalStorage();
  if (
    typeof storage.setPlayRecord !== 'function' ||
    typeof storage.setFavorite !== 'function'
  ) {
    throw new Error('内部存储实例缺少导入所需方法');
  }

  for (const user of users) {
    await db.registerUser(user.username, user.password);

    const authOk = await db.verifyUser(user.username, user.password);
    if (!authOk) {
      throw new Error(`用户 ${user.username} 密码写入后校验失败`);
    }

    for (const [key, record] of Object.entries(user.playRecords)) {
      await storage.setPlayRecord(user.username, key, record);
    }

    for (const [key, favorite] of Object.entries(user.favorites)) {
      await storage.setFavorite(user.username, key, favorite);
    }

    for (const keyword of [...user.searchHistory].reverse()) {
      await db.addSearchHistory(user.username, keyword);
    }

    for (const [key, skipConfig] of Object.entries(user.skipConfigs)) {
      const [source, id] = key.split('+');
      if (source && id) {
        await db.setSkipConfig(user.username, source, id, skipConfig as any);
      }
    }
  }
}

async function verifyImportedAuthData(
  users: ImportedUserData[],
): Promise<void> {
  const failures: string[] = [];

  for (const user of users) {
    const exists = await db.checkUserExist(user.username);
    if (!exists) {
      failures.push(`${user.username}: 不存在`);
      continue;
    }

    const passwordValid = await db.verifyUser(user.username, user.password);
    if (!passwordValid) {
      failures.push(`${user.username}: 密码校验失败`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`导入后鉴权数据校验失败: ${failures.join('; ')}`);
  }
}

async function applyImportPayload(
  payload: NormalizedImportPayload,
): Promise<void> {
  await db.clearAllData();

  const checkedConfig = configSelfCheck(payload.adminConfig as any);
  await persistAdminConfigMutation(checkedConfig, { revalidate: false });

  await importUserData(payload.users);
  await verifyImportedAuthData(payload.users);
}

async function restoreSnapshot(snapshot: DataSnapshot): Promise<void> {
  await db.clearAllData();

  if (snapshot.adminConfig) {
    const checkedConfig = configSelfCheck(snapshot.adminConfig as any);
    await persistAdminConfigMutation(checkedConfig, { revalidate: false });
  }

  if (snapshot.users.length > 0) {
    await importUserData(snapshot.users);
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
        { error: '权限不足，只有站长可以导入数据' },
        { status: 401 },
      );
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const password = formData.get('password') as string;

    if (!file) {
      throw new HttpError(400, '请选择备份文件');
    }
    if (!password) {
      throw new HttpError(400, '请提供解密密码');
    }

    const encryptedData = await file.text();
    let decryptedData = '';
    try {
      decryptedData = SimpleCrypto.decrypt(encryptedData, password);
    } catch {
      throw new HttpError(400, '解密失败，请检查密码是否正确');
    }

    const compressedBuffer = Buffer.from(decryptedData, 'base64');
    const decompressedBuffer = await gunzipAsync(compressedBuffer);
    const decompressedData = decompressedBuffer.toString();

    let parsedData: unknown;
    try {
      parsedData = JSON.parse(decompressedData);
    } catch {
      throw new HttpError(400, '备份文件格式错误');
    }

    const payload = normalizeImportPayload(parsedData);
    const snapshot = await captureCurrentSnapshot();

    try {
      await applyImportPayload(payload);
    } catch (importError) {
      console.error('数据导入失败，开始回滚原数据:', importError);
      try {
        await restoreSnapshot(snapshot);
        revalidateAdminConfigViews();
      } catch (rollbackError) {
        console.error('数据回滚失败:', rollbackError);
        throw new Error(
          `导入失败且回滚失败: ${importError instanceof Error ? importError.message : String(importError)} | 回滚错误: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
        );
      }

      throw importError;
    }

    revalidateAdminConfigViews();

    return NextResponse.json({
      message: '数据导入成功',
      importedUsers: payload.users.length,
      timestamp: payload.timestamp,
      serverVersion: payload.serverVersion || '未知版本',
    });
  } catch (error) {
    console.error('数据导入失败:', error);

    if (error instanceof HttpError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : '导入失败' },
      { status: 500 },
    );
  }
}
