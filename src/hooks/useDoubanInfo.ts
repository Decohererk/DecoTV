/* eslint-disable no-console */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { generateCacheKey, globalCache } from '@/lib/unified-cache';

// ============================================================================
// Types
// ============================================================================

/** 演员/导演信息 */
export interface DoubanCelebrity {
  id: string;
  name: string;
  alt?: string;
  avatars?: {
    small: string;
    medium: string;
    large: string;
  };
  roles?: string[];
}

/** 电影详情 */
export interface DoubanMovieDetail {
  id: string;
  title: string;
  original_title?: string;
  alt?: string;
  rating?: {
    max: number;
    average: number;
    stars: string;
    min: number;
  };
  ratings_count?: number;
  wish_count?: number;
  collect_count?: number;
  images?: {
    small: string;
    medium: string;
    large: string;
  };
  subtype?: string;
  directors?: DoubanCelebrity[];
  casts?: DoubanCelebrity[];
  writers?: DoubanCelebrity[];
  pubdates?: string[];
  year?: string;
  genres?: string[];
  countries?: string[];
  mainland_pubdate?: string;
  aka?: string[];
  summary?: string;
  tags?: Array<{ name: string; count: number }>;
  durations?: string[];
  seasons_count?: number;
  episodes_count?: number;
}

/** 用户评论 */
export interface DoubanComment {
  id: string;
  created_at: string;
  content: string;
  useful_count: number;
  rating?: {
    max: number;
    value: number;
    min: number;
  } | null;
  author: {
    id: string;
    uid: string;
    name: string;
    avatar: string;
    alt?: string;
  };
}

/** 评论列表响应 */
export interface DoubanCommentsResponse {
  start: number;
  count: number;
  total: number;
  comments: DoubanComment[];
}

/** 推荐影片 */
export interface DoubanRecommend {
  id: string;
  title: string;
  poster?: string;
  rate?: string;
  year?: string;
}

/** Hook 返回类型 */
export interface UseDoubanInfoResult {
  detail: DoubanMovieDetail | null;
  detailLoading: boolean;
  detailError: Error | null;

  comments: DoubanComment[];
  commentsLoading: boolean;
  commentsError: Error | null;
  commentsTotal: number;

  recommends: DoubanRecommend[];
  recommendsLoading: boolean;
  recommendsError: Error | null;

  refreshDetail: () => Promise<void>;
  refreshComments: () => Promise<void>;
  refreshRecommends: () => Promise<void>;
}

type DoubanDetailProxyResponse = DoubanMovieDetail & {
  hotComments?: DoubanComment[];
  recommendations?: Array<{
    id: string;
    title: string;
    images?: { small?: string; medium?: string; large?: string };
    alt?: string;
  }>;
};

const DOUBAN_PROXY_CACHE_TTL_SECONDS = 3600;
const inFlightProxyRequests = new Map<string, Promise<unknown>>();

function getProxyCacheKey(path: string): string {
  return generateCacheKey('douban-proxy-detail', { path });
}

function readProxyCache<T>(path: string): T | null {
  return globalCache.get<T>(getProxyCacheKey(path));
}

function writeProxyCache(path: string, data: unknown): void {
  globalCache.set(getProxyCacheKey(path), data, DOUBAN_PROXY_CACHE_TTL_SECONDS);
}

/**
 * 通过后端代理获取豆瓣数据
 * 后端代理位于 /api/douban/proxy，可绕过 CORS 限制
 */
async function fetchFromBackendProxy(
  path: string,
  timeout = 30000,
  bypassCache = false,
): Promise<unknown> {
  const cacheKey = getProxyCacheKey(path);
  if (!bypassCache) {
    const cachedData = readProxyCache<unknown>(path);
    if (cachedData !== null) {
      console.log('[useDoubanInfo] 命中本地缓存:', path);
      return cachedData;
    }

    const existingRequest = inFlightProxyRequests.get(cacheKey);
    if (existingRequest) {
      console.log('[useDoubanInfo] 复用进行中的请求:', path);
      return await existingRequest;
    }
  }

  const requestPromise = (async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
      const url = `/api/douban/proxy?path=${encodeURIComponent(path)}`;
      console.log('[useDoubanInfo] 请求后端代理:', url);

      const response = await fetch(url, {
        signal: controller.signal,
        cache: bypassCache ? 'no-store' : 'force-cache',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          '[useDoubanInfo] 后端代理错误:',
          response.status,
          errorText,
        );
        throw new Error(`请求失败: ${response.status}`);
      }

      const data = await response.json();
      writeProxyCache(path, data);
      console.log('[useDoubanInfo] 后端代理响应成功');
      return data;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  if (bypassCache) {
    return await requestPromise;
  }

  inFlightProxyRequests.set(cacheKey, requestPromise);
  try {
    return await requestPromise;
  } finally {
    inFlightProxyRequests.delete(cacheKey);
  }
}

// ============================================================================
// Hook
// ============================================================================

/**
 * 豆瓣信息 Hook
 *
 * @param doubanId - 豆瓣电影 ID
 * @param options - 配置选项
 */
export function useDoubanInfo(
  doubanId: string | number | null | undefined,
  options: {
    fetchDetail?: boolean;
    fetchComments?: boolean;
    fetchRecommends?: boolean;
    commentsCount?: number;
  } = {},
): UseDoubanInfoResult {
  const {
    fetchDetail: shouldFetchDetail = true,
    fetchComments: shouldFetchComments = true,
    fetchRecommends: shouldFetchRecommends = true,
  } = options;

  const [detail, setDetail] = useState<DoubanMovieDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<Error | null>(null);

  const [comments, setComments] = useState<DoubanComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsError, setCommentsError] = useState<Error | null>(null);
  const [commentsTotal, setCommentsTotal] = useState(0);

  const [recommends, setRecommends] = useState<DoubanRecommend[]>([]);
  const [recommendsLoading, setRecommendsLoading] = useState(false);
  const [recommendsError, setRecommendsError] = useState<Error | null>(null);

  const detailRequestIdRef = useRef(0);

  const applyDetailPayload = useCallback((data: DoubanDetailProxyResponse) => {
    setDetail(data);

    const nextComments = data.hotComments || [];
    setComments(nextComments);
    setCommentsTotal(nextComments.length);

    const transformedRecommends = (data.recommendations || []).map((r) => ({
      id: r.id,
      title: r.title,
      poster: r.images?.large || r.images?.medium || r.images?.small || '',
      rate: '',
    }));
    setRecommends(transformedRecommends);
  }, []);

  const refreshDetail = useCallback(async () => {
    if (!doubanId) return;

    const requestId = ++detailRequestIdRef.current;
    const detailPath = `movie/subject/${doubanId}`;

    const cachedData = readProxyCache<DoubanDetailProxyResponse>(detailPath);
    if (cachedData && cachedData.title) {
      applyDetailPayload(cachedData);
      setDetailError(null);
      setDetailLoading(false);
      setCommentsLoading(false);
      setRecommendsLoading(false);
      return;
    }

    setDetail(null);
    setComments([]);
    setCommentsTotal(0);
    setRecommends([]);
    setDetailLoading(true);
    setCommentsLoading(true);
    setRecommendsLoading(true);
    setDetailError(null);

    try {
      console.log('[useDoubanInfo] 获取详情:', doubanId);
      const data = (await fetchFromBackendProxy(
        detailPath,
      )) as DoubanDetailProxyResponse;

      if (requestId !== detailRequestIdRef.current) return;
      if (data && data.title) {
        applyDetailPayload(data);
        console.log('[useDoubanInfo] 详情获取成功:', data.title);
      } else {
        throw new Error('无法获取豆瓣数据');
      }
    } catch (error) {
      if (requestId !== detailRequestIdRef.current) return;
      console.error('[useDoubanInfo] 详情获取失败:', error);
      setDetailError(error instanceof Error ? error : new Error('未知错误'));
    } finally {
      if (requestId === detailRequestIdRef.current) {
        setDetailLoading(false);
        setCommentsLoading(false);
        setRecommendsLoading(false);
      }
    }
  }, [applyDetailPayload, doubanId]);

  const refreshComments = useCallback(async () => {
    if (!doubanId) return;
    if (comments.length > 0) return;

    setCommentsLoading(true);
    setCommentsError(null);

    try {
      console.log('[useDoubanInfo] 获取评论:', doubanId);
      const data = (await fetchFromBackendProxy(
        `movie/subject/${doubanId}/comments`,
      )) as { comments?: DoubanComment[]; total?: number };

      if (data && data.comments) {
        setComments(data.comments);
        setCommentsTotal(data.total || data.comments.length);
        console.log('[useDoubanInfo] 评论获取成功:', data.comments.length);
      }
    } catch (error) {
      console.error('[useDoubanInfo] 评论获取失败:', error);
      setCommentsError(error instanceof Error ? error : new Error('未知错误'));
    } finally {
      setCommentsLoading(false);
    }
  }, [comments.length, doubanId]);

  const refreshRecommends = useCallback(async () => {
    if (!doubanId) return;
    if (recommends.length > 0) return;

    setRecommendsLoading(true);
    setRecommendsError(null);

    try {
      console.log('[useDoubanInfo] 获取推荐:', doubanId);
      const data = (await fetchFromBackendProxy(
        `movie/subject/${doubanId}/recommendations`,
      )) as {
        recommendations?: Array<{
          id: string;
          title: string;
          images?: { large?: string };
        }>;
      };

      if (data && data.recommendations) {
        const transformedRecommends = data.recommendations.map((r) => ({
          id: r.id,
          title: r.title,
          poster: r.images?.large || '',
          rate: '',
        }));
        setRecommends(transformedRecommends);
        console.log(
          '[useDoubanInfo] 推荐获取成功:',
          transformedRecommends.length,
        );
      }
    } catch (error) {
      console.error('[useDoubanInfo] 推荐获取失败:', error);
      setRecommendsError(
        error instanceof Error ? error : new Error('未知错误'),
      );
    } finally {
      setRecommendsLoading(false);
    }
  }, [doubanId, recommends.length]);

  useEffect(() => {
    if (!doubanId) {
      setDetail(null);
      setComments([]);
      setCommentsTotal(0);
      setRecommends([]);
      return;
    }

    if (shouldFetchDetail) {
      refreshDetail();
      return;
    }

    if (shouldFetchComments) {
      refreshComments();
    }
    if (shouldFetchRecommends) {
      refreshRecommends();
    }
  }, [
    doubanId,
    refreshComments,
    refreshDetail,
    refreshRecommends,
    shouldFetchComments,
    shouldFetchDetail,
    shouldFetchRecommends,
  ]);

  return {
    detail,
    detailLoading,
    detailError,
    comments,
    commentsLoading,
    commentsError,
    commentsTotal,
    recommends,
    recommendsLoading,
    recommendsError,
    refreshDetail,
    refreshComments,
    refreshRecommends,
  };
}

export default useDoubanInfo;
