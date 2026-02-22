/* eslint-disable no-console */
import { createHash } from 'crypto';
import { NextResponse } from 'next/server';

import { getCacheTime, getConfig } from '@/lib/config';

export const runtime = 'nodejs';

// ============================================================================
// 弹弹play API 配置
// ============================================================================

const DANDANPLAY_API_BASE = 'https://api.dandanplay.net';

/** 获取弹弹play API凭证（由开发者在构建时通过 GitHub Actions Secrets 内置） */
function getDandanplayCredentials() {
  return {
    appId: process.env.DANDANPLAY_APP_ID || '',
    appSecret: process.env.DANDANPLAY_APP_SECRET || '',
  };
}

// ============================================================================
// Types
// ============================================================================

interface DanmuItem {
  time: number;
  text: string;
  color?: string;
  mode?: 0 | 1 | 2;
}

interface DandanplayAnimeEntry {
  animeId: number;
  animeTitle: string;
  type: string;
  typeDescription?: string;
  imageUrl?: string;
  animeImageUrl?: string;
  cover?: string;
  episodes: Array<{
    episodeId: number;
    episodeTitle: string;
  }>;
}

interface DandanplaySearchResult {
  success?: boolean;
  errorCode?: number;
  errorMessage?: string;
  hasMore?: boolean;
  animes: DandanplayAnimeEntry[];
}

interface DandanplayCommentResult {
  count: number;
  comments: Array<{
    cid: number;
    p: string; // "时间,模式,颜色,用户ID"
    m: string; // 弹幕内容
  }>;
}

interface MatchedEpisode {
  animeId?: number;
  episodeId: number;
  animeTitle: string;
  episodeTitle: string;
  shift: number;
  matchLevel: string;
}

// ============================================================================
// 服务端内存缓存 (两级缓存 + 自动过期清理)
// ============================================================================

interface CacheEntry<T> {
  data: T;
  ts: number;
  ttl: number;
}

/** episodeId 映射缓存：避免重复搜索匹配 */
const episodeIdCache = new Map<string, CacheEntry<MatchedEpisode>>();
/** 弹幕数据缓存：避免重复拉取弹幕 */
const danmuCache = new Map<string, CacheEntry<DanmuItem[]>>();

// 缓存 TTL 常量（毫秒）
const EPISODE_ID_TTL = 7 * 24 * 3600 * 1000; // episodeId 映射: 7天（映射关系基本不变）
const DANMU_TTL_DEFAULT = 6 * 3600 * 1000; // 弹幕数据默认: 6小时
const DANMU_TTL_EMPTY = 30 * 60 * 1000; // 空结果: 30分钟（快速重试）
const CACHE_CLEANUP_INTERVAL = 10 * 60 * 1000; // 清理间隔: 10分钟
const MAX_CACHE_SIZE = 2000; // 单个缓存 Map 的最大条目数
const CUSTOM_SERVER_TIMEOUT_MS = 20_000;

let lastCleanup = Date.now();

/** 检查并清理过期缓存 */
function cleanupCaches() {
  const now = Date.now();
  if (now - lastCleanup < CACHE_CLEANUP_INTERVAL) return;
  lastCleanup = now;

  let cleaned = 0;
  Array.from(episodeIdCache.entries()).forEach(([key, entry]) => {
    if (now - entry.ts > entry.ttl) {
      episodeIdCache.delete(key);
      cleaned++;
    }
  });
  Array.from(danmuCache.entries()).forEach(([key, entry]) => {
    if (now - entry.ts > entry.ttl) {
      danmuCache.delete(key);
      cleaned++;
    }
  });

  // 如果缓存过大，LRU 式清理最老的条目
  if (episodeIdCache.size > MAX_CACHE_SIZE) {
    const toDelete = episodeIdCache.size - MAX_CACHE_SIZE;
    const keys = Array.from(episodeIdCache.keys()).slice(0, toDelete);
    keys.forEach((k) => episodeIdCache.delete(k));
    cleaned += toDelete;
  }
  if (danmuCache.size > MAX_CACHE_SIZE) {
    const toDelete = danmuCache.size - MAX_CACHE_SIZE;
    const keys = Array.from(danmuCache.keys()).slice(0, toDelete);
    keys.forEach((k) => danmuCache.delete(k));
    cleaned += toDelete;
  }

  if (cleaned > 0) {
    console.log(
      `[danmu-cache] Cleaned ${cleaned} entries. episodeId: ${episodeIdCache.size}, danmu: ${danmuCache.size}`,
    );
  }
}

function getCacheValid<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > entry.ttl) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  data: T,
  ttl: number,
) {
  cache.set(key, { data, ts: Date.now(), ttl });
}

function parsePositiveInt(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

// ============================================================================
// 弹弹play API 签名生成
// ============================================================================

/**
 * 生成弹弹play API签名
 * 算法: base64(sha256(AppId + Timestamp + Path + AppSecret))
 */
function generateDandanplaySignature(
  appId: string,
  appSecret: string,
  path: string,
  timestamp: number,
): string {
  const data = appId + timestamp + path + appSecret;
  return createHash('sha256').update(data).digest('base64');
}

/** 构建带签名的请求头 */
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

// ============================================================================
// 标题清洗与智能匹配
// ============================================================================

/**
 * 生成标题搜索变体（从精确到模糊）
 * 用于多级回退搜索，提高匹配成功率
 */
function generateTitleVariants(rawTitle: string): string[] {
  const variants: string[] = [rawTitle];

  // 去除"第X季"后缀 → "进击的巨人 第三季" → "进击的巨人"
  const noSeasonCN = rawTitle
    .replace(/\s*第[一二三四五六七八九十百千\d]+季.*$/, '')
    .trim();
  if (noSeasonCN !== rawTitle && noSeasonCN.length >= 2) {
    variants.push(noSeasonCN);
  }

  // 去除英文 Season 后缀 → "Attack on Titan Season 3" → "Attack on Titan"
  const noSeasonEN = rawTitle.replace(/\s*Season\s*\d+.*$/i, '').trim();
  if (noSeasonEN !== rawTitle && noSeasonEN.length >= 2) {
    variants.push(noSeasonEN);
  }

  // 去除括号内容 → "鬼灭之刃（柱训练篇）" → "鬼灭之刃"
  const noBrackets = rawTitle
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (noBrackets !== rawTitle && noBrackets.length >= 2) {
    variants.push(noBrackets);
  }

  // 去除副标题（冒号/破折号后内容） → "Re:ZERO -Starting Life..." → "Re:ZERO"
  const noSubtitle = rawTitle.split(/\s*[-—]\s*/)[0].trim();
  if (
    noSubtitle !== rawTitle &&
    noSubtitle.length >= 2 &&
    !noSubtitle.includes(':')
  ) {
    variants.push(noSubtitle);
  }

  // 中文冒号分割 → "某作品：某副标题" → "某作品"
  const noColonCN = rawTitle.split('：')[0].trim();
  if (noColonCN !== rawTitle && noColonCN.length >= 2) {
    variants.push(noColonCN);
  }

  // 去重并过滤过短的变体
  return Array.from(new Set(variants)).filter((t) => t.length >= 2);
}

/**
 * 计算标题相似度评分（0-100）
 * 用于从搜索结果中选择最佳匹配
 */
function titleSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();

  // 完全匹配
  if (la === lb) return 100;

  // 包含关系
  if (la.includes(lb) || lb.includes(la)) {
    const ratio =
      Math.min(la.length, lb.length) / Math.max(la.length, lb.length);
    return Math.round(70 + ratio * 25);
  }

  // 共同字符比例（简单 bigram 相似度）
  const bigramsA = new Set<string>();
  for (let i = 0; i < la.length - 1; i++) bigramsA.add(la.slice(i, i + 2));
  const bigramsB = new Set<string>();
  for (let i = 0; i < lb.length - 1; i++) bigramsB.add(lb.slice(i, i + 2));

  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  bigramsA.forEach((bg) => {
    if (bigramsB.has(bg)) intersection++;
  });

  return Math.round((2 * intersection * 60) / (bigramsA.size + bigramsB.size));
}

/**
 * 从搜索结果中智能选择最佳匹配
 */
function findBestMatch(
  animes: DandanplayAnimeEntry[],
  title: string,
  episode: number,
  year?: string,
): MatchedEpisode | null {
  if (!animes || animes.length === 0) return null;

  interface ScoredAnime {
    anime: DandanplayAnimeEntry;
    score: number;
  }

  // 评分排序
  const scored: ScoredAnime[] = animes
    .filter((a) => a.episodes && a.episodes.length > 0)
    .map((anime) => {
      let score = titleSimilarity(title, anime.animeTitle);

      // 年份匹配加分（如果提供了年份）
      if (year && anime.typeDescription) {
        if (anime.typeDescription.includes(year)) {
          score += 15;
        }
      }

      // 集数范围匹配加分
      if (anime.episodes.length >= episode) {
        score += 10;
      }

      // 类型加分：电视剧/动画系列优先（因为弹幕更多）
      if (
        anime.type === 'tvseries' ||
        anime.type === 'tmdbtv' ||
        anime.type === 'jpdrama'
      ) {
        score += 5;
      }

      return { anime, score };
    })
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) return null;

  const best = scored[0];

  // 在最佳匹配中定位集数
  const episodeId = resolveEpisodeId(best.anime.episodes, episode);
  if (!episodeId) return null;

  const episodeEntry = best.anime.episodes.find(
    (e) => e.episodeId === episodeId,
  );

  return {
    animeId: best.anime.animeId,
    episodeId,
    animeTitle: best.anime.animeTitle,
    episodeTitle: episodeEntry?.episodeTitle || `第${episode}集`,
    shift: 0,
    matchLevel: `score:${best.score}`,
  };
}

/**
 * 在集数列表中定位目标集数的 episodeId
 */
function resolveEpisodeId(
  episodes: Array<{ episodeId: number; episodeTitle: string }>,
  targetEp: number,
): number | null {
  if (!episodes || episodes.length === 0) return null;

  // 策略1: 直接按索引（最常见情况）
  if (episodes.length >= targetEp && targetEp > 0) {
    return episodes[targetEp - 1].episodeId;
  }

  // 策略2: 按标题中的数字匹配
  for (const ep of episodes) {
    const match = ep.episodeTitle?.match(/第?(\d+)[话集話期回]?/);
    if (match && parseInt(match[1], 10) === targetEp) {
      return ep.episodeId;
    }
  }

  // 策略3: 电影/剧场版（只有一集）
  if (targetEp === 1 && episodes.length === 1) {
    return episodes[0].episodeId;
  }

  // 策略4: 如果目标集数超出范围，取最后一集
  if (targetEp > episodes.length && episodes.length > 0) {
    return episodes[episodes.length - 1].episodeId;
  }

  return null;
}

// ============================================================================
// 弹幕解析与处理
// ============================================================================

/**
 * 解析弹弹play弹幕格式
 * p 格式: "时间,模式,颜色,用户ID" 如 "12.345,1,16777215,uid123"
 * 模式: 1-普通滚动, 4-底部, 5-顶部
 */
function normalizeDanmuMode(mode: number): 0 | 1 | 2 {
  switch (mode) {
    case 4:
      return 2; // 底部
    case 5:
      return 1; // 顶部
    // 与 bilibili/xml 兼容：2/3/6 归并为滚动
    case 1:
    case 2:
    case 3:
    case 6:
    default:
      return 0; // 滚动
  }
}

function parseDandanComment(
  p: string,
  m: string,
  shift: number = 0,
): DanmuItem | null {
  try {
    const parts = p.split(',');
    const time = parseFloat(parts[0]) + shift;
    const mode = parseInt(parts[1], 10);
    const colorNum = parseInt(parts[2], 10);
    const text = typeof m === 'string' ? m.trim() : '';

    if (isNaN(time) || time < 0 || !text) return null;

    // 转换颜色为十六进制
    const color = '#' + (colorNum >>> 0).toString(16).padStart(6, '0');

    return { time, text, color, mode: normalizeDanmuMode(mode) };
  } catch {
    return null;
  }
}

/** 弹幕去重 */
function deduplicateDanmu(danmus: DanmuItem[]): DanmuItem[] {
  const seen = new Set<string>();
  return danmus.filter((d) => {
    const key = `${Math.round(d.time * 10)}_${d.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ============================================================================
// 弹弹play API 调用（带超时和细粒度错误处理）
// ============================================================================

/** 搜索动画（按标题） */
async function searchByTitle(
  appId: string,
  appSecret: string,
  title: string,
): Promise<DandanplaySearchResult | null> {
  const path = '/api/v2/search/episodes';
  const url = `${DANDANPLAY_API_BASE}${path}?anime=${encodeURIComponent(title)}&episode=`;
  const headers = buildDandanplayHeaders(appId, appSecret, path);

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      const errMsg = response.headers.get('X-Error-Message') || '';
      console.log(
        `[danmu] Search failed for "${title}":`,
        response.status,
        errMsg,
      );
      return null;
    }

    const data = await response.json();
    if (data.success === false) {
      console.log(
        `[danmu] Search API error for "${title}":`,
        data.errorMessage,
      );
      return null;
    }

    return data;
  } catch (err) {
    console.error(`[danmu] Search error for "${title}":`, err);
    return null;
  }
}

/** 获取弹幕（支持 302 重定向 + 简繁转换） */
async function fetchComments(
  appId: string,
  appSecret: string,
  episodeId: number,
): Promise<DandanplayCommentResult | null> {
  const path = `/api/v2/comment/${episodeId}`;
  const url = `${DANDANPLAY_API_BASE}${path}?withRelated=true&chConvert=1`;
  const headers = buildDandanplayHeaders(appId, appSecret, path);

  try {
    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(20000),
      // fetch 默认 redirect: 'follow'，自动处理 302 跳转到弹幕 CDN
    });

    if (!response.ok) {
      const errMsg = response.headers.get('X-Error-Message') || '';
      console.log(
        `[danmu] Comments fetch failed for ep ${episodeId}:`,
        response.status,
        errMsg,
      );
      return null;
    }

    return response.json();
  } catch (err) {
    console.error(`[danmu] Comments fetch error for ep ${episodeId}:`, err);
    return null;
  }
}

// ============================================================================
// 核心匹配引擎 — 多级瀑布流匹配
// ============================================================================

/**
 * 多级瀑布流匹配引擎
 * Level 0: 缓存命中
 * Level 1: 原始标题搜索
 * Level 2: 标题变体逐一搜索
 */
async function resolveEpisode(
  appId: string,
  appSecret: string,
  title: string,
  episode: number,
  year?: string,
): Promise<MatchedEpisode | null> {
  // --- Level 0: 缓存查询 ---
  const cacheKey = `${title.toLowerCase().trim()}:${episode}:${year || ''}`;
  const cached = getCacheValid(episodeIdCache, cacheKey);
  if (cached) {
    console.log(
      `[danmu] Cache hit: "${title}" ep${episode} → episodeId ${cached.episodeId} (${cached.animeTitle})`,
    );
    return cached;
  }

  // --- Level 1: 原始标题搜索 ---
  const titleVariants = generateTitleVariants(title);

  for (const variant of titleVariants) {
    const searchData = await searchByTitle(appId, appSecret, variant);
    if (!searchData || !searchData.animes || searchData.animes.length === 0) {
      continue;
    }

    const match = findBestMatch(searchData.animes, title, episode, year);
    if (match && match.episodeId) {
      match.matchLevel = `variant:"${variant}" ${match.matchLevel}`;
      // 缓存映射
      setCache(episodeIdCache, cacheKey, match, EPISODE_ID_TTL);
      console.log(
        `[danmu] Matched: "${title}" ep${episode} → ${match.animeTitle} [${match.episodeTitle}] (${match.matchLevel})`,
      );
      return match;
    }
  }

  console.log(
    `[danmu] No match found for "${title}" ep${episode} after ${titleVariants.length} variant(s)`,
  );
  return null;
}

// ============================================================================
// 弹幕获取完整流程
// ============================================================================

interface DanmuResult {
  danmus: DanmuItem[];
  matchInfo: {
    animeId?: number;
    animeTitle: string;
    episodeTitle: string;
    episodeId: number;
    matchLevel: string;
  } | null;
}

async function fetchDanmu(
  appId: string,
  appSecret: string,
  title: string,
  episode: number,
  year?: string,
  forceRefresh: boolean = false,
): Promise<DanmuResult> {
  const emptyResult: DanmuResult = { danmus: [], matchInfo: null };

  if (!appId || !appSecret) {
    console.log('[danmu] API credentials not configured.');
    return emptyResult;
  }

  try {
    // 第一步: 匹配 episodeId
    const matched = await resolveEpisode(
      appId,
      appSecret,
      title,
      episode,
      year,
    );
    if (!matched) return emptyResult;

    // 第二步: 检查弹幕数据缓存
    const danmuCacheKey = `danmu:${matched.episodeId}`;
    const cachedDanmu = forceRefresh
      ? null
      : getCacheValid(danmuCache, danmuCacheKey);
    if (cachedDanmu) {
      console.log(
        `[danmu] Danmu cache hit: ep ${matched.episodeId}, ${cachedDanmu.length} items`,
      );
      return {
        danmus: cachedDanmu,
        matchInfo: {
          animeId: matched.animeId,
          animeTitle: matched.animeTitle,
          episodeTitle: matched.episodeTitle,
          episodeId: matched.episodeId,
          matchLevel: matched.matchLevel,
        },
      };
    }

    // 第三步: 拉取弹幕
    const commentData = await fetchComments(
      appId,
      appSecret,
      matched.episodeId,
    );

    if (
      !commentData ||
      !commentData.comments ||
      commentData.comments.length === 0
    ) {
      console.log(
        `[danmu] No comments for ep ${matched.episodeId} (${matched.animeTitle})`,
      );
      // 缓存空结果（短 TTL），避免反复请求
      setCache(danmuCache, danmuCacheKey, [], DANMU_TTL_EMPTY);
      return {
        danmus: [],
        matchInfo: {
          animeId: matched.animeId,
          animeTitle: matched.animeTitle,
          episodeTitle: matched.episodeTitle,
          episodeId: matched.episodeId,
          matchLevel: matched.matchLevel,
        },
      };
    }

    // 第四步: 解析弹幕（应用 shift 时间偏移）
    const danmus: DanmuItem[] = [];
    for (const comment of commentData.comments) {
      const parsed = parseDandanComment(comment.p, comment.m, matched.shift);
      if (parsed) danmus.push(parsed);
    }

    // 缓存弹幕数据
    setCache(danmuCache, danmuCacheKey, danmus, DANMU_TTL_DEFAULT);

    console.log(
      `[danmu] Fetched ${danmus.length} danmu for "${matched.animeTitle}" [${matched.episodeTitle}]`,
    );

    return {
      danmus,
      matchInfo: {
        animeId: matched.animeId,
        animeTitle: matched.animeTitle,
        episodeTitle: matched.episodeTitle,
        episodeId: matched.episodeId,
        matchLevel: matched.matchLevel,
      },
    };
  } catch (err) {
    console.error('[danmu] Fetch error:', err);
    return emptyResult;
  }
}

async function fetchDanmuByEpisodeId(
  appId: string,
  appSecret: string,
  options: {
    animeId?: number;
    episodeId: number;
    animeTitle?: string;
    episodeTitle?: string;
    forceRefresh?: boolean;
  },
): Promise<DanmuResult> {
  const {
    animeId,
    episodeId,
    animeTitle,
    episodeTitle,
    forceRefresh = false,
  } = options;
  const emptyResult: DanmuResult = {
    danmus: [],
    matchInfo: {
      animeId,
      animeTitle: animeTitle || '手动匹配',
      episodeTitle: episodeTitle || `episodeId:${episodeId}`,
      episodeId,
      matchLevel: 'manual-override',
    },
  };

  if (!appId || !appSecret || !episodeId) {
    return emptyResult;
  }

  const danmuCacheKey = `danmu:${episodeId}`;
  const cachedDanmu = forceRefresh
    ? null
    : getCacheValid(danmuCache, danmuCacheKey);
  if (cachedDanmu) {
    return {
      danmus: cachedDanmu,
      matchInfo: emptyResult.matchInfo,
    };
  }

  const commentData = await fetchComments(appId, appSecret, episodeId);
  if (
    !commentData ||
    !commentData.comments ||
    commentData.comments.length === 0
  ) {
    setCache(danmuCache, danmuCacheKey, [], DANMU_TTL_EMPTY);
    return emptyResult;
  }

  const danmus: DanmuItem[] = [];
  for (const comment of commentData.comments) {
    const parsed = parseDandanComment(comment.p, comment.m);
    if (parsed) danmus.push(parsed);
  }

  setCache(danmuCache, danmuCacheKey, danmus, DANMU_TTL_DEFAULT);

  return {
    danmus,
    matchInfo: emptyResult.matchInfo,
  };
}

// ============================================================================
// Route Handler
// ============================================================================

// ============================================================================
// 自定义弹幕服务器请求逻辑（抽取为独立函数，增强错误可见性）
// ============================================================================

/**
 * 解析自定义弹幕服务器返回的弹幕评论数组
 */
function parseCustomComments(
  comments: Array<{ p: string; m: string }>,
): DanmuItem[] {
  return comments.map((c) => {
    const parts = (c.p || '').split(',');
    const time = parseFloat(parts[0]) || 0;
    const modeRaw = parseInt(parts[1]) || 1;
    const color = parseInt(parts[2]) || 16777215;
    let mode: 0 | 1 | 2 = 0;
    if (modeRaw === 4) mode = 2;
    else if (modeRaw === 5) mode = 1;
    return {
      time,
      text: c.m || '',
      color: `#${color.toString(16).padStart(6, '0')}`,
      mode,
    };
  });
}

/**
 * 通过自定义弹幕服务器获取弹幕（完整流程）
 *
 * 在 Serverless 环境（Vercel/Zeabur 等）下的关键设计：
 * 1. 每个 fetch 都有明确的 AbortSignal.timeout
 * 2. 所有错误都会被捕获并打印详细日志（不静默吞掉）
 * 3. 返回结构化结果，明确区分"请求失败"和"无匹配结果"
 */
async function fetchFromCustomServer(
  dc: NonNullable<Awaited<ReturnType<typeof getConfig>>['DanmuConfig']>,
  title: string,
  episode: number,
  _forceRefresh: boolean,
): Promise<{
  success: boolean;
  danmus: DanmuItem[];
  match: {
    animeId?: number;
    animeTitle: string;
    episodeTitle: string;
    episodeId: number;
    matchLevel: string;
  } | null;
  error?: string;
}> {
  const emptyResult = { success: false, danmus: [], match: null };

  const baseUrl = dc.serverUrl.replace(/\/+$/, '');
  const tokenSegment = dc.token ? `/${dc.token}` : '';
  const serverBase = `${baseUrl}${tokenSegment}`;
  const format = dc.danmuOutputFormat || 'json';

  console.log(
    `[danmu-custom] Attempting custom server: ${baseUrl} (enabled=${dc.enabled})`,
  );

  // --- 步骤 1: 尝试 match 自动匹配 ---
  let matchTitle = title;
  if (dc.platform) {
    matchTitle = `${title} @${dc.platform.split(',')[0]}`;
  }

  try {
    const matchResp = await fetch(`${serverBase}/api/v2/match`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ fileName: matchTitle, fileHash: '' }),
      signal: AbortSignal.timeout(CUSTOM_SERVER_TIMEOUT_MS),
    });

    if (matchResp.ok) {
      const matchResult = await matchResp.json();
      if (
        matchResult?.isMatched &&
        matchResult.matches &&
        matchResult.matches.length > 0
      ) {
        const bestMatch = matchResult.matches[0];
        const episodeId = bestMatch.episodeId;
        if (episodeId) {
          const commentUrl = `${serverBase}/api/v2/comment/${episodeId}?format=${format}`;
          const commentResp = await fetch(commentUrl, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(CUSTOM_SERVER_TIMEOUT_MS),
          });
          if (commentResp.ok) {
            const commentData = await commentResp.json();
            const comments = commentData?.comments || [];
            const danmus = parseCustomComments(comments);
            console.log(
              `[danmu-custom] Match success: episodeId=${episodeId}, danmus=${danmus.length}`,
            );
            return {
              success: true,
              danmus,
              match: {
                animeId:
                  parsePositiveInt(String(bestMatch.animeId ?? '')) ||
                  undefined,
                animeTitle: bestMatch.animeTitle || title,
                episodeTitle: bestMatch.episodeTitle || `第${episode}集`,
                episodeId,
                matchLevel: 'auto',
              },
            };
          } else {
            console.warn(
              `[danmu-custom] Comment fetch failed: HTTP ${commentResp.status} ${commentResp.statusText}`,
            );
          }
        }
      }
    } else {
      console.warn(
        `[danmu-custom] Match request failed: HTTP ${matchResp.status} ${matchResp.statusText}`,
      );
    }
  } catch (matchErr) {
    console.error(
      '[danmu-custom] Match request error (will try search fallback):',
      matchErr instanceof Error ? matchErr.message : matchErr,
    );
  }

  // --- 步骤 2: match 未成功，尝试 search fallback ---
  try {
    const searchUrl = `${serverBase}/api/v2/search/episodes?anime=${encodeURIComponent(title)}`;
    console.log(`[danmu-custom] Trying search fallback: ${searchUrl}`);
    const searchResp = await fetch(searchUrl, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CUSTOM_SERVER_TIMEOUT_MS),
    });

    if (searchResp.ok) {
      const searchData = await searchResp.json();
      const animes = searchData?.animes || [];
      if (animes.length > 0) {
        const anime = animes[0];
        const episodes = anime?.episodes || [];
        const targetEp = episodes[episode - 1] || episodes[0];
        if (targetEp?.episodeId) {
          const commentUrl = `${serverBase}/api/v2/comment/${targetEp.episodeId}?format=${format}`;
          const commentResp = await fetch(commentUrl, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(CUSTOM_SERVER_TIMEOUT_MS),
          });
          if (commentResp.ok) {
            const commentData = await commentResp.json();
            const comments = commentData?.comments || [];
            const danmus = parseCustomComments(comments);
            console.log(
              `[danmu-custom] Search fallback success: episodeId=${targetEp.episodeId}, danmus=${danmus.length}`,
            );
            return {
              success: true,
              danmus,
              match: {
                animeId:
                  parsePositiveInt(String(anime?.animeId ?? '')) || undefined,
                animeTitle: anime.animeTitle || title,
                episodeTitle: targetEp.episodeTitle || `第${episode}集`,
                episodeId: targetEp.episodeId,
                matchLevel: 'search',
              },
            };
          } else {
            console.warn(
              `[danmu-custom] Search comment fetch failed: HTTP ${commentResp.status} ${commentResp.statusText}`,
            );
          }
        }
      }
    } else {
      console.warn(
        `[danmu-custom] Search request failed: HTTP ${searchResp.status} ${searchResp.statusText}`,
      );
    }
  } catch (searchErr) {
    console.error(
      '[danmu-custom] Search fallback error:',
      searchErr instanceof Error ? searchErr.message : searchErr,
    );
    return {
      ...emptyResult,
      error: `自定义弹幕服务器请求失败: ${searchErr instanceof Error ? searchErr.message : String(searchErr)}`,
    };
  }

  // 所有尝试均无结果
  console.log('[danmu-custom] All attempts returned no results.');
  return { ...emptyResult, error: '自定义弹幕服务器未返回有效弹幕数据' };
}

async function fetchFromCustomServerByEpisodeId(
  dc: NonNullable<Awaited<ReturnType<typeof getConfig>>['DanmuConfig']>,
  options: {
    animeId?: number;
    episodeId: number;
    animeTitle?: string;
    episodeTitle?: string;
  },
): Promise<{
  success: boolean;
  danmus: DanmuItem[];
  match: {
    animeId?: number;
    animeTitle: string;
    episodeTitle: string;
    episodeId: number;
    matchLevel: string;
  } | null;
  error?: string;
}> {
  const emptyResult = { success: false, danmus: [], match: null };
  const { animeId, episodeId, animeTitle, episodeTitle } = options;

  if (!episodeId) {
    return { ...emptyResult, error: 'episode_id 无效' };
  }

  const baseUrl = dc.serverUrl.replace(/\/+$/, '');
  const tokenSegment = dc.token ? `/${dc.token}` : '';
  const serverBase = `${baseUrl}${tokenSegment}`;
  const format = dc.danmuOutputFormat || 'json';

  try {
    const commentResp = await fetch(
      `${serverBase}/api/v2/comment/${episodeId}?format=${format}`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(CUSTOM_SERVER_TIMEOUT_MS),
      },
    );

    if (!commentResp.ok) {
      return {
        ...emptyResult,
        error: `评论接口请求失败: HTTP ${commentResp.status} ${commentResp.statusText}`,
      };
    }

    const commentData = await commentResp.json();
    const comments = commentData?.comments || [];
    const danmus = parseCustomComments(comments);
    const manualMatch = {
      animeId,
      animeTitle: animeTitle || '手动匹配',
      episodeTitle: episodeTitle || `episodeId:${episodeId}`,
      episodeId,
      matchLevel: 'manual-override',
    };

    if (danmus.length === 0) {
      return {
        success: true,
        danmus: [],
        match: manualMatch,
        error: '该集暂无弹幕',
      };
    }

    return {
      success: true,
      danmus,
      match: manualMatch,
    };
  } catch (err) {
    return {
      ...emptyResult,
      error: `自定义弹幕服务器请求失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ============================================================================
// Route Handler — 重构后的优先级逻辑
//
// ★★★ 核心优先级规则 ★★★
// 第一优先级（最高）：数据库/后台 DanmuConfig
//   - 如果 DanmuConfig.enabled === true，则 **强制使用** 自定义弹幕源
//   - 即使环境变量 DANDANPLAY_APP_ID/SECRET 存在，也 **不会回落** 到弹弹play
//   - 只有当自定义源返回空结果（非错误）时，才在响应中说明无弹幕
//
// 第二优先级（回落）：环境变量弹弹play
//   - 只有当 DanmuConfig.enabled !== true（关闭/未配置）时才使用
//   - 需要 DANDANPLAY_APP_ID 和 DANDANPLAY_APP_SECRET 环境变量
// ============================================================================

export async function GET(request: Request) {
  // 定期清理过期缓存
  cleanupCaches();

  const { searchParams } = new URL(request.url);
  const title = searchParams.get('title');
  const episodeStr = searchParams.get('episode');
  const manualAnimeId = parsePositiveInt(searchParams.get('anime_id'));
  const manualEpisodeId = parsePositiveInt(searchParams.get('episode_id'));
  const manualAnimeTitle = searchParams.get('anime_title') || undefined;
  const manualEpisodeTitle = searchParams.get('episode_title') || undefined;
  const year = searchParams.get('year') || undefined;
  const forceRefresh = searchParams.get('force') === '1';
  const episodeParsed = parsePositiveInt(episodeStr);
  const episode = episodeParsed || 1;
  const requestedManualEpisode = searchParams.get('episode_id');
  const isManualOverride = requestedManualEpisode !== null;

  if (isManualOverride && !manualEpisodeId) {
    return NextResponse.json(
      { code: 400, message: 'episode_id 无效', danmus: [], count: 0 },
      { status: 400 },
    );
  }

  if (!title && !manualEpisodeId) {
    return NextResponse.json(
      {
        code: 400,
        message: '缺少必要参数: title 或 episode_id',
        danmus: [],
        count: 0,
      },
      { status: 400 },
    );
  }

  // ========================================================================
  // ★ 第一步：读取数据库配置，判断用户是否启用了自定义弹幕源
  // ========================================================================
  let danmuConfig: Awaited<ReturnType<typeof getConfig>>['DanmuConfig'] =
    undefined;
  let configReadError: string | null = null;

  try {
    const adminConfig = await getConfig();
    danmuConfig = adminConfig.DanmuConfig;
  } catch (configErr) {
    configReadError =
      configErr instanceof Error ? configErr.message : String(configErr);
    console.error(
      '[danmu-external] Failed to read DanmuConfig:',
      configReadError,
    );
  }

  // ========================================================================
  // ★ 核心决策点：DanmuConfig.enabled 是唯一的源选择开关
  // ========================================================================
  const customConfig =
    danmuConfig?.enabled === true && !!danmuConfig?.serverUrl
      ? (danmuConfig as NonNullable<
          Awaited<ReturnType<typeof getConfig>>['DanmuConfig']
        >)
      : null;

  if (customConfig) {
    // ==================================================================
    // 路径 A：用户在后台开启了"自定义弹幕" → 强制使用自定义源
    //         无论环境变量是否存在，都不回落到弹弹play
    // ==================================================================
    console.log(
      '[danmu-external] ★ Custom danmu ENABLED by admin config — ignoring env vars',
    );

    const customResult =
      manualEpisodeId && isManualOverride
        ? await fetchFromCustomServerByEpisodeId(customConfig, {
            animeId: manualAnimeId || undefined,
            episodeId: manualEpisodeId,
            animeTitle: manualAnimeTitle || title || undefined,
            episodeTitle: manualEpisodeTitle || undefined,
          })
        : await fetchFromCustomServer(
            customConfig,
            title || '',
            episode,
            forceRefresh,
          );

    const cacheTime = await getCacheTime();
    const cacheHeaders = forceRefresh
      ? { 'Cache-Control': 'no-store, max-age=0' }
      : {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        };

    if (customResult.success && customResult.danmus.length > 0) {
      // 自定义源成功返回弹幕
      let finalDanmus = deduplicateDanmu(customResult.danmus);
      finalDanmus.sort((a, b) => a.time - b.time);

      return NextResponse.json(
        {
          code: 200,
          message: '获取成功',
          danmus: finalDanmus,
          count: finalDanmus.length,
          source: 'custom-danmu-api',
          match: customResult.match,
        },
        { headers: cacheHeaders },
      );
    }

    // 自定义源未能返回弹幕（可能是无匹配/无弹幕/请求失败）
    // ★★★ 关键变化：不回落到弹弹play，直接返回空结果+详细错误信息 ★★★
    const errorDetail = customResult.error || '自定义弹幕服务器未返回弹幕数据';
    console.warn(
      `[danmu-external] Custom source returned no danmus: ${errorDetail}`,
    );

    return NextResponse.json(
      {
        code: 200,
        message: `自定义弹幕源无结果: ${errorDetail}`,
        danmus: [],
        count: 0,
        source: 'custom-danmu-api',
        match: customResult.match,
        customError: errorDetail,
      },
      { headers: cacheHeaders },
    );
  }

  // ==================================================================
  // 路径 B：用户未启用自定义弹幕（或配置读取失败）→ 使用弹弹play
  // ==================================================================
  if (configReadError) {
    console.warn(
      `[danmu-external] Config read failed (${configReadError}), falling through to dandanplay`,
    );
  } else {
    console.log('[danmu-external] Custom danmu not enabled, using dandanplay');
  }

  const { appId, appSecret } = getDandanplayCredentials();

  if (!appId || !appSecret) {
    return NextResponse.json(
      {
        code: 503,
        message:
          '弹弹Play API 凭证未配置（缺少 DANDANPLAY_APP_ID / DANDANPLAY_APP_SECRET 环境变量）。如使用官方 Docker 镜像，请确保镜像版本正确。',
        danmus: [],
        count: 0,
      },
      { status: 503 },
    );
  }

  try {
    const result =
      manualEpisodeId && isManualOverride
        ? await fetchDanmuByEpisodeId(appId, appSecret, {
            animeId: manualAnimeId || undefined,
            episodeId: manualEpisodeId,
            animeTitle: manualAnimeTitle || title || undefined,
            episodeTitle: manualEpisodeTitle || undefined,
            forceRefresh,
          })
        : await fetchDanmu(
            appId,
            appSecret,
            title || '',
            episode,
            year,
            forceRefresh,
          );

    // 去重 + 排序
    let finalDanmus = deduplicateDanmu(result.danmus);
    finalDanmus.sort((a, b) => a.time - b.time);

    const cacheTime = await getCacheTime();
    const headers = forceRefresh
      ? {
          'Cache-Control': 'no-store, max-age=0',
          'CDN-Cache-Control': 'no-store',
        }
      : {
          'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
          'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        };

    return NextResponse.json(
      {
        code: 200,
        message: '获取成功',
        danmus: finalDanmus,
        count: finalDanmus.length,
        source: 'dandanplay',
        match: result.matchInfo,
      },
      { headers },
    );
  } catch (err) {
    console.error('[danmu] API error:', err);
    return NextResponse.json(
      {
        code: 500,
        message: '获取弹幕失败',
        danmus: [],
        count: 0,
        error: (err as Error).message,
      },
      { status: 500 },
    );
  }
}
