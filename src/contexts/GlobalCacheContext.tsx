/* eslint-disable no-console */
'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';
import { globalCache } from '@/lib/unified-cache';

// ============ 类型定义 ============

interface HomePageData {
  hotMovies: DoubanItem[];
  hotTvShows: DoubanItem[];
  hotVarietyShows: DoubanItem[];
  bangumiCalendar: BangumiCalendarData[];
}

interface CacheState {
  // 首页数据
  homeData: HomePageData | null;
  homeLoading: boolean;
  homeError: string | null;
  homeLastFetch: number;

  // 豆瓣页面数据（按类型分组）
  doubanData: Map<string, DoubanItem[]>;
  doubanLoading: Map<string, boolean>;
}

interface GlobalCacheContextValue extends CacheState {
  // 首页相关方法
  fetchHomeData: (forceRefresh?: boolean) => Promise<void>;

  // 豆瓣页面相关方法
  getDoubanData: (cacheKey: string) => DoubanItem[] | null;
  setDoubanData: (cacheKey: string, data: DoubanItem[]) => void;
  isDoubanLoading: (cacheKey: string) => boolean;
  setDoubanLoading: (cacheKey: string, loading: boolean) => void;

  // 通用方法
  clearAllCache: () => void;
  prefetchData: (keys: string[]) => Promise<void>;
}

// ============ 常量 ============

const STALE_TIME = 5 * 60 * 1000; // 5分钟视为过期，触发后台更新
const CACHE_TIME = 30 * 60 * 1000; // 30分钟缓存有效期

// ============ Context 创建 ============

const GlobalCacheContext = createContext<GlobalCacheContextValue | null>(null);

// ============ Provider 实现 ============

export function GlobalCacheProvider({ children }: { children: ReactNode }) {
  // === 首页数据状态 ===
  const [homeData, setHomeData] = useState<HomePageData | null>(null);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [homeLastFetch, setHomeLastFetch] = useState(0);

  // === 豆瓣页面数据状态（使用 Map 按 cacheKey 分组） ===
  const [doubanData, setDoubanDataState] = useState<Map<string, DoubanItem[]>>(
    new Map(),
  );
  const [doubanLoading, setDoubanLoadingState] = useState<Map<string, boolean>>(
    new Map(),
  );

  // === 防止并发请求的锁 ===
  const fetchingRef = useRef<Set<string>>(new Set());

  // === 初始化时从 localStorage 恢复缓存 ===
  useEffect(() => {
    const cachedHomeData = globalCache.get<HomePageData>('home-page-data');
    if (cachedHomeData) {
      setHomeData(cachedHomeData);
      setHomeLastFetch(Date.now() - STALE_TIME + 1000); // 标记为需要后台更新
    }
  }, []);

  // === 首页数据获取（Stale-While-Revalidate 策略） ===
  const fetchHomeData = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = 'home-page-data';

      // 防止重复请求
      if (fetchingRef.current.has(cacheKey)) {
        return;
      }

      // 检查是否需要刷新
      const now = Date.now();
      const isStale = now - homeLastFetch > STALE_TIME;

      if (!forceRefresh && homeData && !isStale) {
        return; // 数据新鲜，无需刷新
      }

      // 如果有缓存数据且非强制刷新，先返回缓存（SWR 策略）
      if (homeData && !forceRefresh) {
        // 数据过期，后台静默更新
        fetchingRef.current.add(cacheKey);

        try {
          const freshData = await fetchHomeDataFromAPI(homeData);
          setHomeData(freshData);
          setHomeLastFetch(Date.now());
          globalCache.set(cacheKey, freshData, CACHE_TIME / 1000);
        } catch (error) {
          console.error('[GlobalCache] 后台更新首页数据失败:', error);
        } finally {
          fetchingRef.current.delete(cacheKey);
        }
        return;
      }

      // 无缓存或强制刷新，显示 loading
      fetchingRef.current.add(cacheKey);
      setHomeLoading(true);
      setHomeError(null);

      try {
        const freshData = await fetchHomeDataFromAPI(homeData || undefined);
        // 使用 flushSync 强制同步更新，避免批处理延迟
        flushSync(() => {
          setHomeData(freshData);
          setHomeLastFetch(Date.now());
        });
        globalCache.set(cacheKey, freshData, CACHE_TIME / 1000);
      } catch (error) {
        setHomeError(error instanceof Error ? error.message : '加载失败');
      } finally {
        setHomeLoading(false);
        fetchingRef.current.delete(cacheKey);
      }
    },
    [homeData, homeLastFetch],
  );

  // === 豆瓣数据操作方法 ===
  const getDoubanData = useCallback(
    (cacheKey: string): DoubanItem[] | null => {
      // 优先从内存状态读取
      if (doubanData.has(cacheKey)) {
        return doubanData.get(cacheKey) || null;
      }
      // 回退到 globalCache
      return globalCache.get<DoubanItem[]>(cacheKey);
    },
    [doubanData],
  );

  const setDoubanData = useCallback((cacheKey: string, data: DoubanItem[]) => {
    setDoubanDataState((prev) => {
      const next = new Map(prev);
      next.set(cacheKey, data);
      return next;
    });
    // 同步写入 globalCache
    globalCache.set(cacheKey, data, CACHE_TIME / 1000);
  }, []);

  const isDoubanLoading = useCallback(
    (cacheKey: string): boolean => {
      return doubanLoading.get(cacheKey) || false;
    },
    [doubanLoading],
  );

  const setDoubanLoading = useCallback((cacheKey: string, loading: boolean) => {
    setDoubanLoadingState((prev) => {
      const next = new Map(prev);
      next.set(cacheKey, loading);
      return next;
    });
  }, []);

  useEffect(() => {
    const handleDoubanProxyChanged = () => {
      setHomeLastFetch(0);
      setDoubanDataState(new Map());
      setDoubanLoadingState(new Map());
      globalCache.delete('home-page-data');
      globalCache.deleteByPrefix('douban-');
    };

    window.addEventListener('doubanProxyChanged', handleDoubanProxyChanged);
    return () => {
      window.removeEventListener(
        'doubanProxyChanged',
        handleDoubanProxyChanged,
      );
    };
  }, []);

  // === 清除所有缓存 ===
  const clearAllCache = useCallback(() => {
    setHomeData(null);
    setHomeLastFetch(0);
    setDoubanDataState(new Map());
    globalCache.clear();
  }, []);

  // === 预取数据（用于导航预加载） ===
  const prefetchData = useCallback(
    async (keys: string[]) => {
      // 预取逻辑可扩展
      if (keys.includes('home') && !homeData) {
        fetchHomeData();
      }
    },
    [homeData, fetchHomeData],
  );

  // === Context Value ===
  const value = useMemo<GlobalCacheContextValue>(
    () => ({
      homeData,
      homeLoading,
      homeError,
      homeLastFetch,
      doubanData,
      doubanLoading,
      fetchHomeData,
      getDoubanData,
      setDoubanData,
      isDoubanLoading,
      setDoubanLoading,
      clearAllCache,
      prefetchData,
    }),
    [
      homeData,
      homeLoading,
      homeError,
      homeLastFetch,
      doubanData,
      doubanLoading,
      fetchHomeData,
      getDoubanData,
      setDoubanData,
      isDoubanLoading,
      setDoubanLoading,
      clearAllCache,
      prefetchData,
    ],
  );

  return (
    <GlobalCacheContext.Provider value={value}>
      {children}
    </GlobalCacheContext.Provider>
  );
}

// ============ Hook ============

export function useGlobalCache() {
  const context = useContext(GlobalCacheContext);
  if (!context) {
    throw new Error('useGlobalCache must be used within GlobalCacheProvider');
  }
  return context;
}

// ============ 辅助函数：并行获取首页数据 ============

async function fetchHomeDataFromAPI(
  previousData?: HomePageData | null,
): Promise<HomePageData> {
  // 使用 Promise.allSettled 并行加载，任一失败不影响其他
  const results = await Promise.allSettled([
    getDoubanCategories({ kind: 'movie', category: '热门', type: '全部' }),
    getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
    getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
    GetBangumiCalendarData(),
  ]);

  const [moviesResult, tvResult, varietyResult, bangumiResult] = results;
  const doubanFailures = [moviesResult, tvResult, varietyResult].filter(
    (result) => result.status === 'rejected',
  );

  if (doubanFailures.length > 0 && typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('globalError', {
        detail: { message: '部分豆瓣首页数据加载失败，已保留可用缓存' },
      }),
    );
  }

  return {
    hotMovies:
      moviesResult.status === 'fulfilled' && moviesResult.value.code === 200
        ? moviesResult.value.list
        : previousData?.hotMovies || [],
    hotTvShows:
      tvResult.status === 'fulfilled' && tvResult.value.code === 200
        ? tvResult.value.list
        : previousData?.hotTvShows || [],
    hotVarietyShows:
      varietyResult.status === 'fulfilled' && varietyResult.value.code === 200
        ? varietyResult.value.list
        : previousData?.hotVarietyShows || [],
    bangumiCalendar:
      bangumiResult.status === 'fulfilled'
        ? bangumiResult.value
        : previousData?.bangumiCalendar || [],
  };
}
