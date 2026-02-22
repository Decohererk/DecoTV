/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import {
  buildPanSouAuthorizationHeader,
  getDefaultPanSouConfig,
  isPluginSource,
  normalizePanSouConfig,
  normalizePluginSources,
  type PanSouRuntimeConfig,
  parsePluginNames,
  resolveActivePanSouNode,
  resolvePanSouSearchUrl,
} from '@/lib/pansou';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

const DEFAULT_TIMEOUT_MS = 15000;

function withCorsHeaders(headers?: Record<string, string>): Headers {
  const result = new Headers();
  if (headers) {
    Object.entries(headers).forEach(([key, value]) => {
      result.set(key, value);
    });
  }
  result.set('Access-Control-Allow-Origin', '*');
  result.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  result.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return result;
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseSource(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().toLowerCase();
}

function resolveSourceAndPlugins(args: {
  sourceRaw: string;
  pluginCandidates: string[];
}): {
  source: 'all' | 'tg' | 'plugin';
  plugins: string[];
} {
  const pluginCandidates = normalizePluginSources(args.pluginCandidates);
  const sourceRaw = parseSource(args.sourceRaw);

  let source: 'all' | 'tg' | 'plugin' = 'all';
  const plugins = [...pluginCandidates];

  if (sourceRaw === 'all' || sourceRaw === 'tg' || sourceRaw === 'plugin') {
    source = sourceRaw;
  } else if (isPluginSource(sourceRaw)) {
    source = 'plugin';
    plugins.push(sourceRaw);
  } else if (pluginCandidates.length > 0) {
    source = 'plugin';
  }

  return {
    source,
    plugins: normalizePluginSources(plugins),
  };
}

function normalizeSearchParams(input: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(input);
  const kw =
    params.get('kw')?.trim() ||
    params.get('keyword')?.trim() ||
    params.get('q')?.trim();

  if (kw) {
    params.set('kw', kw);
  }
  params.delete('keyword');
  params.delete('q');

  if (!params.get('res')) {
    params.set('res', 'merge');
  }

  const sourceRaw =
    params.get('src') || params.get('type') || params.get('source') || '';
  const pluginCandidates = [
    ...parsePluginNames(params.get('plugins')),
    ...parsePluginNames(params.get('plugin')),
    ...parsePluginNames(params.get('plugin_source')),
  ];
  const { source, plugins } = resolveSourceAndPlugins({
    sourceRaw,
    pluginCandidates,
  });

  params.set('src', source);
  if (source === 'tg') {
    params.delete('plugins');
  } else if (plugins.length > 0) {
    params.set('plugins', plugins.join(','));
  } else {
    params.delete('plugins');
  }

  params.delete('type');
  params.delete('source');
  params.delete('plugin');
  params.delete('plugin_source');

  return params;
}

function normalizeSearchBody(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...body };
  const kwCandidate = [normalized.kw, normalized.keyword, normalized.q].find(
    (value) => typeof value === 'string' && value.trim(),
  ) as string | undefined;

  if (kwCandidate) {
    normalized.kw = kwCandidate.trim();
  }
  delete normalized.keyword;
  delete normalized.q;

  if (!Object.prototype.hasOwnProperty.call(normalized, 'res')) {
    normalized.res = 'merge';
  }

  const sourceRaw = parseSource(
    normalized.src || normalized.type || normalized.source,
  );
  const pluginCandidates = [
    ...parsePluginNames(normalized.plugins),
    ...parsePluginNames(normalized.plugin),
    ...parsePluginNames(normalized.plugin_source),
  ];
  const { source, plugins } = resolveSourceAndPlugins({
    sourceRaw,
    pluginCandidates,
  });

  normalized.src = source;
  if (source === 'tg') {
    delete normalized.plugins;
  } else if (plugins.length > 0) {
    normalized.plugins = plugins;
  } else {
    delete normalized.plugins;
  }

  delete normalized.type;
  delete normalized.source;
  delete normalized.plugin;
  delete normalized.plugin_source;

  return normalized;
}

async function getPanSouRuntimeConfig(): Promise<PanSouRuntimeConfig> {
  const defaults = getDefaultPanSouConfig();
  try {
    const config = await getConfig();
    const normalizedConfig = normalizePanSouConfig(
      config.PanSouConfig || defaults,
    );
    const node = resolveActivePanSouNode(normalizedConfig);
    return {
      nodeId: node.id,
      nodeName: node.name,
      serverUrl: node.serverUrl,
      token: node.token,
      username: node.username,
      password: node.password,
    };
  } catch (error) {
    const fallbackNode = resolveActivePanSouNode(defaults);
    console.warn(
      '[PanSou Proxy] 使用默认配置，读取后台配置失败:',
      error instanceof Error ? error.message : String(error),
    );
    return {
      nodeId: fallbackNode.id,
      nodeName: fallbackNode.name,
      serverUrl: fallbackNode.serverUrl,
      token: fallbackNode.token,
      username: fallbackNode.username,
      password: fallbackNode.password,
    };
  }
}

async function forwardToPanSou(args: {
  request: NextRequest;
  upstreamUrl: string;
  method: 'GET' | 'POST';
  runtimeConfig: PanSouRuntimeConfig;
  body?: string;
}) {
  const timeoutMsRaw = Number.parseInt(
    process.env.PANSOU_PROXY_TIMEOUT_MS || '',
    10,
  );
  const timeoutMs =
    Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? timeoutMsRaw
      : DEFAULT_TIMEOUT_MS;

  const headers = new Headers({
    Accept: 'application/json',
  });

  if (args.method === 'POST') {
    headers.set('Content-Type', 'application/json');
  }

  const authorization = buildPanSouAuthorizationHeader({
    username: args.runtimeConfig.username,
    password: args.runtimeConfig.password,
    token: args.runtimeConfig.token,
    fallbackAuthorization: args.request.headers.get('authorization'),
  });
  if (authorization) {
    headers.set('Authorization', authorization);
  }

  const userAgent = args.request.headers.get('user-agent');
  if (userAgent) {
    headers.set('User-Agent', userAgent);
  }

  const requestId = args.request.headers.get('x-request-id');
  if (requestId) {
    headers.set('x-request-id', requestId);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(args.upstreamUrl, {
      method: args.method,
      headers,
      body: args.body,
      cache: 'no-store',
      signal: controller.signal,
    });

    const rawBody = await response.text();
    const contentType =
      response.headers.get('content-type') || 'application/json; charset=utf-8';

    return new NextResponse(rawBody, {
      status: response.status,
      headers: withCorsHeaders({
        'Content-Type': contentType,
        'Cache-Control': 'no-store',
      }),
    });
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('aborted'));
    return NextResponse.json(
      {
        error: isTimeout ? 'PanSou 上游请求超时' : 'PanSou 上游请求失败',
        details: error instanceof Error ? error.message : String(error),
      },
      {
        status: 502,
        headers: withCorsHeaders({ 'Cache-Control': 'no-store' }),
      },
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: withCorsHeaders(),
  });
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: withCorsHeaders() },
    );
  }

  const params = normalizeSearchParams(request.nextUrl.searchParams);
  const keyword = params.get('kw')?.trim() || '';
  if (!keyword) {
    return NextResponse.json(
      { error: 'Missing kw parameter' },
      { status: 400, headers: withCorsHeaders() },
    );
  }

  const runtimeConfig = await getPanSouRuntimeConfig();
  const upstreamSearchUrl = resolvePanSouSearchUrl(runtimeConfig.serverUrl);

  if (!isHttpUrl(upstreamSearchUrl)) {
    return NextResponse.json(
      { error: 'PanSou 服务地址无效，请前往后台重新配置' },
      { status: 500, headers: withCorsHeaders() },
    );
  }

  const upstreamUrl = new URL(upstreamSearchUrl);
  params.forEach((value, key) => {
    upstreamUrl.searchParams.set(key, value);
  });

  return forwardToPanSou({
    request,
    upstreamUrl: upstreamUrl.toString(),
    method: 'GET',
    runtimeConfig,
  });
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json(
      { error: 'Unauthorized' },
      { status: 401, headers: withCorsHeaders() },
    );
  }

  const requestBody = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!requestBody || typeof requestBody !== 'object') {
    return NextResponse.json(
      { error: 'Invalid JSON body' },
      { status: 400, headers: withCorsHeaders() },
    );
  }

  const normalizedBody = normalizeSearchBody(requestBody);
  const kw = normalizedBody.kw;
  if (typeof kw !== 'string' || !kw.trim()) {
    return NextResponse.json(
      { error: 'Missing kw parameter' },
      { status: 400, headers: withCorsHeaders() },
    );
  }

  const runtimeConfig = await getPanSouRuntimeConfig();
  const upstreamSearchUrl = resolvePanSouSearchUrl(runtimeConfig.serverUrl);
  if (!isHttpUrl(upstreamSearchUrl)) {
    return NextResponse.json(
      { error: 'PanSou 服务地址无效，请前往后台重新配置' },
      { status: 500, headers: withCorsHeaders() },
    );
  }

  return forwardToPanSou({
    request,
    upstreamUrl: upstreamSearchUrl,
    method: 'POST',
    runtimeConfig,
    body: JSON.stringify(normalizedBody),
  });
}
