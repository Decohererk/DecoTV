/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import type { AdminConfig, DanmuCustomNode } from '@/lib/admin.types';
import { persistAdminConfigMutation } from '@/lib/admin-config-mutation';
import { verifyApiAuth } from '@/lib/auth';
import { getConfig, getLocalModeConfig } from '@/lib/config';

export const runtime = 'nodejs';

interface DanmuConfigPayload {
  enabled?: boolean;
  serverUrl?: string;
  token?: string;
  platform?: string;
  sourceOrder?: string;
  mergeSourcePairs?: string;
  bilibiliCookie?: string;
  convertTopBottomToScroll?: boolean;
  convertColor?: 'default' | 'white' | 'color';
  danmuLimit?: number;
  blockedWords?: string;
  danmuOutputFormat?: 'json' | 'xml';
  simplifiedTraditional?: 'default' | 'simplified' | 'traditional';
  customNodes?: unknown;
}

const MAX_CUSTOM_NODE_COUNT = 64;

type DanmuConfig = NonNullable<AdminConfig['DanmuConfig']>;

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeNodeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function normalizeDanmuCustomNodes(value: unknown): DanmuCustomNode[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const nodes: DanmuCustomNode[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const raw = item as Partial<DanmuCustomNode>;
    const name = asString(raw.name);
    const url = normalizeNodeUrl(asString(raw.url));
    if (!name || !url) {
      continue;
    }

    nodes.push({
      id: asString(raw.id) || `node_${Date.now()}_${nodes.length}`,
      name,
      url,
      token: asString(raw.token),
      createdAt:
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
          ? raw.createdAt
          : Date.now(),
      updatedAt:
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
          ? raw.updatedAt
          : Date.now(),
    });

    if (nodes.length >= MAX_CUSTOM_NODE_COUNT) {
      break;
    }
  }

  return nodes;
}

function buildDanmuConfig(payload: DanmuConfigPayload): DanmuConfig {
  const danmuLimitRaw = Number(payload.danmuLimit ?? 0);
  const danmuLimit =
    Number.isFinite(danmuLimitRaw) && danmuLimitRaw > 0
      ? Math.floor(danmuLimitRaw)
      : 0;

  const convertColor: DanmuConfig['convertColor'] =
    payload.convertColor === 'white' || payload.convertColor === 'color'
      ? payload.convertColor
      : 'default';

  const danmuOutputFormat: DanmuConfig['danmuOutputFormat'] =
    payload.danmuOutputFormat === 'xml' ? 'xml' : 'json';

  const simplifiedTraditional: DanmuConfig['simplifiedTraditional'] =
    payload.simplifiedTraditional === 'simplified' ||
    payload.simplifiedTraditional === 'traditional'
      ? payload.simplifiedTraditional
      : 'default';

  return {
    enabled: payload.enabled ?? false,
    serverUrl: normalizeNodeUrl(asString(payload.serverUrl)),
    token: asString(payload.token),
    platform: asString(payload.platform),
    sourceOrder: asString(payload.sourceOrder),
    mergeSourcePairs: asString(payload.mergeSourcePairs),
    bilibiliCookie: asString(payload.bilibiliCookie),
    convertTopBottomToScroll: payload.convertTopBottomToScroll ?? false,
    convertColor,
    danmuLimit,
    blockedWords: asString(payload.blockedWords),
    danmuOutputFormat,
    simplifiedTraditional,
    customNodes: normalizeDanmuCustomNodes(payload.customNodes),
  };
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  try {
    const body = (await request.json()) as DanmuConfigPayload;
    const nextDanmuConfig = buildDanmuConfig(body);

    // 本地模式（无数据库）下，写入本地配置对象。
    if (authResult.isLocalMode) {
      const localConfig = getLocalModeConfig();
      localConfig.DanmuConfig = nextDanmuConfig;
      return NextResponse.json({
        message: '弹幕配置更新成功（本地模式）',
        storageMode: 'local',
      });
    }

    if (!authResult.isValid) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const username = authResult.username;
    const adminConfig = await getConfig();

    if (username !== process.env.USERNAME) {
      const user = adminConfig.UserConfig.Users.find(
        (item) => item.username === username,
      );
      if (!user || user.role !== 'admin' || user.banned) {
        return NextResponse.json({ error: '权限不足' }, { status: 401 });
      }
    }

    adminConfig.DanmuConfig = nextDanmuConfig;

    await persistAdminConfigMutation(adminConfig);

    return NextResponse.json(
      { ok: true },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('更新弹幕配置失败:', error);
    return NextResponse.json(
      { error: '更新弹幕配置失败', details: (error as Error).message },
      { status: 500 },
    );
  }
}
