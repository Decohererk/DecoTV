/* eslint-disable no-console */
import * as cheerio from 'cheerio';
import { unstable_cache } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

// API Keys (备用，主要使用爬虫)
const API_KEY_A = '0ab215a8b1977939201640fa14c66bab';
const API_KEY_B = '0df993c66c0c636e29ecbb5344252a4a';
// 豆瓣移动端 API (小程序/App 使用的接口，更稳定)
const FRODO_API_KEY = '0ac44ae016490db2204ce0a042db2916';

// URL 常量
const DOUBAN_API_BASE = 'https://api.douban.com/v2';
const DOUBAN_WEB_BASE = 'https://movie.douban.com';

// ============================================================================
// 第三方 CDN 代理服务（用于绕过豆瓣 IP 封禁）
// 参考 LunaTV 项目：https://github.com/SzeMeng76/LunaTV
// ============================================================================
// 代理服务列表（按优先级排序）
const DOUBAN_PROXY_URLS = [
  'https://frodo.douban.com/api/v2', // 原始 frodo API（可能被封，但最稳定）
  'https://douban.uieee.com', // 公开代理服务
];

// Chrome/Windows 真实 User-Agent (2024 更新版)
// NOTE: 增强伪装以应对豆瓣反爬机制
const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
  'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  Referer: 'https://movie.douban.com/',
  Host: 'movie.douban.com',
  Connection: 'keep-alive',
  'Sec-Ch-Ua':
    '"Not A(Brand";v="99", "Google Chrome";v="121", "Chromium";v="121"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control': 'max-age=0',
  // 模拟游客会话 cookie (bid 是豆瓣的匿名用户标识)
  Cookie: `bid=${Math.random().toString(36).substring(2, 13)}; ll="118371"`,
};

// ============================================================================
// 图片代理工具函数
// ============================================================================

/**
 * 代理豆瓣图片 URL
 * 使用 cmliussss 的公开代理服务解决豆瓣图片防盗链问题
 * 原理: 将 img*.doubanio.com 替换为 img.doubanio.cmliussss.net
 */
function normalizeImageUrl(url: string | undefined | null): string {
  if (!url) return '';
  const normalized = url
    .replace(/&quot;/g, '')
    .replace(/^['"]+|['"]+$/g, '')
    .trim();

  if (normalized.startsWith('//')) {
    return `https:${normalized}`;
  }

  return normalized;
}

function proxyImageUrl(url: string | undefined | null): string {
  const normalizedUrl = normalizeImageUrl(url);
  if (!normalizedUrl) return '';

  try {
    const parsedUrl = new URL(normalizedUrl);
    const hostname = parsedUrl.hostname.toLowerCase();

    // 已经是 cmliussss 代理域名
    if (
      hostname === 'img.doubanio.cmliussss.net' ||
      hostname === 'img.doubanio.cmliussss.com'
    ) {
      return normalizedUrl;
    }

    // 豆瓣图片统一走 cmliussss，避免防盗链
    if (hostname.endsWith('doubanio.com')) {
      parsedUrl.protocol = 'https:';
      parsedUrl.hostname = 'img.doubanio.cmliussss.net';
      return parsedUrl.toString();
    }

    // 其他 douban.com 图片走本地代理
    if (hostname.endsWith('douban.com')) {
      return `/api/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
    }
  } catch {
    // 忽略 URL 解析错误，继续走字符串规则
  }

  if (normalizedUrl.includes('doubanio.com')) {
    return normalizedUrl.replace(
      /https?:\/\/[^/]*doubanio\.com/gi,
      'https://img.doubanio.cmliussss.net',
    );
  }

  if (normalizedUrl.includes('douban.com')) {
    return `/api/image-proxy?url=${encodeURIComponent(normalizedUrl)}`;
  }

  return normalizedUrl;
}

/**
 * 处理图片对象中的所有 URL
 */
function proxyImageObject(
  images: { small?: string; medium?: string; large?: string } | undefined,
): { small: string; medium: string; large: string } {
  if (!images) return { small: '', medium: '', large: '' };
  return {
    small: proxyImageUrl(images.small),
    medium: proxyImageUrl(images.medium),
    large: proxyImageUrl(images.large),
  };
}

/**
 * 处理整个 ScrapedFullData 中的所有图片 URL
 */
function proxyAllImages(data: ScrapedFullData): ScrapedFullData {
  return {
    ...data,
    images: proxyImageObject(data.images),
    directors: data.directors.map((d) => ({
      ...d,
      avatars: d.avatars ? proxyImageObject(d.avatars) : undefined,
    })),
    casts: data.casts.map((c) => ({
      ...c,
      avatars: c.avatars ? proxyImageObject(c.avatars) : undefined,
    })),
    recommendations: data.recommendations.map((r) => ({
      ...r,
      images: proxyImageObject(r.images),
    })),
    hotComments: data.hotComments.map((c) => ({
      ...c,
      author: {
        ...c.author,
        avatar: proxyImageUrl(c.author.avatar),
      },
    })),
  };
}

// ============================================================================
// 数据类型定义
// ============================================================================

interface ScrapedComment {
  id: string;
  created_at: string;
  content: string;
  useful_count: number;
  rating: { max: number; value: number; min: number } | null;
  author: {
    id: string;
    uid: string;
    name: string;
    avatar: string;
    alt: string;
  };
}

interface ScrapedRecommendation {
  id: string;
  title: string;
  images: { small: string; medium: string; large: string };
  alt: string;
}

interface ScrapedCelebrity {
  id: string;
  name: string;
  alt: string;
  category: string;
  role: string;
  avatars: { small: string; medium: string; large: string };
}

/** 前端期望的名人格式 */
interface FormattedCelebrity {
  id: string;
  name: string;
  alt: string;
  avatars?: { small: string; medium: string; large: string };
  roles: string[];
}

interface ScrapedFullData {
  // 基础信息
  id: string;
  title: string;
  original_title: string;
  year: string;
  rating: { max: number; average: number; stars: string; min: number } | null;
  ratings_count: number;
  genres: string[];
  countries: string[];
  durations: string[];
  summary: string;
  images: { small: string; medium: string; large: string };
  // 富媒体数据（前端期望格式）
  recommendations: ScrapedRecommendation[];
  hotComments: ScrapedComment[];
  directors: FormattedCelebrity[];
  casts: FormattedCelebrity[];
  // 元数据
  scrapedAt: number;
}

const RUNTIME_SUBJECT_CACHE_TTL_MS = 30 * 60 * 1000;
const RUNTIME_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;
const runtimeSubjectCache = new Map<
  string,
  { data: ScrapedFullData; expiresAt: number }
>();
const runtimeRefreshAtMap = new Map<string, number>();

function getRuntimeSubjectCache(subjectId: string): ScrapedFullData | null {
  const cached = runtimeSubjectCache.get(subjectId);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    runtimeSubjectCache.delete(subjectId);
    return null;
  }
  return cached.data;
}

function setRuntimeSubjectCache(
  subjectId: string,
  data: ScrapedFullData,
): void {
  runtimeSubjectCache.set(subjectId, {
    data,
    expiresAt: Date.now() + RUNTIME_SUBJECT_CACHE_TTL_MS,
  });
}

function shouldRefreshSubject(subjectId: string): boolean {
  const now = Date.now();
  const lastRefreshAt = runtimeRefreshAtMap.get(subjectId) || 0;
  if (now - lastRefreshAt < RUNTIME_REFRESH_COOLDOWN_MS) {
    return false;
  }
  runtimeRefreshAtMap.set(subjectId, now);
  return true;
}

type ApiCelebrityItem = {
  id?: string | number;
  name?: string;
  url?: string;
  avatar?:
    | string
    | {
        small?: string;
        medium?: string;
        large?: string;
        normal?: string;
        url?: string;
      };
  character?: string;
  simple_character?: string;
  category?: string;
};

function extractAvatarImages(
  avatar: ApiCelebrityItem['avatar'],
): { small: string; medium: string; large: string } | undefined {
  if (!avatar) return undefined;

  if (typeof avatar === 'string') {
    const url = normalizeImageUrl(avatar);
    return url ? { small: url, medium: url, large: url } : undefined;
  }

  const small = normalizeImageUrl(
    avatar.small ||
      avatar.normal ||
      avatar.medium ||
      avatar.large ||
      avatar.url,
  );
  const medium = normalizeImageUrl(
    avatar.medium ||
      avatar.normal ||
      avatar.large ||
      avatar.small ||
      avatar.url,
  );
  const large = normalizeImageUrl(
    avatar.large ||
      avatar.medium ||
      avatar.normal ||
      avatar.small ||
      avatar.url,
  );

  if (!small && !medium && !large) return undefined;

  return {
    small: small || medium || large || '',
    medium: medium || large || small || '',
    large: large || medium || small || '',
  };
}

function normalizeRoleText(
  rawRole: string | undefined,
  fallbackRole: string,
): string {
  const normalized = (rawRole || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return fallbackRole;

  const cleaned = normalized
    .replace(/^(演员|导演|编剧)\s*(Actor|Actress|Director|Writer)?\s*/i, '')
    .replace(/^\(|\)$/g, '')
    .trim();

  return cleaned || fallbackRole;
}

function toFormattedCelebrity(
  person: ApiCelebrityItem,
  fallbackRole: string,
): FormattedCelebrity | null {
  const name = (person.name || '').trim();
  if (!name) return null;

  const rawId = person.id != null ? String(person.id).trim() : '';
  const altFromPayload = normalizeImageUrl(person.url || '');
  const idFromUrl = altFromPayload.match(/celebrity\/(\d+)/)?.[1] || '';
  const id =
    rawId ||
    idFromUrl ||
    `cel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const alt = altFromPayload || `${DOUBAN_WEB_BASE}/celebrity/${id}/`;
  const avatars = extractAvatarImages(person.avatar);
  const role = normalizeRoleText(
    person.simple_character || person.character,
    fallbackRole,
  );

  return {
    id,
    name,
    alt,
    avatars,
    roles: [role],
  };
}

function upsertFormattedCelebrity(
  list: FormattedCelebrity[],
  incoming: FormattedCelebrity,
) {
  const existing = list.find(
    (item) =>
      (incoming.id && item.id === incoming.id) || item.name === incoming.name,
  );

  if (!existing) {
    list.push(incoming);
    return;
  }

  if (!existing.alt && incoming.alt) {
    existing.alt = incoming.alt;
  }

  if (incoming.avatars) {
    const merged = existing.avatars || { small: '', medium: '', large: '' };
    merged.small = merged.small || incoming.avatars.small || '';
    merged.medium = merged.medium || incoming.avatars.medium || '';
    merged.large = merged.large || incoming.avatars.large || '';
    if (merged.small || merged.medium || merged.large) {
      existing.avatars = merged;
    }
  }

  if (incoming.roles?.length) {
    const roleSet = new Set([...(existing.roles || []), ...incoming.roles]);
    existing.roles = Array.from(roleSet).filter(Boolean);
  }
}

function parseCelebritiesFromApiPayload(payload: unknown): {
  directors: FormattedCelebrity[];
  casts: FormattedCelebrity[];
} {
  const directors: FormattedCelebrity[] = [];
  const casts: FormattedCelebrity[] = [];

  if (!payload || typeof payload !== 'object') {
    return { directors, casts };
  }

  const data = payload as Record<string, unknown>;
  const append = (
    items: unknown,
    fallbackRole: '导演' | '演员',
    target: FormattedCelebrity[],
  ) => {
    if (!Array.isArray(items)) return;

    items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const formatted = toFormattedCelebrity(
        item as ApiCelebrityItem,
        fallbackRole,
      );
      if (formatted) {
        upsertFormattedCelebrity(target, formatted);
      }
    });
  };

  append(data.directors, '导演', directors);
  append(data.actors, '演员', casts);

  if (Array.isArray(data.items)) {
    data.items.forEach((item) => {
      if (!item || typeof item !== 'object') return;
      const person = item as ApiCelebrityItem;
      const category = (person.category || '').toLowerCase();

      if (category.includes('导') || category.includes('director')) {
        const formatted = toFormattedCelebrity(person, '导演');
        if (formatted) upsertFormattedCelebrity(directors, formatted);
        return;
      }

      if (category.includes('演') || category.includes('actor') || !category) {
        const formatted = toFormattedCelebrity(person, '演员');
        if (formatted) upsertFormattedCelebrity(casts, formatted);
      }
    });
  }

  return { directors, casts };
}

// ============================================================================
// 核心爬虫函数
// ============================================================================

/**
 * 从豆瓣网页一次性抓取所有数据
 * 包括：基础信息、推荐影片、热门短评、导演/演员
 */
async function _scrapeDoubanData(subjectId: string): Promise<ScrapedFullData> {
  console.log(`[Douban Scraper] 开始爬取: ${subjectId}`);
  const startTime = Date.now();

  const url = `${DOUBAN_WEB_BASE}/subject/${subjectId}/`;

  const response = await fetch(url, {
    headers: {
      ...BROWSER_HEADERS,
      // 每次请求生成新的 bid 避免被追踪
      Cookie: `bid=${Math.random().toString(36).substring(2, 13)}; ll="118371"`,
    },
    signal: AbortSignal.timeout(20000),
  });

  console.log(
    `[Douban Scraper] 响应状态: ${response.status} ${response.statusText}`,
  );

  if (!response.ok) {
    console.error(`[Douban Scraper] 请求失败: ${response.status}`);
    throw new Error(`爬取失败: ${response.status}`);
  }

  const html = await response.text();
  console.log(`[Douban Scraper] HTML 长度: ${html.length} 字符`);

  // 检查是否被重定向到验证码页面或登录页面
  if (
    html.includes('sec.douban.com') ||
    html.includes('账号登录') ||
    html.length < 5000
  ) {
    console.error('[Douban Scraper] 可能触发了反爬机制，页面内容异常');
    throw new Error('触发豆瓣反爬机制，请稍后重试');
  }

  const $ = cheerio.load(html);

  // ========== 尝试从 ld+json 提取结构化数据（最稳定的方式） ==========
  let ldJsonData: {
    name?: string;
    director?: Array<{
      name: string;
      url?: string;
      image?: string | { contentUrl?: string };
    }>;
    actor?: Array<{
      name: string;
      url?: string;
      image?: string | { contentUrl?: string };
    }>;
    description?: string;
    datePublished?: string;
    aggregateRating?: { ratingValue?: string; ratingCount?: string };
    genre?: string[];
    image?: string;
  } | null = null;

  const ldJsonScript = $('script[type="application/ld+json"]').html();
  if (ldJsonScript) {
    try {
      ldJsonData = JSON.parse(ldJsonScript);
      console.log('[Douban Scraper] 成功解析 ld+json 数据');
    } catch (e) {
      console.warn('[Douban Scraper] ld+json 解析失败:', e);
    }
  } else {
    console.warn('[Douban Scraper] 未找到 ld+json 数据，使用传统 HTML 解析');
  }

  // ========== 基础信息 ==========
  const title =
    $('span[property="v:itemreviewed"]').text().trim() ||
    $('title').text().split(' ')[0];
  const originalTitle =
    $('span.pl:contains("又名")').next().text().trim() || '';
  const year = $('span.year').text().replace(/[()]/g, '').trim() || '';

  // 评分
  const ratingAvg = parseFloat($('strong.rating_num').text().trim()) || 0;
  const ratingStars = $('span.rating_per').first().text().trim() || '';
  const ratingCount =
    parseInt($('span[property="v:votes"]').text().trim()) || 0;

  // 类型、地区、时长
  const genres: string[] = [];
  $('span[property="v:genre"]').each((_, el) => {
    genres.push($(el).text().trim());
  });

  const countries: string[] = [];
  const countryText = $('span.pl:contains("制片国家")').parent().text();
  const countryMatch = countryText.match(/制片国家\/地区:\s*(.+)/);
  if (countryMatch) {
    countries.push(...countryMatch[1].split('/').map((s) => s.trim()));
  }

  const durations: string[] = [];
  $('span[property="v:runtime"]').each((_, el) => {
    durations.push($(el).text().trim());
  });

  // 简介 (完整版)
  let summary = '';
  const $hiddenSummary = $('span.all.hidden');
  if ($hiddenSummary.length) {
    summary = $hiddenSummary.text().trim();
  } else {
    summary = $('span[property="v:summary"]').text().trim();
  }
  summary = summary.replace(/\s+/g, ' ').trim();

  // 海报
  const poster = $('#mainpic img').attr('src') || '';

  // ========== 推荐影片 ==========
  const recommendations: ScrapedRecommendation[] = [];
  $('#recommendations .recommendations-bd dl').each((_, element) => {
    const $item = $(element);
    const $link = $item.find('dd a');
    const $img = $item.find('dt img');

    const href = $link.attr('href') || '';
    const idMatch = href.match(/subject\/(\d+)/);
    const recId = idMatch ? idMatch[1] : '';
    const recTitle = $link.text().trim();
    const recPoster = $img.attr('src') || '';

    if (recId && recTitle) {
      recommendations.push({
        id: recId,
        title: recTitle,
        images: {
          small: recPoster,
          medium: recPoster.replace('s_ratio', 'm_ratio'),
          large: recPoster.replace('s_ratio', 'l_ratio'),
        },
        alt: href,
      });
    }
  });

  // ========== 热门短评 ==========
  const hotComments: ScrapedComment[] = [];
  $('#hot-comments .comment-item').each((_, element) => {
    const $item = $(element);

    const $avatar = $item.find('.avatar a img');
    const $userLink = $item.find('.comment-info a');
    const avatarUrl = $avatar.attr('src') || '';
    const userName = $userLink.text().trim();
    const userLink = $userLink.attr('href') || '';

    const ratingClass = $item.find('.comment-info .rating').attr('class') || '';
    const ratingMatch = ratingClass.match(/allstar(\d+)/);
    const ratingValue = ratingMatch ? parseInt(ratingMatch[1]) / 10 : 0;

    const content = $item.find('.short').text().trim();
    const time =
      $item.find('.comment-time').attr('title') ||
      $item.find('.comment-time').text().trim();
    const usefulCount = parseInt($item.find('.vote-count').text().trim()) || 0;
    const commentId =
      $item.attr('data-cid') || `hot_${Date.now()}_${Math.random()}`;

    if (content) {
      hotComments.push({
        id: commentId,
        created_at: time,
        content,
        useful_count: usefulCount,
        rating: ratingValue > 0 ? { max: 5, value: ratingValue, min: 0 } : null,
        author: {
          id: userLink.split('/').filter(Boolean).pop() || '',
          uid: userName,
          name: userName,
          avatar: avatarUrl
            .replace('/u/pido/', '/u/')
            .replace('s_ratio', 'm_ratio'),
          alt: userLink,
        },
      });
    }
  });

  // ========== 导演/演员 (从主页解析) ==========
  const directors: ScrapedCelebrity[] = [];
  const actors: ScrapedCelebrity[] = [];

  // 导演
  $('a[rel="v:directedBy"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const idMatch = href.match(/celebrity\/(\d+)/);
    const name = $el.text().trim();

    if (name) {
      directors.push({
        id: idMatch ? idMatch[1] : '',
        name,
        alt: href,
        category: '导演',
        role: '导演',
        avatars: { small: '', medium: '', large: '' },
      });
    }
  });

  // 演员
  $('a[rel="v:starring"]').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';
    const idMatch = href.match(/celebrity\/(\d+)/);
    const name = $el.text().trim();

    if (name) {
      actors.push({
        id: idMatch ? idMatch[1] : '',
        name,
        alt: href,
        category: '演员',
        role: '',
        avatars: { small: '', medium: '', large: '' },
      });
    }
  });

  // 尝试从 celebrities 区块获取头像 (增强版：双重匹配 + 高清替换)
  $('#celebrities .celebrity').each((_, element) => {
    const $item = $(element);
    const $link = $item
      .find('a.name, .info a[href*="/celebrity/"], a[href*="/celebrity/"]')
      .first();
    const $avatar = $item
      .find('.avatar, a.avatar, .avatar-wrapper, [style*="background-image"]')
      .first();

    const href =
      $link.attr('href') ||
      $item.find('a[href*="/celebrity/"]').first().attr('href') ||
      '';
    const idMatch = href.match(/celebrity\/(\d+)/);
    const celId = idMatch ? idMatch[1] : '';
    const name =
      $link.text().trim() ||
      $item.find('.info .name').text().trim() ||
      $item.find('.info a').first().text().trim() ||
      '';
    const role =
      $item.find('.role').text().trim() ||
      $item.find('.info .character').text().trim() ||
      $item.find('.info .meta').text().trim();

    // 双重匹配头像 URL
    let avatarUrl = '';

    // 方法 1: CSS 背景图
    const avatarStyle =
      $avatar.attr('style') ||
      $item.find('[style*="background-image"]').first().attr('style') ||
      '';
    const bgMatch = avatarStyle.match(/background-image:\s*url\(([^)]+)\)/);
    if (bgMatch) {
      avatarUrl = normalizeImageUrl(bgMatch[1]);
    }

    // 方法 2: IMG 标签 (fallback)
    if (!avatarUrl) {
      const $img = $avatar.find('img');
      avatarUrl =
        normalizeImageUrl($img.attr('src') || $img.attr('data-src')) || '';
    }

    // 方法 3: 直接从 a 标签下的 img
    if (!avatarUrl) {
      const $directImg = $item.find(
        'a img.avatar, a img[class*="avatar"], .avatar img',
      );
      avatarUrl =
        normalizeImageUrl(
          $directImg.attr('src') || $directImg.attr('data-src'),
        ) || '';
    }

    // 高清图替换: /s/ -> /l/, /m/ -> /l/
    avatarUrl = avatarUrl
      .replace(/\/s\//, '/l/')
      .replace(/\/m\//, '/l/')
      .replace('/s_ratio/', '/l_ratio/')
      .replace('/m_ratio/', '/l_ratio/')
      .replace('/small/', '/large/')
      .replace('/medium/', '/large/');

    // 不再过滤默认头像 - 即使是 personage-default 也保留
    if (name) {
      const existingDirector = directors.find(
        (c) => (celId && c.id === celId) || c.name === name,
      );
      const existingActor = actors.find(
        (c) => (celId && c.id === celId) || c.name === name,
      );
      const isDirector = role.includes('导演') || Boolean(existingDirector);
      const target = isDirector ? directors : actors;

      const existing =
        (isDirector ? existingDirector : existingActor) ||
        target.find((c) => c.id === celId || c.name === name);
      if (existing) {
        // 只有当新头像有效时才更新
        if (avatarUrl) {
          existing.avatars = {
            small: avatarUrl
              .replace('/l/', '/s/')
              .replace('/l_ratio/', '/s_ratio/'),
            medium: avatarUrl
              .replace('/l/', '/m/')
              .replace('/l_ratio/', '/m_ratio/'),
            large: avatarUrl,
          };
        }
        if (role) existing.role = role;
      } else {
        target.push({
          id: celId || `cel_${Date.now()}_${Math.random()}`,
          name,
          alt: href,
          category: isDirector ? '导演' : '演员',
          role,
          avatars: {
            small: avatarUrl
              ? avatarUrl
                  .replace('/l/', '/s/')
                  .replace('/l_ratio/', '/s_ratio/')
              : '',
            medium: avatarUrl
              ? avatarUrl
                  .replace('/l/', '/m/')
                  .replace('/l_ratio/', '/m_ratio/')
              : '',
            large: avatarUrl || '',
          },
        });
      }
    }
  });

  // ========== 使用 ld+json 补充缺失的导演/演员数据 ==========
  if (ldJsonData) {
    // 如果 HTML 解析没有获取到导演，尝试从 ld+json 获取
    // 尝试从 ld+json 补充或更新导演数据
    if (ldJsonData.director) {
      ldJsonData.director.forEach((d) => {
        if (d.name) {
          const idMatch = d.url?.match(/celebrity\/(\d+)/);
          const celId = idMatch ? idMatch[1] : '';

          // 查找已存在的导演
          const existing = directors.find(
            (item) => (celId && item.id === celId) || item.name === d.name,
          );

          if (existing) {
            // 如果已存在但没头像，尝试补充头像
            const hasAvatar =
              existing.avatars.small ||
              existing.avatars.medium ||
              existing.avatars.large;
            if (!hasAvatar && d.image) {
              const imgUrl =
                (typeof d.image === 'string'
                  ? d.image
                  : d.image?.contentUrl || '') || '';
              if (imgUrl) {
                console.log(`[Douban Scraper] 补充导演头像: ${d.name}`);
                existing.avatars = {
                  small: imgUrl,
                  medium: imgUrl,
                  large: imgUrl,
                };
              }
            }
          } else {
            // 如果不存在，添加新导演
            const imgUrl =
              (typeof d.image === 'string'
                ? d.image
                : d.image?.contentUrl || '') || '';
            directors.push({
              id: celId || `ld_${Date.now()}_${Math.random()}`,
              name: d.name,
              alt: d.url || '',
              category: '导演',
              role: '导演',
              avatars: { small: imgUrl, medium: imgUrl, large: imgUrl },
            });
          }
        }
      });
    }

    // 如果 HTML 解析没有获取到演员，尝试从 ld+json 获取
    // 尝试从 ld+json 补充或更新演员数据
    if (ldJsonData.actor) {
      ldJsonData.actor.forEach((a) => {
        if (a.name) {
          const idMatch = a.url?.match(/celebrity\/(\d+)/);
          const celId = idMatch ? idMatch[1] : '';

          // 查找已存在的演员
          const existing = actors.find(
            (item) => (celId && item.id === celId) || item.name === a.name,
          );

          if (existing) {
            // 如果已存在但没头像，尝试补充头像
            const hasAvatar =
              existing.avatars.small ||
              existing.avatars.medium ||
              existing.avatars.large;
            if (!hasAvatar && a.image) {
              const imgUrl =
                (typeof a.image === 'string'
                  ? a.image
                  : a.image?.contentUrl || '') || '';
              if (imgUrl) {
                console.log(`[Douban Scraper] 补充演员头像: ${a.name}`);
                existing.avatars = {
                  small: imgUrl,
                  medium: imgUrl,
                  large: imgUrl,
                };
              }
            }
          } else {
            // 如果不存在，添加新演员
            const imgUrl =
              (typeof a.image === 'string'
                ? a.image
                : a.image?.contentUrl || '') || '';
            actors.push({
              id: celId || `ld_${Date.now()}_${Math.random()}`,
              name: a.name,
              alt: a.url || '',
              category: '演员',
              role: '',
              avatars: { small: imgUrl, medium: imgUrl, large: imgUrl },
            });
          }
        }
      });
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`[Douban Scraper] 完成: ${subjectId} (${elapsed}ms)`);
  console.log(
    `[Douban Scraper] 解析结果: 标题="${title}", 导演=${directors.length}人, 演员=${actors.length}人, 短评=${hotComments.length}条, 推荐=${recommendations.length}部`,
  );

  // 转换为前端组件期望的格式
  // actors -> casts (添加 avatars 和 roles 字段)
  // directors 添加 roles 字段
  // hotComments 包含在返回中供评论接口使用
  const formattedDirectors = directors.map((d) => {
    // 强制应用图片代理
    const rawAvatars = d.avatars;
    const small = proxyImageUrl(
      rawAvatars?.small || rawAvatars?.medium || rawAvatars?.large,
    );
    const medium = proxyImageUrl(
      rawAvatars?.medium || rawAvatars?.large || rawAvatars?.small,
    );
    const large = proxyImageUrl(
      rawAvatars?.large || rawAvatars?.medium || rawAvatars?.small,
    );
    const hasAvatar = small || medium || large;

    return {
      id: d.id,
      name: d.name,
      alt: d.alt,
      avatars: hasAvatar
        ? {
            small: small || '',
            medium: medium || '',
            large: large || '',
          }
        : undefined,
      roles: [d.role || '导演'],
    };
  });

  const formattedCasts = actors.map((a) => {
    // 强制应用图片代理
    const rawAvatars = a.avatars;
    const small = proxyImageUrl(
      rawAvatars?.small || rawAvatars?.medium || rawAvatars?.large,
    );
    const medium = proxyImageUrl(
      rawAvatars?.medium || rawAvatars?.large || rawAvatars?.small,
    );
    const large = proxyImageUrl(
      rawAvatars?.large || rawAvatars?.medium || rawAvatars?.small,
    );
    const hasAvatar = small || medium || large;

    return {
      id: a.id,
      name: a.name,
      alt: a.alt,
      avatars: hasAvatar
        ? {
            small: small || '',
            medium: medium || '',
            large: large || '',
          }
        : undefined,
      roles: a.role ? [a.role] : ['演员'],
    };
  });

  return {
    id: subjectId,
    title,
    original_title: originalTitle,
    year,
    rating:
      ratingAvg > 0
        ? {
            max: 10,
            average: ratingAvg,
            stars: ratingStars,
            min: 0,
          }
        : null,
    ratings_count: ratingCount,
    genres,
    countries,
    durations,
    summary,
    images: {
      small: poster,
      medium: poster.replace('/s_ratio/', '/m_ratio/'),
      large: poster.replace('/s_ratio/', '/l_ratio/'),
    },
    // 前端组件期望的字段名
    directors: formattedDirectors,
    casts: formattedCasts,
    // 推荐影片
    recommendations,
    // 热门短评（供单独的评论接口使用）
    hotComments,
    scrapedAt: Date.now(),
  };
}

// ============================================================================
// 服务端缓存封装 (24小时)
// ============================================================================

/**
 * 使用 Next.js unstable_cache 包裹爬虫函数
 * - 第一次访问会触发爬虫
 * - 后续请求直接读取缓存
 * - 24小时后自动重新验证
 * - 出错时返回空数据而非抛出错误
 */
function buildEmptyScrapedData(subjectId: string): ScrapedFullData {
  return {
    id: subjectId,
    title: '',
    original_title: '',
    year: '',
    rating: null,
    ratings_count: 0,
    genres: [],
    countries: [],
    durations: [],
    summary: '',
    images: { small: '', medium: '', large: '' },
    directors: [],
    casts: [],
    recommendations: [],
    hotComments: [],
    scrapedAt: Date.now(),
  };
}

function hasCelebrityAvatar(
  data: Pick<ScrapedFullData, 'directors' | 'casts'>,
): boolean {
  return [...data.directors, ...data.casts].some((item) =>
    Boolean(item.avatars?.small || item.avatars?.medium || item.avatars?.large),
  );
}

function mergeScrapedData(
  primary: ScrapedFullData,
  fallback: ScrapedFullData | null,
): ScrapedFullData {
  if (!fallback) {
    return primary;
  }

  const hasImages =
    Boolean(primary.images.small) ||
    Boolean(primary.images.medium) ||
    Boolean(primary.images.large);

  return {
    ...primary,
    original_title: primary.original_title || fallback.original_title || '',
    year: primary.year || fallback.year || '',
    rating: primary.rating || fallback.rating,
    ratings_count: primary.ratings_count || fallback.ratings_count || 0,
    genres: primary.genres.length > 0 ? primary.genres : fallback.genres,
    countries:
      primary.countries.length > 0 ? primary.countries : fallback.countries,
    durations:
      primary.durations.length > 0 ? primary.durations : fallback.durations,
    summary: primary.summary || fallback.summary || '',
    images: hasImages ? primary.images : fallback.images,
    directors:
      primary.directors.length > 0 ? primary.directors : fallback.directors,
    casts: primary.casts.length > 0 ? primary.casts : fallback.casts,
    recommendations:
      primary.recommendations.length > 0
        ? primary.recommendations
        : fallback.recommendations,
    hotComments:
      primary.hotComments.length > 0
        ? primary.hotComments
        : fallback.hotComments,
    scrapedAt: Date.now(),
  };
}

type MobileApiHeaders = {
  'User-Agent': string;
  Referer: string;
};

type MobileApiPerson = {
  id?: string | number;
  name?: string;
  url?: string;
  avatar?: ApiCelebrityItem['avatar'];
  character?: string;
  simple_character?: string;
};

async function fetchDoubanDataFromSingleProxy(
  subjectId: string,
  proxyBase: string,
  headers: MobileApiHeaders,
): Promise<ScrapedFullData> {
  console.log('[Douban Scraper] Trying proxy: ' + proxyBase);

  const isUieee = proxyBase.includes('uieee.com');
  const detailUrl = isUieee
    ? proxyBase + '/v2/movie/subject/' + subjectId
    : proxyBase + '/movie/' + subjectId + '?apiKey=' + FRODO_API_KEY;
  const recommendsUrl = isUieee
    ? proxyBase + '/v2/movie/subject/' + subjectId + '/recommendations?count=12'
    : proxyBase +
      '/movie/' +
      subjectId +
      '/recommendations?start=0&count=12&apiKey=' +
      FRODO_API_KEY;
  const commentsUrl = isUieee
    ? proxyBase + '/v2/movie/subject/' + subjectId + '/comments?count=20'
    : proxyBase +
      '/movie/' +
      subjectId +
      '/interests?start=0&count=20&order_by=hot&apiKey=' +
      FRODO_API_KEY;
  const celebritiesUrl = isUieee
    ? proxyBase + '/v2/movie/subject/' + subjectId + '/celebrities'
    : proxyBase +
      '/movie/' +
      subjectId +
      '/celebrities?apiKey=' +
      FRODO_API_KEY;
  const creditsUrl = isUieee
    ? proxyBase + '/v2/movie/subject/' + subjectId + '/credits'
    : proxyBase + '/movie/' + subjectId + '/credits?apiKey=' + FRODO_API_KEY;

  const TIMEOUT_MS = 5500;

  const [detailRes, recommendsRes, commentsRes, celebritiesRes, creditsRes] =
    await Promise.allSettled([
      fetch(detailUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetch(recommendsUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetch(commentsUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetch(celebritiesUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
      fetch(creditsUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }),
    ]);

  if (detailRes.status === 'rejected') {
    throw new Error('Detail request failed: ' + String(detailRes.reason));
  }
  if (!detailRes.value.ok) {
    throw new Error('Detail request status: ' + detailRes.value.status);
  }

  const data = (await detailRes.value.json()) as Record<string, unknown>;

  let recommendations: ScrapedFullData['recommendations'] = [];
  if (recommendsRes.status === 'fulfilled' && recommendsRes.value.ok) {
    try {
      const recData = await recommendsRes.value.json();
      recommendations = (recData.items || recData.subjects || [])
        .slice(0, 12)
        .map(
          (item: {
            id?: string;
            title?: string;
            pic?: { normal?: string; large?: string };
          }) => ({
            id: String(item.id || ''),
            title: item.title || '',
            images: {
              small: item.pic?.normal || '',
              medium: item.pic?.large || item.pic?.normal || '',
              large: item.pic?.large || '',
            },
            alt:
              'https://movie.douban.com/subject/' + String(item.id || '') + '/',
          }),
        );
    } catch (e) {
      console.warn('[Douban Scraper] Failed to parse recommendations:', e);
    }
  }

  let hotComments: ScrapedFullData['hotComments'] = [];
  if (commentsRes.status === 'fulfilled' && commentsRes.value.ok) {
    try {
      const commentData = (await commentsRes.value.json()) as Record<
        string,
        unknown
      >;
      const sourceItems = (
        (commentData.interests as Array<Record<string, unknown>>) ||
        (commentData.comments as Array<Record<string, unknown>>) ||
        []
      ).slice(0, 20);

      hotComments = sourceItems.map((item) => {
        const user = ((item.user || item.author || {}) as {
          id?: string | number;
          name?: string;
          avatar?: string;
          uid?: string;
          alt?: string;
        }) || { name: 'Anonymous User' };
        const ratingPayload = (item.rating || null) as {
          value?: number;
          max?: number;
          min?: number;
        } | null;
        const ratingValue =
          typeof item.rating === 'number'
            ? Number(item.rating)
            : ratingPayload?.value || 0;

        return {
          id: String(
            item.id ||
              item.cid ||
              'comment_' + Date.now() + '_' + Math.random(),
          ),
          created_at: String(
            item.create_time || item.created_at || item.time || '',
          ),
          content: String(item.comment || item.content || ''),
          useful_count: Number(item.vote_count || item.useful_count || 0),
          rating: ratingValue
            ? {
                max: ratingPayload?.max || 10,
                value: ratingValue,
                min: ratingPayload?.min || 0,
              }
            : null,
          author: {
            id: String(user.id || ''),
            uid: user.uid || '',
            name: user.name || 'Anonymous User',
            avatar: user.avatar || '',
            alt:
              user.alt ||
              (user.id ? 'https://www.douban.com/people/' + user.id + '/' : ''),
          },
        };
      });
    } catch (e) {
      console.warn('[Douban Scraper] Failed to parse comments:', e);
    }
  }

  const mergedCelebrities: {
    directors: FormattedCelebrity[];
    casts: FormattedCelebrity[];
  } = { directors: [], casts: [] };

  const mergeCelebritiesFromPayload = (payload: unknown) => {
    const parsed = parseCelebritiesFromApiPayload(payload);
    parsed.directors.forEach((item) =>
      upsertFormattedCelebrity(mergedCelebrities.directors, item),
    );
    parsed.casts.forEach((item) =>
      upsertFormattedCelebrity(mergedCelebrities.casts, item),
    );
  };

  if (celebritiesRes.status === 'fulfilled' && celebritiesRes.value.ok) {
    try {
      mergeCelebritiesFromPayload(await celebritiesRes.value.json());
    } catch (e) {
      console.warn('[Douban Scraper] Failed to parse celebrities payload:', e);
    }
  }

  if (creditsRes.status === 'fulfilled' && creditsRes.value.ok) {
    try {
      mergeCelebritiesFromPayload(await creditsRes.value.json());
    } catch (e) {
      console.warn('[Douban Scraper] Failed to parse credits payload:', e);
    }
  }

  const fallbackDirectors = (
    (data.directors as MobileApiPerson[]) || []
  ).reduce<FormattedCelebrity[]>((acc, item) => {
    const formatted = toFormattedCelebrity(
      {
        ...item,
        url:
          item.url ||
          (item.id
            ? DOUBAN_WEB_BASE + '/celebrity/' + item.id + '/'
            : undefined),
      },
      '导演',
    );
    if (formatted) {
      upsertFormattedCelebrity(acc, formatted);
    }
    return acc;
  }, []);

  const fallbackCasts = ((data.actors as MobileApiPerson[]) || []).reduce<
    FormattedCelebrity[]
  >((acc, item) => {
    const formatted = toFormattedCelebrity(
      {
        ...item,
        url:
          item.url ||
          (item.id
            ? DOUBAN_WEB_BASE + '/celebrity/' + item.id + '/'
            : undefined),
      },
      '演员',
    );
    if (formatted) {
      upsertFormattedCelebrity(acc, formatted);
    }
    return acc;
  }, []);

  fallbackDirectors.forEach((item) =>
    upsertFormattedCelebrity(mergedCelebrities.directors, item),
  );
  fallbackCasts.forEach((item) =>
    upsertFormattedCelebrity(mergedCelebrities.casts, item),
  );

  const ratingPayload = (data.rating || null) as {
    value?: number;
    average?: number;
    count?: number;
  } | null;

  return {
    id: subjectId,
    title: (data.title as string) || '',
    original_title: (data.original_title as string) || '',
    year: (data.year as string) || '',
    rating: ratingPayload
      ? {
          max: 10,
          average: ratingPayload.value || ratingPayload.average || 0,
          stars: '',
          min: 0,
        }
      : null,
    ratings_count: ratingPayload?.count || (data.ratings_count as number) || 0,
    genres: (data.genres as string[]) || [],
    countries: (data.countries as string[]) || [],
    durations: (data.durations as string[]) || [],
    summary: (data.intro as string) || (data.summary as string) || '',
    images: {
      small: (data.pic as { normal?: string })?.normal || '',
      medium:
        (data.pic as { large?: string; normal?: string })?.large ||
        (data.pic as { normal?: string })?.normal ||
        '',
      large: (data.pic as { large?: string })?.large || '',
    },
    directors: mergedCelebrities.directors,
    casts: mergedCelebrities.casts,
    recommendations,
    hotComments,
    scrapedAt: Date.now(),
  };
}

async function fetchDoubanDataViaMobileApi(
  subjectId: string,
): Promise<ScrapedFullData> {
  const headers: MobileApiHeaders = {
    'User-Agent':
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.38(0x18002627) NetType/WIFI Language/zh_CN',
    Referer: 'https://servicewechat.com/wx2f9b06c1de1ccfca/114/page-frame.html',
  };

  const tasks = DOUBAN_PROXY_URLS.map((proxyBase) =>
    fetchDoubanDataFromSingleProxy(subjectId, proxyBase, headers).catch(
      (error) => {
        console.error('[Douban Scraper] Proxy failed: ' + proxyBase, error);
        throw error;
      },
    ),
  );

  return Promise.any(tasks);
}

async function getDoubanDataWithFallback(
  subjectId: string,
): Promise<ScrapedFullData> {
  let mobileData: ScrapedFullData | null = null;

  try {
    mobileData = await fetchDoubanDataViaMobileApi(subjectId);
    const hasBaseInfo = Boolean(mobileData.title);
    const hasCelebrities =
      mobileData.directors.length + mobileData.casts.length > 0;
    if (hasBaseInfo && hasCelebrities && hasCelebrityAvatar(mobileData)) {
      console.log('[Douban Scraper] Fast mobile API hit: ' + subjectId);
      return mobileData;
    }
    console.warn(
      '[Douban Scraper] Mobile API data incomplete, fallback to HTML scraper',
    );
  } catch (mobileError) {
    console.warn(
      '[Douban Scraper] Mobile API failed, fallback to HTML scraper:',
      mobileError,
    );
  }

  try {
    const scraped = await _scrapeDoubanData(subjectId);
    return mergeScrapedData(scraped, mobileData);
  } catch (scrapeError) {
    console.error('[Douban Scraper] HTML scraper failed:', scrapeError);
    if (mobileData && mobileData.title) {
      console.warn('[Douban Scraper] Return mobile API data as fallback');
      return mobileData;
    }

    console.warn(
      '[Douban Scraper] All fallback methods failed; returning empty data',
    );
    return buildEmptyScrapedData(subjectId);
  }
}

const scrapeDoubanData = unstable_cache(
  getDoubanDataWithFallback,
  ['douban-scraper'],
  {
    revalidate: 86400, // 24小时缓存
    tags: ['douban'],
  },
);

// ============================================================================
// 独立数据抓取 (带缓存)
// ============================================================================

const scrapeComments = unstable_cache(
  async (
    subjectId: string,
  ): Promise<{ comments: ScrapedComment[]; total: number }> => {
    const url = `${DOUBAN_WEB_BASE}/subject/${subjectId}/comments?status=P&sort=new_score`;

    const response = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`爬取短评失败: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const comments: ScrapedComment[] = [];

    $('.comment-item').each((_, element) => {
      const $item = $(element);

      const $avatar = $item.find('.avatar a img');
      const $userLink = $item.find('.comment-info a');
      const avatarUrl = $avatar.attr('src') || '';
      const userName = $userLink.text().trim();
      const userLink = $userLink.attr('href') || '';

      const ratingClass =
        $item.find('.comment-info .rating').attr('class') || '';
      const ratingMatch = ratingClass.match(/allstar(\d+)/);
      const ratingValue = ratingMatch ? parseInt(ratingMatch[1]) / 10 : 0;

      const content = $item.find('.short').text().trim();
      const time =
        $item.find('.comment-time').attr('title') ||
        $item.find('.comment-time').text().trim();
      const usefulCount =
        parseInt($item.find('.vote-count').text().trim()) || 0;
      const commentId =
        $item.attr('data-cid') || `scrape_${Date.now()}_${Math.random()}`;

      if (content) {
        comments.push({
          id: commentId,
          created_at: time,
          content,
          useful_count: usefulCount,
          rating:
            ratingValue > 0 ? { max: 5, value: ratingValue, min: 0 } : null,
          author: {
            id: userLink.split('/').filter(Boolean).pop() || '',
            uid: userName,
            name: userName,
            avatar: avatarUrl
              .replace('/u/pido/', '/u/')
              .replace('s_ratio', 'm_ratio'),
            alt: userLink,
          },
        });
      }
    });

    const totalText = $('.mod-hd h2 span').text();
    const totalMatch = totalText.match(/全部\s*(\d+)\s*条/);
    const total = totalMatch ? parseInt(totalMatch[1]) : comments.length;

    return { comments, total };
  },
  ['douban-comments'],
  { revalidate: 3600, tags: ['douban'] },
);

const scrapeRecommendations = unstable_cache(
  async (
    subjectId: string,
  ): Promise<{ recommendations: ScrapedRecommendation[] }> => {
    const data = await scrapeDoubanData(subjectId);
    return { recommendations: data.recommendations };
  },
  ['douban-recommendations'],
  { revalidate: 86400, tags: ['douban'] },
);

const scrapeCelebrities = unstable_cache(
  async (
    subjectId: string,
  ): Promise<{
    directors: FormattedCelebrity[];
    casts: FormattedCelebrity[];
  }> => {
    const data = await scrapeDoubanData(subjectId);
    return { directors: data.directors, casts: data.casts };
  },
  ['douban-celebrities'],
  { revalidate: 86400, tags: ['douban'] },
);

// ============================================================================
// 路由处理
// ============================================================================

function needsScraping(
  path: string,
): 'full' | 'comments' | 'recommendations' | 'celebrities' | null {
  const lowerPath = path.toLowerCase();
  if (lowerPath.includes('/comments') || lowerPath.includes('/reviews')) {
    return 'comments';
  }
  if (lowerPath.includes('/recommendations')) {
    return 'recommendations';
  }
  if (lowerPath.includes('/celebrities')) {
    return 'celebrities';
  }
  // 如果只是 subject/{id}，返回完整数据
  if (/movie\/subject\/\d+\/?$/.test(path)) {
    return 'full';
  }
  return null;
}

function extractSubjectId(path: string): string | null {
  const match = path.match(/subject\/(\d+)/);
  return match ? match[1] : null;
}

function selectApiKey(path: string): string {
  const lowerPath = path.toLowerCase();
  if (
    lowerPath.includes('/reviews') ||
    lowerPath.includes('/comments') ||
    lowerPath.includes('/photos')
  ) {
    return API_KEY_B;
  }
  return API_KEY_A;
}

/**
 * GET /api/douban/proxy
 * 豆瓣数据代理 (智能爬虫 + 24小时缓存)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const path = searchParams.get('path');
    const forceKeyType = searchParams.get('type');

    if (!path) {
      return NextResponse.json(
        { error: '缺少必要参数: path', code: 400 },
        { status: 400 },
      );
    }

    const scrapeType = needsScraping(path);
    const subjectId = extractSubjectId(path);

    // ========== 爬虫模式 ==========
    if (scrapeType && subjectId) {
      console.log(`[Douban Proxy] 爬虫模式: ${scrapeType} for ${subjectId}`);

      let data: unknown;

      switch (scrapeType) {
        case 'full': {
          const runtimeCached = getRuntimeSubjectCache(subjectId);
          let rawData = runtimeCached || (await scrapeDoubanData(subjectId));
          // 旧缓存里可能没有演员头像，命中时主动绕过缓存刷新一次
          if (!hasCelebrityAvatar(rawData)) {
            if (shouldRefreshSubject(subjectId)) {
              console.warn(
                `[Douban Proxy] 缓存数据缺少演职员头像，触发实时刷新: ${subjectId}`,
              );
              rawData = await getDoubanDataWithFallback(subjectId);
              setRuntimeSubjectCache(subjectId, rawData);
            } else {
              console.log(
                `[Douban Proxy] 缺头像数据刷新冷却中，直接使用热缓存: ${subjectId}`,
              );
            }
          } else {
            setRuntimeSubjectCache(subjectId, rawData);
          }

          // 应用图片代理转换，解决防盗链问题
          data = proxyAllImages(rawData);
          // 添加调试信息
          console.log(
            `[Douban Proxy] 获取数据: directors=${rawData.directors.length}, casts=${rawData.casts.length}, comments=${rawData.hotComments.length}, recommendations=${rawData.recommendations.length}`,
          );
          break;
        }
        case 'comments':
          data = await scrapeComments(subjectId);
          break;
        case 'recommendations':
          data = await scrapeRecommendations(subjectId);
          break;
        case 'celebrities':
          data = await scrapeCelebrities(subjectId);
          break;
      }

      return NextResponse.json(data, {
        headers: {
          'Cache-Control':
            'public, max-age=3600, s-maxage=86400, stale-while-revalidate=43200',
          'X-Data-Source': 'scraper-cached',
        },
      });
    }

    // ========== API 模式 (搜索等) ==========
    const apiKey =
      forceKeyType === 'primary'
        ? API_KEY_A
        : forceKeyType === 'secondary'
          ? API_KEY_B
          : selectApiKey(path);

    const queryParams = new URLSearchParams();
    searchParams.forEach((value, key) => {
      if (key !== 'path' && key !== 'type') {
        queryParams.append(key, value);
      }
    });
    queryParams.append('apikey', apiKey);

    const targetUrl = `${DOUBAN_API_BASE}/${path}?${queryParams.toString()}`;

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': BROWSER_HEADERS['User-Agent'],
        Referer: BROWSER_HEADERS.Referer,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[Douban Proxy] API Error:', response.status, errorText);
      return NextResponse.json(
        {
          error: '豆瓣 API 请求失败',
          status: response.status,
          details: errorText,
        },
        { status: response.status },
      );
    }

    const data = await response.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        'X-Data-Source': 'api',
      },
    });
  } catch (error) {
    console.error('[Douban Proxy] Error:', error);

    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { error: '请求超时', code: 504 },
        { status: 504 },
      );
    }

    return NextResponse.json(
      {
        error: '代理请求失败',
        details: error instanceof Error ? error.message : '未知错误',
      },
      { status: 500 },
    );
  }
}
