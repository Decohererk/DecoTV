/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  buildPanSouAuthorizationHeader,
  getDefaultPanSouConfig,
  normalizePanSouConfig,
  normalizePanSouPassword,
  normalizePanSouServerUrl,
  normalizePanSouToken,
  normalizePanSouUsername,
  resolveActivePanSouNode,
  resolvePanSouSearchUrl,
} from '@/lib/pansou';

export const runtime = 'nodejs';

interface PanSouNodePayload {
  id?: string;
  name?: string;
  serverUrl?: string;
  token?: string;
  username?: string;
  password?: string;
}

interface PanSouTestPayload {
  activeNodeId?: string;
  nodes?: PanSouNodePayload[];
  node?: PanSouNodePayload;
  keyword?: string;
  serverUrl?: string;
  token?: string;
  username?: string;
  password?: string;
}

function estimateSearchCount(data: unknown): number {
  if (!data || typeof data !== 'object') {
    return 0;
  }

  const payload = data as {
    total?: number;
    data?: {
      total?: number;
      merged_by_type?: Record<string, Array<unknown>>;
    };
    merged_by_type?: Record<string, Array<unknown>>;
  };

  if (typeof payload.data?.total === 'number') {
    return payload.data.total;
  }
  if (typeof payload.total === 'number') {
    return payload.total;
  }

  const merged = payload.data?.merged_by_type || payload.merged_by_type;
  if (!merged || typeof merged !== 'object') {
    return 0;
  }

  return Object.values(merged).reduce((sum, list) => {
    return sum + (Array.isArray(list) ? list.length : 0);
  }, 0);
}

function parseJsonSafely(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveTestNode(
  payload: PanSouTestPayload,
  storedConfig: ReturnType<typeof getDefaultPanSouConfig>,
) {
  const storedNode = resolveActivePanSouNode(storedConfig);

  if (payload.node && typeof payload.node === 'object') {
    const mergedConfig = normalizePanSouConfig({
      activeNodeId:
        typeof payload.node.id === 'string' && payload.node.id.trim()
          ? payload.node.id.trim()
          : storedNode.id,
      nodes: [{ ...storedNode, ...payload.node }],
    });
    return resolveActivePanSouNode(mergedConfig);
  }

  if (
    Array.isArray(payload.nodes) ||
    typeof payload.activeNodeId === 'string'
  ) {
    const mergedConfig = normalizePanSouConfig({
      activeNodeId:
        typeof payload.activeNodeId === 'string'
          ? payload.activeNodeId
          : storedConfig.activeNodeId,
      nodes: Array.isArray(payload.nodes) ? payload.nodes : storedConfig.nodes,
    });
    return resolveActivePanSouNode(mergedConfig);
  }

  const hasLegacyOverride =
    typeof payload.serverUrl === 'string' ||
    typeof payload.token === 'string' ||
    typeof payload.username === 'string' ||
    typeof payload.password === 'string';

  if (hasLegacyOverride) {
    return {
      ...storedNode,
      serverUrl:
        typeof payload.serverUrl === 'string'
          ? normalizePanSouServerUrl(payload.serverUrl) || storedNode.serverUrl
          : storedNode.serverUrl,
      token:
        typeof payload.token === 'string'
          ? normalizePanSouToken(payload.token)
          : storedNode.token,
      username:
        typeof payload.username === 'string'
          ? normalizePanSouUsername(payload.username)
          : storedNode.username,
      password:
        typeof payload.password === 'string'
          ? normalizePanSouPassword(payload.password)
          : storedNode.password,
      updatedAt: Date.now(),
    };
  }

  return storedNode;
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);

  if (!authResult.isLocalMode && !authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as PanSouTestPayload;
    const config = await getConfig();
    const defaults = getDefaultPanSouConfig();
    const normalizedStoredConfig = normalizePanSouConfig(
      config.PanSouConfig || defaults,
    );

    const node = resolveTestNode(body, normalizedStoredConfig);
    const serverUrl = normalizePanSouServerUrl(node.serverUrl);
    const keyword =
      typeof body.keyword === 'string' && body.keyword.trim()
        ? body.keyword.trim()
        : 'test';

    if (!serverUrl) {
      return NextResponse.json(
        { success: false, error: '请先填写 PanSou 服务地址' },
        { status: 400 },
      );
    }

    const searchUrl = new URL(resolvePanSouSearchUrl(serverUrl));
    searchUrl.searchParams.set('kw', keyword);
    searchUrl.searchParams.set('res', 'merge');
    searchUrl.searchParams.set('conc', '1');

    const authorization = buildPanSouAuthorizationHeader({
      username: node.username,
      password: node.password,
      token: node.token,
      fallbackAuthorization: request.headers.get('authorization'),
    });

    const headers = new Headers({
      Accept: 'application/json',
    });

    if (authorization) {
      headers.set('Authorization', authorization);
    }

    const startedAt = Date.now();
    const response = await fetch(searchUrl.toString(), {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(12000),
    });

    const rawBody = await response.text();
    const jsonPayload = parseJsonSafely(rawBody);

    if (!response.ok) {
      const fallbackError = `搜索请求失败 (${response.status})`;
      const errorMessage =
        jsonPayload &&
        typeof jsonPayload === 'object' &&
        typeof (jsonPayload as { error?: unknown }).error === 'string'
          ? (jsonPayload as { error: string }).error || fallbackError
          : fallbackError;

      return NextResponse.json({
        success: false,
        latency: Date.now() - startedAt,
        status: response.status,
        searchStatus: response.status,
        error: errorMessage,
      });
    }

    if (!jsonPayload || typeof jsonPayload !== 'object') {
      return NextResponse.json({
        success: false,
        latency: Date.now() - startedAt,
        status: response.status,
        searchStatus: response.status,
        error: '节点返回了非 JSON 数据',
      });
    }

    return NextResponse.json({
      success: true,
      latency: Date.now() - startedAt,
      status: response.status,
      healthStatus: response.status,
      searchStatus: response.status,
      searchResultCount: estimateSearchCount(jsonPayload),
      nodeId: node.id,
      nodeName: node.name,
    });
  } catch (error) {
    console.error('PanSou 连通性测试失败:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : '网络请求失败',
    });
  }
}
