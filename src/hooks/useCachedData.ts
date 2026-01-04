/**
 * useCachedData - 带缓存的数据获取 Hook
 *
 * 核心功能：
 * 1. 缓存优先：先从 globalCache 读取，未命中再发起 API 请求
 * 2. 防抖机制：快速切换 Tab 时，只发起最后一次请求（100ms 防抖）
 * 3. 参数快照：确保返回的数据与当前参数匹配，防止"竞态问题"
 * 4. 自动缓存：请求成功后自动写入缓存，下次访问瞬间返回
 *
 * 使用场景：
 * - 豆瓣分类页面：切换电影/剧集/动漫时，数据从缓存瞬间加载
 * - 搜索结果：相同关键词的搜索结果直接从缓存返回
 *
 * @example
 * ```tsx
 * const { data, loading, error, refresh } = useCachedData({
 *   cacheKey: `douban-${type}-${category}`,
 *   fetchFn: async () => await getDoubanCategories({ kind: type, category }),
 *   dependencies: [type, category],
 *   ttl: 7200,
 * });
 * ```
 */

/* eslint-disable no-console */

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { generateCacheKey, globalCache } from '@/lib/unified-cache';

// ============ 类型定义 ============

/**
 * Hook 配置选项
 */
export interface UseCachedDataOptions<T, D extends unknown[]> {
  /**
   * 缓存键（唯一标识）
   * 推荐使用 generateCacheKey() 生成
   */
  cacheKey: string;

  /**
   * 数据获取函数
   * 仅在缓存未命中时调用
   */
  fetchFn: () => Promise<T>;

  /**
   * 依赖项数组
   * 任何依赖项变化都会触发重新获取（带防抖）
   */
  dependencies: D;

  /**
   * 缓存有效期（秒）
   * 默认 7200 (2 小时)
   */
  ttl?: number;

  /**
   * 防抖延迟（毫秒）
   * 默认 100ms，防止快速切换时发起多次请求
   */
  debounceMs?: number;

  /**
   * 依赖变化时是否清空当前数据
   * 默认 true（显示 loading 状态）
   */
  clearOnChange?: boolean;

  /**
   * 是否启用缓存
   * 默认 true
   */
  enableCache?: boolean;

  /**
   * 是否在挂载时立即获取数据
   * 默认 true
   */
  fetchOnMount?: boolean;
}

/**
 * Hook 返回值
 */
export interface UseCachedDataResult<T> {
  /** 获取到的数据 */
  data: T | null;

  /** 是否正在加载 */
  loading: boolean;

  /** 错误信息 */
  error: string | null;

  /** 数据是否来自缓存 */
  fromCache: boolean;

  /** 手动刷新（忽略缓存，强制重新获取） */
  refresh: () => Promise<void>;

  /** 手动清除当前缓存 */
  clearCache: () => void;
}

// ============ Hook 实现 ============

/**
 * 带缓存的数据获取 Hook
 */
export function useCachedData<T, D extends unknown[]>(
  options: UseCachedDataOptions<T, D>,
): UseCachedDataResult<T> {
  const {
    cacheKey,
    fetchFn,
    dependencies,
    ttl = 7200,
    debounceMs = 100,
    clearOnChange = true,
    enableCache = true,
    fetchOnMount = true,
  } = options;

  // ========== 状态管理 ==========
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);

  // ========== Refs ==========
  // 防抖定时器
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 参数快照（用于验证响应是否匹配当前请求）
  const currentParamsRef = useRef<string>(JSON.stringify(dependencies));

  // 请求计数器（用于取消过期的请求）
  const requestIdRef = useRef<number>(0);

  // 是否已挂载（防止 unmount 后更新状态）
  const isMountedRef = useRef(true);

  // ========== 核心数据获取逻辑 ==========
  const fetchData = useCallback(
    async (ignoreCache = false) => {
      // 生成本次请求的唯一 ID
      const currentRequestId = ++requestIdRef.current;
      const currentParams = JSON.stringify(dependencies);
      currentParamsRef.current = currentParams;

      try {
        // 第一步：尝试从缓存读取（如果未忽略缓存）
        if (enableCache && !ignoreCache) {
          const cached = globalCache.get<T>(cacheKey);
          if (cached !== null) {
            // 缓存命中！
            // 验证：当前参数是否仍然匹配
            if (
              currentParamsRef.current === currentParams &&
              isMountedRef.current
            ) {
              setData(cached);
              setFromCache(true);
              setLoading(false);
              setError(null);
              console.log(`[useCachedData] 缓存命中: ${cacheKey}`);
              return;
            }
          }
        }

        // 第二步：缓存未命中，发起 API 请求
        setLoading(true);
        if (clearOnChange) {
          // 可选：清空旧数据，显示完整的 loading 状态
          // setData(null);
        }

        console.log(`[useCachedData] 发起请求: ${cacheKey}`);
        const result = await fetchFn();

        // 第三步：验证请求是否仍然有效
        // - 请求 ID 必须匹配（防止并发请求覆盖）
        // - 参数必须匹配（防止快速切换后旧响应覆盖新数据）
        if (currentRequestId !== requestIdRef.current) {
          console.log(`[useCachedData] 请求已过期，忽略响应: ${cacheKey}`);
          return;
        }

        if (currentParamsRef.current !== currentParams) {
          console.log(`[useCachedData] 参数已变化，忽略响应: ${cacheKey}`);
          return;
        }

        if (!isMountedRef.current) {
          console.log(`[useCachedData] 组件已卸载，忽略响应: ${cacheKey}`);
          return;
        }

        // 第四步：更新状态和缓存
        setData(result);
        setFromCache(false);
        setLoading(false);
        setError(null);

        // 写入缓存（同步操作）
        if (enableCache) {
          try {
            globalCache.set(cacheKey, result, ttl);
          } catch (e) {
            console.warn(`[useCachedData] 缓存写入失败:`, e);
          }
        }
      } catch (e) {
        // 验证请求是否仍然有效
        if (
          currentRequestId !== requestIdRef.current ||
          !isMountedRef.current
        ) {
          return;
        }

        const errorMessage = e instanceof Error ? e.message : '未知错误';
        setError(errorMessage);
        setLoading(false);
        console.error(`[useCachedData] 请求失败: ${cacheKey}`, e);
      }
    },
    [cacheKey, fetchFn, dependencies, ttl, enableCache, clearOnChange],
  );

  // ========== 防抖触发数据获取 ==========
  useEffect(() => {
    // 清除之前的防抖定时器
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // 如果不需要在挂载时获取数据，直接返回
    if (!fetchOnMount && requestIdRef.current === 0) {
      setLoading(false);
      return;
    }

    // 启动防抖定时器
    debounceTimerRef.current = setTimeout(() => {
      fetchData();
    }, debounceMs);

    // 清理函数
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, ...dependencies]);

  // ========== 组件卸载时清理 ==========
  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // ========== 手动刷新（忽略缓存） ==========
  const refresh = useCallback(async () => {
    await fetchData(true);
  }, [fetchData]);

  // ========== 清除缓存 ==========
  const clearCache = useCallback(() => {
    globalCache.delete(cacheKey);
    console.log(`[useCachedData] 缓存已清除: ${cacheKey}`);
  }, [cacheKey]);

  return {
    data,
    loading,
    error,
    fromCache,
    refresh,
    clearCache,
  };
}

// ============ 简化版 Hook（用于简单场景） ============

/**
 * 简化版的缓存数据 Hook
 *
 * @example
 * ```tsx
 * const { data, loading } = useSimpleCachedData(
 *   'my-data',
 *   async () => fetch('/api/data').then(r => r.json()),
 *   [userId]
 * );
 * ```
 */
export function useSimpleCachedData<T>(
  cacheKeyPrefix: string,
  fetchFn: () => Promise<T>,
  dependencies: unknown[] = [],
): UseCachedDataResult<T> {
  // 自动生成缓存键
  const cacheKey = generateCacheKey(cacheKeyPrefix, {
    deps: JSON.stringify(dependencies),
  });

  return useCachedData({
    cacheKey,
    fetchFn,
    dependencies,
  });
}

export default useCachedData;
