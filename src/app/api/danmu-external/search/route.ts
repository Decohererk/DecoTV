/* eslint-disable no-console */
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';

export const runtime = 'nodejs';

const DANDANPLAY_API_BASE = 'https://api.dandanplay.net';
const SEARCH_TIMEOUT_MS = 20_000;
const CUSTOM_SEARCH_ANIME_LIMIT = 10;

interface SearchEpisodeItem {
  episodeId: number;
  episodeTitle: string;
}

interface SearchAnimeItem {
  animeId: number;
  animeTitle: string;
  type: string;
  typeDescription?: string;
  imageUrl?: string;
  episodes: SearchEpisodeItem[];
}

interface SearchAnimeBase {
  animeId: number;
  animeTitle: string;
  type: string;
  typeDescription?: string;
  imageUrl?: string;
}

function getDandanplayCredentials() {
  return {
    appId: process.env.DANDANPLAY_APP_ID || '',
    appSecret: process.env.DANDANPLAY_APP_SECRET || '',
  };
}

function generateDandanplaySignature(
  appId: string,
  appSecret: string,
  path: string,
  timestamp: number,
): string {
  const data = appId + timestamp + path + appSecret;
  return createHash('sha256').update(data).digest('base64');
}

function buildDandanplayHeaders(
  appId: string,
  appSecret: string,
  path: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'DecoTV/1.0',
  };

  if (appId && appSecret) {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = generateDandanplaySignature(
      appId,
      appSecret,
      path,
      timestamp,
    );
    headers['X-AppId'] = appId;
    headers['X-Timestamp'] = String(timestamp);
    headers['X-Signature'] = signature;
  }

  return headers;
}

function parsePositiveInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function readString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function formatSearchErrorMessage(prefix: string, err: unknown): string {
  if (err instanceof Error) {
    const lowerMsg = err.message.toLowerCase();
    if (
      err.name === 'TimeoutError' ||
      lowerMsg.includes('aborted due to timeout')
    ) {
      return `${prefix}: 请求超时（${Math.round(SEARCH_TIMEOUT_MS / 1000)}秒）`;
    }
    return `${prefix}: ${err.message}`;
  }
  return `${prefix}: ${String(err)}`;
}

function normalizeEpisodes(value: unknown): SearchEpisodeItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = readRecord(item);
      if (!row) return null;

      const episodeId = parsePositiveInt(row.episodeId);
      if (!episodeId) return null;

      return {
        episodeId,
        episodeTitle:
          readString(row.episodeTitle) ||
          readString(row.title) ||
          readString(row.name) ||
          readString(row.ep_name) ||
          `episodeId:${episodeId}`,
      };
    })
    .filter((item): item is SearchEpisodeItem => item !== null);
}

function readImageUrl(row: Record<string, unknown>): string | undefined {
  return (
    readString(row.imageUrl) ||
    readString(row.animeImageUrl) ||
    readString(row.cover) ||
    readString(row.poster)
  );
}

function normalizeAnimeBaseList(value: unknown): SearchAnimeBase[] {
  if (!Array.isArray(value)) return [];
  const normalized: SearchAnimeBase[] = [];

  for (const item of value) {
    const row = readRecord(item);
    if (!row) continue;

    const animeId = parsePositiveInt(row.animeId) || parsePositiveInt(row.id);
    if (!animeId) continue;

    const anime: SearchAnimeBase = {
      animeId,
      animeTitle:
        readString(row.animeTitle) ||
        readString(row.title) ||
        readString(row.name) ||
        `animeId:${animeId}`,
      type: readString(row.type) || readString(row.category) || 'unknown',
    };

    const typeDescription =
      readString(row.typeDescription) || readString(row.desc);
    if (typeDescription) {
      anime.typeDescription = typeDescription;
    }

    const imageUrl = readImageUrl(row);
    if (imageUrl) {
      anime.imageUrl = imageUrl;
    }

    normalized.push(anime);
  }

  return normalized;
}

function normalizeAnimes(value: unknown): SearchAnimeItem[] {
  if (!Array.isArray(value)) return [];

  const normalized: SearchAnimeItem[] = [];
  for (const anime of normalizeAnimeBaseList(value)) {
    const row = value.find((raw) => {
      const record = readRecord(raw);
      if (!record) return false;
      const rowAnimeId =
        parsePositiveInt(record.animeId) || parsePositiveInt(record.id);
      return rowAnimeId === anime.animeId;
    });
    const rowRecord = readRecord(row);
    const episodes = normalizeEpisodes(rowRecord?.episodes);
    if (episodes.length === 0) continue;
    normalized.push({ ...anime, episodes });
  }

  return normalized;
}

function normalizeBangumiEpisodes(value: unknown): SearchEpisodeItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const row = readRecord(item);
      if (!row) return null;
      const episodeId =
        parsePositiveInt(row.episodeId) ||
        parsePositiveInt(row.id) ||
        parsePositiveInt(row.commentId);
      if (!episodeId) return null;
      return {
        episodeId,
        episodeTitle:
          readString(row.episodeTitle) ||
          readString(row.title) ||
          readString(row.name) ||
          readString(row.ep_name) ||
          `episodeId:${episodeId}`,
      };
    })
    .filter((item): item is SearchEpisodeItem => item !== null);
}

async function searchFromDandanplay(keyword: string) {
  const { appId, appSecret } = getDandanplayCredentials();
  if (!appId || !appSecret) {
    return {
      ok: false,
      status: 503,
      message:
        '弹弹Play API 凭证未配置（缺少 DANDANPLAY_APP_ID / DANDANPLAY_APP_SECRET）',
      animes: [] as SearchAnimeItem[],
    };
  }

  const path = '/api/v2/search/episodes';
  const url = `${DANDANPLAY_API_BASE}${path}?anime=${encodeURIComponent(keyword)}&episode=`;
  const headers = buildDandanplayHeaders(appId, appSecret, path);

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 502,
        message: `弹弹Play 搜索失败: HTTP ${response.status}`,
        animes: [] as SearchAnimeItem[],
      };
    }

    const data = await response.json();
    if (data?.success === false) {
      return {
        ok: false,
        status: 502,
        message: `弹弹Play 搜索返回错误: ${data?.errorMessage || 'unknown'}`,
        animes: [] as SearchAnimeItem[],
      };
    }

    return {
      ok: true,
      status: 200,
      message: '获取成功',
      animes: normalizeAnimes(data?.animes),
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message: formatSearchErrorMessage('弹弹Play 搜索异常', err),
      animes: [] as SearchAnimeItem[],
    };
  }
}

async function searchFromCustomServer(
  keyword: string,
  dc: NonNullable<Awaited<ReturnType<typeof getConfig>>['DanmuConfig']>,
) {
  const baseUrl = dc.serverUrl.replace(/\/+$/, '');
  const tokenSegment = dc.token ? `/${dc.token}` : '';
  const serverBase = `${baseUrl}${tokenSegment}`;
  const headers = { Accept: 'application/json' };
  const episodeSearchPaths = [
    `/api/v2/search/episodes?anime=${encodeURIComponent(keyword)}&episode=`,
    `/api/v2/search/episodes?anime=${encodeURIComponent(keyword)}`,
    // 兼容少数非标准实现（官方 danmu_api 仍然使用 anime 参数）
    `/api/v2/search/episodes?keyword=${encodeURIComponent(keyword)}`,
  ];

  let lastErrorMessage: string | null = null;

  for (const path of episodeSearchPaths) {
    try {
      const response = await fetch(`${serverBase}${path}`, {
        headers,
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        lastErrorMessage = `自定义弹幕搜索失败: HTTP ${response.status}`;
        continue;
      }

      const data = await response.json();
      const animes = normalizeAnimes(data?.animes || data?.bangumiList || []);
      if (animes.length > 0) {
        return {
          ok: true,
          status: 200,
          message: '获取成功',
          animes,
        };
      }
    } catch (err) {
      lastErrorMessage = formatSearchErrorMessage('自定义弹幕搜索异常', err);
    }
  }

  // fallback: 某些部署仅暴露 /search/anime，再按 animeId 拉 bangumi 详情拿集数
  try {
    const animeResp = await fetch(
      `${serverBase}/api/v2/search/anime?keyword=${encodeURIComponent(keyword)}`,
      {
        headers,
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      },
    );

    if (!animeResp.ok) {
      return {
        ok: false,
        status: 502,
        message:
          lastErrorMessage || `自定义弹幕搜索失败: HTTP ${animeResp.status}`,
        animes: [] as SearchAnimeItem[],
      };
    }

    const animeData = await animeResp.json();
    const animeBases = normalizeAnimeBaseList(
      animeData?.animes || animeData?.bangumiList || [],
    ).slice(0, CUSTOM_SEARCH_ANIME_LIMIT);

    if (animeBases.length === 0) {
      return {
        ok: true,
        status: 200,
        message: '获取成功',
        animes: [] as SearchAnimeItem[],
      };
    }

    const enriched = await Promise.all(
      animeBases.map(async (anime): Promise<SearchAnimeItem | null> => {
        try {
          const bangumiResp = await fetch(
            `${serverBase}/api/v2/bangumi/${anime.animeId}`,
            {
              headers,
              signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
            },
          );
          if (!bangumiResp.ok) return null;
          const bangumiData = await bangumiResp.json();
          const episodes = normalizeBangumiEpisodes(
            bangumiData?.bangumi?.episodes || bangumiData?.episodes,
          );
          if (episodes.length === 0) return null;
          return { ...anime, episodes };
        } catch {
          return null;
        }
      }),
    );

    const animes = enriched.filter(
      (item): item is SearchAnimeItem => item !== null,
    );

    return {
      ok: true,
      status: 200,
      message: '获取成功',
      animes,
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      message:
        lastErrorMessage || formatSearchErrorMessage('自定义弹幕搜索异常', err),
      animes: [] as SearchAnimeItem[],
    };
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const keyword = (searchParams.get('keyword') || '').trim();

  if (!keyword) {
    return NextResponse.json(
      { code: 400, message: '缺少必要参数: keyword', animes: [] },
      { status: 400 },
    );
  }

  let danmuConfig: Awaited<ReturnType<typeof getConfig>>['DanmuConfig'] =
    undefined;
  try {
    const adminConfig = await getConfig();
    danmuConfig = adminConfig.DanmuConfig;
  } catch (err) {
    console.warn(
      '[danmu-search] Failed to read DanmuConfig, fallback to dandanplay:',
      err instanceof Error ? err.message : String(err),
    );
  }

  const customConfig =
    danmuConfig?.enabled === true && !!danmuConfig.serverUrl
      ? (danmuConfig as NonNullable<
          Awaited<ReturnType<typeof getConfig>>['DanmuConfig']
        >)
      : null;

  const searchResult = customConfig
    ? await searchFromCustomServer(keyword, customConfig)
    : await searchFromDandanplay(keyword);

  const source = customConfig ? 'custom-danmu-api' : 'dandanplay';

  if (!searchResult.ok) {
    return NextResponse.json(
      {
        code: searchResult.status,
        message: searchResult.message,
        source,
        keyword,
        animes: [],
      },
      { status: searchResult.status, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  return NextResponse.json(
    {
      code: 200,
      message: '获取成功',
      source,
      keyword,
      animes: searchResult.animes,
      count: searchResult.animes.length,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
