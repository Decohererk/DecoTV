'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface BrowseVideoItem {
  vod_id?: string | number;
  vod_name?: string;
  vod_pic?: string;
  vod_year?: string;
  vod_remarks?: string;
  vod_douban_id?: string | number;
  douban_id?: string | number;
}

interface SourceVideoListResponse {
  list?: BrowseVideoItem[];
  page?: number | string;
  pagecount?: number | string;
  total?: number | string;
  limit?: number | string;
  page_size?: number | string;
}

interface UseBrowseVideosOptions {
  sourceKey?: string;
  sourceApi?: string | null;
  categoryId?: string | null;
  enabled?: boolean;
  defaultPageSize?: number;
}

interface UseBrowseVideosResult {
  videos: BrowseVideoItem[];
  page: number;
  hasMore: boolean;
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string;
  loadMore: () => void;
  reload: () => void;
}

const ALL_CATEGORY_ALIASES = new Set([
  '',
  '*',
  'all',
  '0',
  '-1',
  '全部',
  '不限',
  '全部分类',
]);

function normalizeCategoryId(categoryId?: string | null): string {
  if (categoryId == null) return '';

  const raw = String(categoryId).trim();
  if (!raw) return '';

  const lower = raw.toLowerCase();
  if (ALL_CATEGORY_ALIASES.has(raw) || ALL_CATEGORY_ALIASES.has(lower)) {
    return '';
  }

  return raw;
}

function buildCategoryApiUrl(
  api: string,
  categoryId: string,
  page: number,
): string {
  const params = new URLSearchParams({
    ac: 'videolist',
    pg: String(page),
  });
  if (categoryId) {
    params.set('t', categoryId);
  }

  if (api.endsWith('/')) {
    return `${api}?${params.toString()}`;
  }
  return `${api}/?${params.toString()}`;
}

function parseNonNegativeInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return null;
}

function parsePositiveInteger(value: unknown): number | null {
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

function inferHasMore(
  payload: SourceVideoListResponse,
  requestedPage: number,
  fetchedCount: number,
  currentVideoCount: number,
  defaultPageSize: number,
): boolean {
  const total = parseNonNegativeInteger(payload.total);
  if (total !== null) {
    return currentVideoCount < total;
  }

  const pageCount = parsePositiveInteger(payload.pagecount);
  if (pageCount !== null) {
    const responsePage = parsePositiveInteger(payload.page) ?? requestedPage;
    return responsePage < pageCount;
  }

  const pageSize =
    parsePositiveInteger(payload.limit) ??
    parsePositiveInteger(payload.page_size) ??
    defaultPageSize;

  return fetchedCount >= pageSize;
}

function mergeUniqueItems(
  previous: BrowseVideoItem[],
  incoming: BrowseVideoItem[],
): BrowseVideoItem[] {
  const map = new Map<string, BrowseVideoItem>();
  [...previous, ...incoming].forEach((item, index) => {
    const key = String(item.vod_id || item.vod_name || `item-${index}`);
    map.set(key, item);
  });
  return Array.from(map.values());
}

export default function useBrowseVideos({
  sourceKey,
  sourceApi,
  categoryId,
  enabled = true,
  defaultPageSize = 20,
}: UseBrowseVideosOptions): UseBrowseVideosResult {
  const [videos, setVideos] = useState<BrowseVideoItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const videosRef = useRef<BrowseVideoItem[]>([]);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(true);
  const isLoadingRef = useRef(false);
  const isLoadingMoreRef = useRef(false);

  const requestControllerRef = useRef<AbortController | null>(null);
  const requestSequenceRef = useRef(0);
  const loadMoreLockRef = useRef(false);
  const latestQueryKeyRef = useRef('');

  const normalizedCategoryId = useMemo(
    () => normalizeCategoryId(categoryId),
    [categoryId],
  );

  const queryKey = useMemo(
    () => `${sourceKey || 'auto'}::${normalizedCategoryId || '__all__'}`,
    [normalizedCategoryId, sourceKey],
  );

  const resetState = useCallback(() => {
    videosRef.current = [];
    pageRef.current = 1;
    hasMoreRef.current = true;
    isLoadingRef.current = false;
    isLoadingMoreRef.current = false;
    loadMoreLockRef.current = false;

    setVideos([]);
    setPage(1);
    setHasMore(true);
    setIsLoading(false);
    setIsLoadingMore(false);
    setError('');
  }, []);

  const fetchPage = useCallback(
    async (targetPage: number) => {
      if (!enabled || sourceKey === 'auto' || !sourceApi || !queryKey) {
        return;
      }

      const isLoadMore = targetPage > 1;
      const requestSequence = ++requestSequenceRef.current;

      requestControllerRef.current?.abort();
      const controller = new AbortController();
      requestControllerRef.current = controller;

      if (isLoadMore) {
        loadMoreLockRef.current = true;
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
      } else {
        isLoadingRef.current = true;
        setIsLoading(true);
      }
      setError('');

      try {
        const originalApiUrl = buildCategoryApiUrl(
          sourceApi,
          normalizedCategoryId,
          targetPage,
        );
        const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
        const response = await fetch(proxyUrl, {
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`分类内容拉取失败 (${response.status})`);
        }

        const payload = (await response.json()) as SourceVideoListResponse;
        const nextItems = Array.isArray(payload.list) ? payload.list : [];
        const mergedVideos = isLoadMore
          ? mergeUniqueItems(videosRef.current, nextItems)
          : nextItems;
        const nextHasMore = inferHasMore(
          payload,
          targetPage,
          nextItems.length,
          mergedVideos.length,
          defaultPageSize,
        );

        if (
          controller.signal.aborted ||
          requestSequence !== requestSequenceRef.current ||
          latestQueryKeyRef.current !== queryKey
        ) {
          return;
        }

        videosRef.current = mergedVideos;
        pageRef.current = targetPage;
        hasMoreRef.current = nextHasMore;

        setVideos(mergedVideos);
        setPage(targetPage);
        setHasMore(nextHasMore);
      } catch (err) {
        if (controller.signal.aborted) {
          return;
        }

        if (!isLoadMore) {
          videosRef.current = [];
          hasMoreRef.current = false;
          setVideos([]);
          setHasMore(false);
        }

        setError(
          err instanceof Error ? err.message : '分类内容拉取失败，请稍后重试',
        );
      } finally {
        if (requestControllerRef.current === controller) {
          requestControllerRef.current = null;
        }
        if (isLoadMore) {
          loadMoreLockRef.current = false;
          isLoadingMoreRef.current = false;
          setIsLoadingMore(false);
        } else {
          isLoadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [
      defaultPageSize,
      enabled,
      normalizedCategoryId,
      queryKey,
      sourceApi,
      sourceKey,
    ],
  );

  const loadMore = useCallback(() => {
    if (!enabled || sourceKey === 'auto' || !sourceApi) {
      return;
    }
    if (
      isLoadingRef.current ||
      isLoadingMoreRef.current ||
      !hasMoreRef.current ||
      loadMoreLockRef.current
    ) {
      return;
    }
    void fetchPage(pageRef.current + 1);
  }, [enabled, fetchPage, sourceApi, sourceKey]);

  const reload = useCallback(() => {
    if (!enabled || sourceKey === 'auto' || !sourceApi) {
      return;
    }
    void fetchPage(1);
  }, [enabled, fetchPage, sourceApi, sourceKey]);

  useEffect(() => {
    latestQueryKeyRef.current = queryKey;
    requestControllerRef.current?.abort();
    requestSequenceRef.current += 1;

    resetState();

    if (!enabled || sourceKey === 'auto' || !sourceApi) {
      hasMoreRef.current = false;
      setHasMore(false);
      return;
    }

    void fetchPage(1);

    return () => {
      requestControllerRef.current?.abort();
    };
  }, [enabled, fetchPage, queryKey, resetState, sourceApi, sourceKey]);

  useEffect(() => {
    return () => {
      requestControllerRef.current?.abort();
    };
  }, []);

  return {
    videos,
    page,
    hasMore,
    isLoading,
    isLoadingMore,
    error,
    loadMore,
    reload,
  };
}
