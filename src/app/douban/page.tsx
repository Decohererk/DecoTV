/* eslint-disable no-console,react-hooks/exhaustive-deps,@typescript-eslint/no-explicit-any */

'use client';

import { useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';
import { generateCacheKey } from '@/lib/unified-cache';
import useBrowseVideos from '@/hooks/useBrowseVideos';
import { useSourceFilter } from '@/hooks/useSourceFilter';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector, { SourceCategory } from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
import VirtualizedVideoGrid from '@/components/VirtualizedVideoGrid';

import { useGlobalCache } from '@/contexts/GlobalCacheContext';

const MAX_GRID_ITEMS = 540;

interface SourceGridItem {
  id: string;
  title: string;
  poster: string;
  rate: string;
  year: string;
  doubanId?: number;
}

function parseDoubanId(value: unknown): number | undefined {
  if (value == null) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

  return parsed;
}

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const loadMoreLockRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const type = searchParams.get('type') || 'movie';

  // === 智能防抖追踪（必须在 type 定义之后）===
  const isFirstMount = useRef(true);
  const prevTypeRef = useRef(type);

  // === 请求生命周期管理：防止并发和重复加载 ===
  const pendingCacheKeyRef = useRef<string | null>(null); // 当前正在加载的 cacheKey
  const abortControllerRef = useRef<AbortController | null>(null); // 用于取消前一个请求

  // 用于存储最新参数值的 refs
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  // === 接入全局缓存 ===
  const {
    getDoubanData,
    setDoubanData: setGlobalDoubanData,
    isDoubanLoading,
    setDoubanLoading,
  } = useGlobalCache();

  // 获取 runtimeConfig 中的自定义分类数据
  const [customCategories, setCustomCategories] = useState<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >([]);

  // 选择器状态 - 完全独立，不依赖URL参数
  const [primarySelection, setPrimarySelection] = useState<string>(() => {
    if (type === 'movie') return '热门';
    if (type === 'tv' || type === 'show') return '最近热门';
    if (type === 'anime') return '每日放送';
    return '';
  });
  const [secondarySelection, setSecondarySelection] = useState<string>(() => {
    if (type === 'movie') return '全部';
    if (type === 'tv') return 'tv';
    if (type === 'show') return 'show';
    return '全部';
  });

  // MultiLevelSelector 状态
  const [multiLevelValues, setMultiLevelValues] = useState<
    Record<string, string>
  >({
    type: 'all',
    region: 'all',
    year: 'all',
    platform: 'all',
    label: 'all',
    sort: 'T',
  });

  // 星期选择器状态
  const [selectedWeekday, setSelectedWeekday] = useState<string>('');

  // 数据源筛选 Hook
  const {
    sources,
    currentSource,
    isLoadingCategories,
    setCurrentSource,
    getFilteredCategories,
  } = useSourceFilter({ syncWithGlobal: false });

  // 【核心修复】存储当前源的过滤后分类列表（用于渲染）
  const [filteredSourceCategories, setFilteredSourceCategories] = useState<
    SourceCategory[]
  >([]);

  // 选中的源分类
  const [selectedSourceCategory, setSelectedSourceCategory] =
    useState<SourceCategory | null>(null);

  const sourceCategoryId = selectedSourceCategory
    ? String(selectedSourceCategory.type_id)
    : null;
  const currentSourceConfig = useMemo(
    () => sources.find((source) => source.key === currentSource) ?? null,
    [currentSource, sources],
  );
  const isSourceMode = currentSource !== 'auto';
  const shouldBrowseSourceCategory =
    isSourceMode &&
    Boolean(currentSourceConfig?.api) &&
    Boolean(sourceCategoryId);

  const {
    videos: sourceCategoryItems,
    hasMore: hasMoreSourceItems,
    isLoading: isLoadingSourceItems,
    isLoadingMore: isLoadingMoreSourceItems,
    error: sourceCategoryError,
    loadMore: loadMoreSourceItems,
  } = useBrowseVideos({
    sourceKey: currentSource,
    sourceApi: currentSourceConfig?.api ?? null,
    categoryId: sourceCategoryId,
    enabled: shouldBrowseSourceCategory,
  });

  // 获取自定义分类数据
  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setCustomCategories(runtimeConfig.CUSTOM_CATEGORIES);
    }
  }, []);

  // 同步最新参数值到 ref
  useEffect(() => {
    currentParamsRef.current = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage,
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    currentPage,
  ]);

  // 初始化时标记选择器为准备好状态
  useEffect(() => {
    // 短暂延迟确保初始状态设置完成
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []); // 只在组件挂载时执行一次

  // type变化时立即重置selectorsReady（最高优先级）
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true); // 立即显示loading状态
  }, [type]);

  // 当type变化时重置选择器状态
  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      // 自定义分类模式：优先选择 movie，如果没有 movie 则选择 tv
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type)),
      );
      if (types.length > 0) {
        // 优先选择 movie，如果没有 movie 则选择 tv
        let selectedType = types[0]; // 默认选择第一个
        if (types.includes('movie')) {
          selectedType = 'movie';
        } else {
          selectedType = 'tv';
        }
        setPrimarySelection(selectedType);

        // 设置选中类型的第一个分类的 query 作为二级选择
        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType,
        );
        if (firstCategory) {
          setSecondarySelection(firstCategory.query);
        }
      }
    } else {
      // 原有逻辑
      if (type === 'movie') {
        setPrimarySelection('热门');
        setSecondarySelection('全部');
      } else if (type === 'tv') {
        setPrimarySelection('最近热门');
        setSecondarySelection('tv');
      } else if (type === 'show') {
        setPrimarySelection('最近热门');
        setSecondarySelection('show');
      } else if (type === 'anime') {
        setPrimarySelection('每日放送');
        setSecondarySelection('全部');
      } else {
        setPrimarySelection('');
        setSecondarySelection('全部');
      }
    }

    // 清空 MultiLevelSelector 状态
    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });

    // 使用短暂延迟确保状态更新完成后标记选择器准备好
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, [type, customCategories]);

  // 生成骨架屏数据
  const skeletonData = Array.from({ length: 25 }, (_, index) => index);

  // 参数快照比较函数
  const isSnapshotEqual = useCallback(
    (
      snapshot1: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      },
      snapshot2: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
        currentPage: number;
      },
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        snapshot1.currentPage === snapshot2.currentPage &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    [],
  );

  // 生成API请求参数的辅助函数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      // 当type为tv或show时，kind统一为'tv'，category使用type本身
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }

      // 电影类型保持原逻辑
      return {
        kind: type as 'tv' | 'movie',
        category: primarySelection,
        type: secondarySelection,
        pageLimit: 25,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection],
  );

  // 防抖的数据加载函数 - 缓存优先 + 请求生命周期管理
  const loadInitialData = useCallback(async () => {
    // 创建当前参数的快照
    // 【关键修复】检查选择器状态是否与 type 同步
    // 防止状态不同步时发起错误的请求（这是导致卡顿的根本原因）
    const isStateInSync = (() => {
      if (type === 'movie') {
        return (
          ['全部', '热门', '最新', '豆瓣高分', '冷门佳片'].includes(
            primarySelection,
          ) &&
          ['全部', '华语', '欧美', '韩国', '日本'].includes(secondarySelection)
        );
      }
      if (type === 'tv') {
        return (
          ['最近热门', '全部'].includes(primarySelection) &&
          [
            'tv',
            'tv_domestic',
            'tv_american',
            'tv_japanese',
            'tv_korean',
            'tv_animation',
            'tv_documentary',
          ].includes(secondarySelection)
        );
      }
      if (type === 'show') {
        return (
          ['最近热门', '全部'].includes(primarySelection) &&
          ['show', 'show_domestic', 'show_foreign'].includes(secondarySelection)
        );
      }
      if (type === 'anime') {
        return ['每日放送', '番剧', '剧场版'].includes(primarySelection);
      }
      if (type === 'custom') {
        return Boolean(primarySelection && secondarySelection);
      }
      return true;
    })();

    if (!isStateInSync) {
      // 状态还没同步，跳过这次加载，等待下一次 useEffect 触发
      // 兜底回收 loading，避免异常状态导致骨架屏卡死
      setLoading(false);
      return;
    }

    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage: 0,
    };

    // 【缓存优先】生成缓存键
    const cacheKey = generateCacheKey('douban', {
      type,
      primary: primarySelection,
      secondary: secondarySelection,
      weekday: type === 'anime' ? selectedWeekday : '',
      ...multiLevelValues,
    });

    // 【请求生命周期】如果有新的请求，取消前一个
    if (pendingCacheKeyRef.current && pendingCacheKeyRef.current !== cacheKey) {
      abortControllerRef.current?.abort();
    }

    // 【防止同一 cacheKey 的并发】避免对同一数据发起多个请求
    if (pendingCacheKeyRef.current === cacheKey) {
      return;
    }

    // 【缓存优先】尝试从全局内存缓存读取
    const cachedData = getDoubanData(cacheKey);
    if (cachedData && cachedData.length > 0) {
      // 缓存命中：使用 flushSync 强制同步更新 DOM，实现毫秒级渲染
      pendingCacheKeyRef.current = null; // 清除待处理标记
      loadMoreLockRef.current = false;
      flushSync(() => {
        setDoubanData(cachedData);
        setLoading(false);
        setHasMore(cachedData.length > 0);
        setIsLoadingMore(false);
        setCurrentPage(0);
      });
      return;
    }

    // 【无缓存】标记为正在加载，记录当前 cacheKey
    pendingCacheKeyRef.current = cacheKey;
    // 创建新的 AbortController 用于取消请求
    abortControllerRef.current = new AbortController();

    setDoubanLoading(cacheKey, true);
    setLoading(true);

    try {
      // 保留旧数据直到新数据成功返回，避免代理瞬断导致页面直接空白。
      setDoubanData((previous) => (previous.length > 0 ? previous : []));
      setCurrentPage(0);
      setHasMore(true);
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        // 自定义分类模式：根据选中的一级和二级选项获取对应的分类
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection,
        );

        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: 0,
          });
        } else {
          throw new Error('没有找到对应的分类');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find(
          (item) => item.weekday.en === selectedWeekday,
        );
        if (weekdayData) {
          data = {
            code: 200,
            message: 'success',
            list: weekdayData.items
              .filter((item) => item && item.id)
              .map((item) => ({
                id: item.id?.toString() || '',
                title: item.name_cn || item.name,
                poster:
                  item.images?.large ||
                  item.images?.common ||
                  item.images?.medium ||
                  item.images?.small ||
                  item.images?.grid ||
                  '/logo.png',
                rate: item.rating?.score?.toFixed(1) || '',
                year: item.air_date?.split('-')?.[0] || '',
              })),
          };
        } else {
          throw new Error('没有找到对应的日期');
        }
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: 25,
          pageStart: 0,
          category: '动画',
          format: primarySelection === '番剧' ? '电视剧' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 25,
          pageStart: 0, // 初始数据加载始终从第一页开始
          category: multiLevelValues.type
            ? (multiLevelValues.type as string)
            : '',
          format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
          region: multiLevelValues.region
            ? (multiLevelValues.region as string)
            : '',
          year: multiLevelValues.year ? (multiLevelValues.year as string) : '',
          platform: multiLevelValues.platform
            ? (multiLevelValues.platform as string)
            : '',
          sort: multiLevelValues.sort ? (multiLevelValues.sort as string) : '',
          label: multiLevelValues.label
            ? (multiLevelValues.label as string)
            : '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        // 检查参数是否仍然一致，如果一致才设置数据
        // 使用 ref 获取最新的当前值
        const currentSnapshot = { ...currentParamsRef.current };

        if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
          // 使用 flushSync 确保状态同步更新，避免批处理延迟
          flushSync(() => {
            setDoubanData(data.list);
            setHasMore(data.list.length !== 0);
            setLoading(false);
          });

          // 【全局缓存写入】保存到全局 Context 缓存，下次瞬间加载
          if (data.list.length > 0) {
            setGlobalDoubanData(cacheKey, data.list);
          }
        }
        // 如果参数不一致，不执行任何操作，避免设置过期数据
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      console.error(err);
      window.dispatchEvent(
        new CustomEvent('globalError', {
          detail: { message: '豆瓣数据加载失败，已保留当前可用内容' },
        }),
      );
      setLoading(false); // 发生错误时总是停止loading状态
    } finally {
      // 【请求生命周期】清除待处理标记
      if (pendingCacheKeyRef.current === cacheKey) {
        pendingCacheKeyRef.current = null;
      }
      // 清除加载状态
      setDoubanLoading(cacheKey, false);
    }
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
    customCategories,
    getDoubanData,
    setGlobalDoubanData,
    isDoubanLoading,
    setDoubanLoading,
  ]);

  // 只在选择器准备好后才加载数据 - 智能防抖
  useEffect(() => {
    // 只有在选择器准备好时才开始加载
    if (!selectorsReady) {
      return;
    }

    // 如果当前是特定源模式，不加载豆瓣数据
    if (currentSource !== 'auto') {
      // 特定源模式下，等待用户选择分类后再加载
      setLoading(false);
      return;
    }

    // 清除之前的防抖定时器
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // 【智能防抖】判断是否需要立即执行
    const typeChanged = prevTypeRef.current !== type;
    const shouldExecuteImmediately = isFirstMount.current || typeChanged;

    // 更新追踪状态
    prevTypeRef.current = type;
    if (isFirstMount.current) {
      isFirstMount.current = false;
    }

    if (shouldExecuteImmediately) {
      // 首次挂载或 Tab 切换：立即执行，利用缓存实现 0 延迟
      loadInitialData();
    } else {
      // 筛选条件变化：使用防抖，防止用户快速点击
      debounceTimeoutRef.current = setTimeout(() => {
        loadInitialData();
      }, 100);
    }

    // 清理函数
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
    };
  }, [
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    loadInitialData,
    currentSource, // 添加 currentSource 依赖
  ]);

  // 单独处理 currentPage 变化（加载更多）
  useEffect(() => {
    if (currentPage > 0) {
      const fetchMoreData = async () => {
        // 创建当前参数的快照
        const requestSnapshot = {
          type,
          primarySelection,
          secondarySelection,
          multiLevelSelection: multiLevelValues,
          selectedWeekday,
          currentPage,
        };

        try {
          setIsLoadingMore(true);

          let data: DoubanResult;
          if (type === 'custom') {
            // 自定义分类模式：根据选中的一级和二级选项获取对应的分类
            const selectedCategory = customCategories.find(
              (cat) =>
                cat.type === primarySelection &&
                cat.query === secondarySelection,
            );

            if (selectedCategory) {
              data = await getDoubanList({
                tag: selectedCategory.query,
                type: selectedCategory.type,
                pageLimit: 25,
                pageStart: currentPage * 25,
              });
            } else {
              throw new Error('没有找到对应的分类');
            }
          } else if (type === 'anime' && primarySelection === '每日放送') {
            // 每日放送模式下，不进行数据请求，返回空数据
            data = {
              code: 200,
              message: 'success',
              list: [],
            };
          } else if (type === 'anime') {
            data = await getDoubanRecommends({
              kind: primarySelection === '番剧' ? 'tv' : 'movie',
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: '动画',
              format: primarySelection === '番剧' ? '电视剧' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else if (primarySelection === '全部') {
            data = await getDoubanRecommends({
              kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
              pageLimit: 25,
              pageStart: currentPage * 25,
              category: multiLevelValues.type
                ? (multiLevelValues.type as string)
                : '',
              format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
              region: multiLevelValues.region
                ? (multiLevelValues.region as string)
                : '',
              year: multiLevelValues.year
                ? (multiLevelValues.year as string)
                : '',
              platform: multiLevelValues.platform
                ? (multiLevelValues.platform as string)
                : '',
              sort: multiLevelValues.sort
                ? (multiLevelValues.sort as string)
                : '',
              label: multiLevelValues.label
                ? (multiLevelValues.label as string)
                : '',
            });
          } else {
            data = await getDoubanCategories(
              getRequestParams(currentPage * 25),
            );
          }

          if (data.code === 200) {
            // 检查参数是否仍然一致，如果一致才设置数据
            // 使用 ref 获取最新的当前值
            const currentSnapshot = { ...currentParamsRef.current };

            if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
              setDoubanData((prev) => [...prev, ...data.list]);
              setHasMore(data.list.length !== 0);
            } else {
              console.log('参数不一致，不执行任何操作，避免设置过期数据');
            }
          } else {
            throw new Error(data.message || '获取数据失败');
          }
        } catch (err) {
          console.error(err);
        } finally {
          loadMoreLockRef.current = false;
          setIsLoadingMore(false);
        }
      };

      fetchMoreData();
    }
  }, [
    currentPage,
    type,
    primarySelection,
    secondarySelection,
    customCategories,
    multiLevelValues,
    selectedWeekday,
  ]);

  // 设置滚动监听
  const handleAutoLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || loading) {
      if (!isLoadingMore) {
        loadMoreLockRef.current = false;
      }
      return;
    }
    if (loadMoreLockRef.current) return;
    loadMoreLockRef.current = true;
    setCurrentPage((prev) => prev + 1);
  }, [hasMore, isLoadingMore, loading]);

  const sourceItems = useMemo<SourceGridItem[]>(
    () =>
      sourceCategoryItems.map((item) => ({
        id: String(item.vod_id || ''),
        title: item.vod_name || '',
        poster: item.vod_pic || '',
        rate: '',
        year: item.vod_year || '',
        doubanId: parseDoubanId(item.vod_douban_id ?? item.douban_id),
      })),
    [sourceCategoryItems],
  );

  const activeItemsCount = isSourceMode
    ? sourceItems.length
    : doubanData.length;
  const hasReachedDomLimit = activeItemsCount >= MAX_GRID_ITEMS;
  const activeHasMore =
    (isSourceMode ? hasMoreSourceItems : hasMore) && !hasReachedDomLimit;
  const activeIsLoadingMore = isSourceMode
    ? isLoadingMoreSourceItems
    : isLoadingMore;

  const handleLoadMore = useCallback(() => {
    if (isSourceMode) {
      if (!shouldBrowseSourceCategory || !selectedSourceCategory) return;
      loadMoreSourceItems();
      return;
    }
    handleAutoLoadMore();
  }, [
    handleAutoLoadMore,
    isSourceMode,
    loadMoreSourceItems,
    selectedSourceCategory,
    shouldBrowseSourceCategory,
  ]);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;
    if (!activeHasMore || activeIsLoadingMore || activeItemsCount === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          handleLoadMore();
        });
      },
      {
        root: null,
        rootMargin: '520px 0px',
        threshold: 0,
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeHasMore, activeIsLoadingMore, activeItemsCount, handleLoadMore]);

  // 处理选择器变化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== primarySelection) {
        setLoading(true);
        // 立即重置页面状态，防止基于旧状态的请求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);

        // 清空 MultiLevelSelector 状态
        setMultiLevelValues({
          type: 'all',
          region: 'all',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'T',
        });

        // 如果是自定义分类模式，同时更新一级和二级选择器
        if (type === 'custom' && customCategories.length > 0) {
          const firstCategory = customCategories.find(
            (cat) => cat.type === value,
          );
          if (firstCategory) {
            // 批量更新状态，避免多次触发数据加载
            setPrimarySelection(value);
            setSecondarySelection(firstCategory.query);
          } else {
            setPrimarySelection(value);
          }
        } else {
          // 电视剧和综艺切换到"最近热门"时，重置二级分类为第一个选项
          if ((type === 'tv' || type === 'show') && value === '最近热门') {
            setPrimarySelection(value);
            if (type === 'tv') {
              setSecondarySelection('tv');
            } else if (type === 'show') {
              setSecondarySelection('show');
            }
          } else {
            setPrimarySelection(value);
          }
        }
      }
    },
    [primarySelection, type, customCategories],
  );

  const handleSecondaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== secondarySelection) {
        setLoading(true);
        // 立即重置页面状态，防止基于旧状态的请求
        setCurrentPage(0);
        setDoubanData([]);
        setHasMore(true);
        setIsLoadingMore(false);
        setSecondarySelection(value);
      }
    },
    [secondarySelection],
  );

  const handleMultiLevelChange = useCallback(
    (values: Record<string, string>) => {
      // 比较两个对象是否相同，忽略顺序
      const isEqual = (
        obj1: Record<string, string>,
        obj2: Record<string, string>,
      ) => {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();

        if (keys1.length !== keys2.length) return false;

        return keys1.every((key) => obj1[key] === obj2[key]);
      };

      // 如果相同，则不设置loading状态
      if (isEqual(values, multiLevelValues)) {
        return;
      }

      setLoading(true);
      // 立即重置页面状态，防止基于旧状态的请求
      setCurrentPage(0);
      setDoubanData([]);
      setHasMore(true);
      setIsLoadingMore(false);
      setMultiLevelValues(values);
    },
    [multiLevelValues],
  );

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  // 从源接口获取分类数据（必须在 handleSourceChange 之前定义）
  const handleSourceChange = useCallback(
    async (sourceKey: string, force = false) => {
      if (!force && sourceKey === currentSource) return;

      // === Step 1: 立即重置所有状态，防止状态污染 ===
      setLoading(true);
      setCurrentPage(0);
      setDoubanData([]); // 清空豆瓣数据
      setHasMore(true);
      setIsLoadingMore(false);
      setSelectedSourceCategory(null); // 清除旧分类ID，防止污染
      setFilteredSourceCategories([]); // 清空过滤后分类列表

      // === Step 2: 切换源状态 ===
      if (sourceKey !== currentSource) {
        setCurrentSource(sourceKey);
      }

      // === Step 3: 根据源类型执行不同逻辑 ===
      if (sourceKey === 'auto') {
        // 【切回聚合模式】重置为默认的豆瓣分类选择
        if (type === 'movie') {
          setPrimarySelection('热门');
          setSecondarySelection('全部');
        } else if (type === 'tv') {
          setPrimarySelection('最近热门');
          setSecondarySelection('tv');
        } else if (type === 'show') {
          setPrimarySelection('最近热门');
          setSecondarySelection('show');
        } else if (type === 'anime') {
          setPrimarySelection('每日放送');
          setSecondarySelection('全部');
        }
        // 重置多级筛选器
        setMultiLevelValues({
          type: 'all',
          region: 'all',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'T',
        });
        // 聚合模式下 useEffect 会自动触发 loadInitialData
      } else {
        // === 【特定源模式】获取分类并自动选中第一个 ===
        // Step 4: 等待分类列表加载完成
        const source = sources.find((s) => s.key === sourceKey);
        if (!source) {
          console.error('🔥 [Debug] Source not found:', sourceKey);
          setLoading(false);
          return;
        }

        console.log('🔥 [Debug] Selected Source:', source.name, source.api);

        try {
          // 构建分类 API URL
          const originalApiUrl = source.api.endsWith('/')
            ? `${source.api}?ac=class`
            : `${source.api}/?ac=class`;

          console.log('🔥 [Debug] Original API URL:', originalApiUrl);

          // ========================================
          // 🛡️ 全量代理：所有外部 URL 都走服务端代理
          // 不仅解决 Mixed Content (HTTP)，也解决 CORS (HTTPS)
          // ========================================
          const isExternalUrl =
            originalApiUrl.startsWith('http://') ||
            originalApiUrl.startsWith('https://');
          const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
          const fetchUrl = isExternalUrl ? proxyUrl : originalApiUrl;

          console.log('🔥 [Debug] Using proxy:', isExternalUrl);
          console.log('🔥 [Debug] Fetch URL:', fetchUrl);

          const response = await fetch(fetchUrl, {
            headers: {
              Accept: 'application/json',
            },
          });

          console.log(
            '🔥 [Debug] Response status:',
            response.status,
            response.ok,
          );

          if (!response.ok) {
            const errorText = await response.text().catch(() => '');
            console.error('🔥 [Debug] Response error:', errorText);
            throw new Error(`获取分类列表失败: ${response.status}`);
          }

          const data = await response.json();
          console.log('🔥 [Debug] Raw API Response:', data);
          console.log('✅ [Proxy Fetch Success] Data keys:', Object.keys(data));

          const allCategories: SourceCategory[] = data.class || [];
          console.log(
            '🔥 [Debug] Parsed categories count:',
            allCategories.length,
          );
          console.log(
            '🔥 [Debug] First 5 categories:',
            allCategories.slice(0, 5),
          );

          // ========================================
          // 🚀 绝对直通模式 - 移除所有过滤逻辑
          // 直接使用 API 返回的原始分类，不做任何过滤
          // ========================================

          if (allCategories.length === 0) {
            console.warn('🔥 [Debug] API returned empty categories!');
            // 提示用户：源没有返回分类数据
            setFilteredSourceCategories([]);
            setLoading(false);
            return;
          }

          // 【绝对直通】直接使用原始分类，不过滤
          console.log(
            '🔥 [Debug] Setting categories (NO FILTER):',
            allCategories.length,
          );
          setFilteredSourceCategories(allCategories);

          // 【强制自动选中】立即选中第一个分类
          const firstCategory = allCategories[0];
          console.log(
            '🔥 [Debug] Auto-selecting first category:',
            firstCategory,
          );
          setSelectedSourceCategory(firstCategory);

          // 立即触发数据加载（不等待用户点击）
          setLoading(false);
        } catch (err) {
          console.error('🔥 [Debug] Fetch error:', err);
          setFilteredSourceCategories([]); // 出错时清空
          setLoading(false);
        }
      }
    },
    [currentSource, setCurrentSource, type, sources],
  );

  // 监听全局源变更（由“源浏览器”页面触发），并自动刷新当前页状态
  const lastAppliedSourceRef = useRef<string | null>(null);
  useEffect(() => {
    if (sources.length === 0) return;
    if (lastAppliedSourceRef.current === currentSource) return;
    lastAppliedSourceRef.current = currentSource;
    void handleSourceChange(currentSource, true);
  }, [currentSource, sources.length, handleSourceChange]);

  // 处理源分类切换
  const handleSourceCategoryChange = useCallback(
    (category: SourceCategory) => {
      if (selectedSourceCategory?.type_id !== category.type_id) {
        setSelectedSourceCategory(category);
      }
    },
    [selectedSourceCategory],
  );

  const getPageTitle = () => {
    // 根据 type 生成标题
    return type === 'movie'
      ? '电影'
      : type === 'tv'
        ? '电视剧'
        : type === 'anime'
          ? '动漫'
          : type === 'show'
            ? '综艺'
            : '自定义';
  };

  const getPageDescription = () => {
    if (type === 'anime' && primarySelection === '每日放送') {
      return '来自 Bangumi 番组计划的精选内容';
    }
    return '来自豆瓣的精选内容';
  };

  const getActivePath = () => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);

    const queryString = params.toString();
    const activePath = `/douban${queryString ? `?${queryString}` : ''}`;
    return activePath;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 页面标题和选择器 */}
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          {/* 页面标题 */}
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

          {/* 选择器组件 */}
          {type !== 'custom' ? (
            <div className='bg-white/90 dark:bg-gray-900/90 rounded-2xl p-4 sm:p-6 border border-gray-200/40 dark:border-gray-700/40'>
              <DoubanSelector
                type={type as 'movie' | 'tv' | 'show' | 'anime'}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
                onMultiLevelChange={handleMultiLevelChange}
                onWeekdayChange={handleWeekdayChange}
                // 数据源相关 props
                currentSource={currentSource}
                // 【核心修复】使用 filteredSourceCategories state 而非 getFilteredCategories
                // 这样确保渲染的分类与 handleSourceChange 处理的分类一致
                sourceCategories={
                  currentSource !== 'auto'
                    ? filteredSourceCategories
                    : getFilteredCategories(
                        type as 'movie' | 'tv' | 'anime' | 'show',
                      )
                }
                isLoadingCategories={isLoadingCategories}
                onSourceCategoryChange={handleSourceCategoryChange}
                selectedSourceCategory={selectedSourceCategory}
                hideSourceSelector
              />
            </div>
          ) : (
            <div className='bg-white/90 dark:bg-gray-900/90 rounded-2xl p-4 sm:p-6 border border-gray-200/40 dark:border-gray-700/40'>
              <DoubanCustomSelector
                customCategories={customCategories}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
              />
            </div>
          )}
        </div>

        {/* 内容展示区域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          {/* 内容网格 - 使用 content-visibility 优化渲染性能 */}
          {loading ||
          (isSourceMode && isLoadingSourceItems) ||
          !selectorsReady ? (
            <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
              {skeletonData.map((index) => (
                <DoubanCardSkeleton key={index} />
              ))}
            </div>
          ) : isSourceMode && sourceItems.length > 0 ? (
            <>
              {sourceCategoryError && (
                <div className='mb-4 rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200'>
                  {sourceCategoryError}
                </div>
              )}
              <VirtualizedVideoGrid
                data={sourceItems}
                mode='auto'
                scrollParent='body'
                virtualizationThreshold={36}
                overscan={620}
                className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'
                itemClassName='w-full'
                itemKey={(item) =>
                  `source-${item.id || item.title}-${item.year || ''}`
                }
                renderItem={(item) => (
                  <VideoCard
                    id={item.id}
                    source={currentSource}
                    source_name={currentSourceConfig?.name || currentSource}
                    from='search'
                    title={item.title}
                    poster={item.poster}
                    year={item.year}
                    douban_id={item.doubanId}
                    type={type === 'movie' ? 'movie' : ''}
                  />
                )}
              />
            </>
          ) : isSourceMode && sourceCategoryError ? (
            <div className='rounded-xl border border-red-400/30 bg-red-500/10 p-4 text-sm text-red-200'>
              {sourceCategoryError}
            </div>
          ) : isSourceMode && selectedSourceCategory ? (
            <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
              <p>该分类暂无内容</p>
              <p className='text-sm mt-2'>请尝试切换其他分类</p>
            </div>
          ) : isSourceMode && !selectedSourceCategory ? (
            <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
              <p>请选择一个分类</p>
              <p className='text-sm mt-2'>可在上方分类列表中进行选择</p>
            </div>
          ) : doubanData.length > 0 ? (
            <VirtualizedVideoGrid
              data={doubanData}
              mode='auto'
              scrollParent='body'
              virtualizationThreshold={36}
              overscan={620}
              className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'
              itemClassName='w-full'
              itemKey={(item) =>
                `douban-${item.id || item.title}-${item.year || ''}`
              }
              renderItem={(item) => (
                <VideoCard
                  from='douban'
                  title={item.title}
                  poster={item.poster}
                  douban_id={Number(item.id)}
                  rate={item.rate}
                  year={item.year}
                  type={type === 'movie' ? 'movie' : ''}
                  isBangumi={type === 'anime' && Boolean(selectedWeekday)}
                />
              )}
            />
          ) : (
            <div className='text-center text-gray-500 py-8'>暂无相关内容</div>
          )}

          {!loading && activeItemsCount > 0 && (
            <div className='mt-10 flex flex-col items-center gap-4 pb-8'>
              <div
                ref={loadMoreSentinelRef}
                className='h-1 w-full'
                aria-hidden='true'
              />
              <button
                type='button'
                onClick={handleLoadMore}
                disabled={!activeHasMore || activeIsLoadingMore}
                className='inline-flex min-w-40 items-center justify-center gap-2 rounded-xl border border-white/20 bg-slate-900/70 px-5 py-2.5 text-sm font-medium text-slate-100 shadow-[0_0_0_1px_rgba(148,163,184,0.14)_inset,0_10px_30px_-16px_rgba(16,185,129,0.65)] backdrop-blur-md transition hover:border-emerald-300/50 hover:bg-slate-800/80 disabled:cursor-not-allowed disabled:border-slate-600/60 disabled:bg-slate-800/45 disabled:text-slate-400'
              >
                {activeIsLoadingMore ? (
                  <>
                    <span
                      className='inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-400/50 border-t-emerald-300'
                      aria-hidden='true'
                    />
                    加载中...
                  </>
                ) : activeHasMore ? (
                  '加载更多'
                ) : hasReachedDomLimit ? (
                  '已达性能上限'
                ) : (
                  '已到底部'
                )}
              </button>
              {hasReachedDomLimit && (
                <p className='text-xs text-slate-400'>
                  已限制最大渲染数量（{MAX_GRID_ITEMS}），请切换分类继续浏览。
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

export default function DoubanPage() {
  return (
    <Suspense>
      <DoubanPageClient />
    </Suspense>
  );
}
