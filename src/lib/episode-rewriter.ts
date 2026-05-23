import { NextRequest } from 'next/server';

import { AdminConfig } from '@/lib/admin.types';
import { getConfig } from '@/lib/config';
import { signM3U8ProxyRequest } from '@/lib/m3u8-proxy';
import { SearchResult } from '@/lib/types';

/**
 * 解析广告过滤是否启用：admin 后台开关 > 环境变量 > 默认开。
 * admin 后台未配置时回落到 ENABLE_AD_FILTER；都没配置时默认 true。
 */
function isAdFilterEnabled(adminConfig: AdminConfig | null): boolean {
  const adminFlag = adminConfig?.AdFilterConfig?.enabled;
  if (typeof adminFlag === 'boolean') return adminFlag;
  const envFlag = process.env.ENABLE_AD_FILTER;
  if (envFlag === undefined) return true;
  return envFlag === 'true' || envFlag === '1';
}

function adFilterDisabledByQuery(request: NextRequest): boolean {
  const v = request.nextUrl.searchParams.get('adfilter');
  return v === 'false' || v === '0';
}

function buildFilterProxyUrl(
  request: NextRequest,
  upstreamUrl: string,
): string {
  const signature = signM3U8ProxyRequest(upstreamUrl);
  if (!signature) return upstreamUrl;

  const host = request.headers.get('host');
  const protocol =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '') ||
    'http';
  return `${protocol}://${host}/api/proxy/m3u8-filter?url=${encodeURIComponent(
    upstreamUrl,
  )}&sig=${encodeURIComponent(signature)}`;
}

function shouldRewriteEpisode(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url)) return false; // 跳过 /api/private-library/stream 这类内部路径
  if (!/\.m3u8(\?|#|$)/i.test(url)) return false; // 只处理 m3u8
  return true;
}

function isSourceDisabled(
  adminConfig: AdminConfig | null,
  sourceKey: string | undefined,
): boolean {
  if (!adminConfig || !sourceKey) return false;
  const entry = adminConfig.SourceConfig?.find((s) => s.key === sourceKey);
  return !!entry?.disable_ad_filter;
}

/**
 * 把 SearchResult 的 episodes 数组里的 m3u8 URL 包成
 * /api/proxy/m3u8-filter?url=... 形式，过滤上游广告。
 *
 * 跳过条件：
 * - admin 后台关掉了广告过滤（或环境变量 ENABLE_AD_FILTER=false）
 * - 客户端请求带 ?adfilter=false 显式禁用
 * - 该源在后台被标记为 disable_ad_filter
 * - source 是 private_library（私人影库已是内部代理 URL）
 * - URL 不是 http/https 或不是 m3u8
 */
export async function rewriteEpisodesForAdFilter<
  T extends SearchResult | null | undefined,
>(result: T, request: NextRequest): Promise<T> {
  if (!result) return result;
  const adminConfig = await safeGetConfig();
  if (!isAdFilterEnabled(adminConfig) || adFilterDisabledByQuery(request))
    return result;
  if (result.source === 'private_library') return result;
  if (isSourceDisabled(adminConfig, result.source)) return result;
  if (!Array.isArray(result.episodes) || result.episodes.length === 0)
    return result;

  const rewritten = result.episodes.map((ep) =>
    shouldRewriteEpisode(ep) ? buildFilterProxyUrl(request, ep) : ep,
  );

  return { ...result, episodes: rewritten };
}

export async function rewriteEpisodesForAdFilterMany(
  results: SearchResult[],
  request: NextRequest,
): Promise<SearchResult[]> {
  const adminConfig = await safeGetConfig();
  if (!isAdFilterEnabled(adminConfig) || adFilterDisabledByQuery(request))
    return results;

  // 对每条结果按"源是否豁免"独立判断
  return results.map((r) => {
    if (isSourceDisabled(adminConfig, r.source)) return r;
    if (r.source === 'private_library') return r;
    if (!Array.isArray(r.episodes) || r.episodes.length === 0) return r;
    const rewritten = r.episodes.map((ep) =>
      shouldRewriteEpisode(ep) ? buildFilterProxyUrl(request, ep) : ep,
    );
    return { ...r, episodes: rewritten };
  });
}

async function safeGetConfig(): Promise<AdminConfig | null> {
  try {
    return await getConfig();
  } catch {
    return null;
  }
}
