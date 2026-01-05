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

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
import {
  getDoubanCategories,
  getDoubanList,
  getDoubanRecommends,
} from '@/lib/douban.client';
import { DoubanItem, DoubanResult } from '@/lib/types';
import { generateCacheKey, globalCache } from '@/lib/unified-cache';
import { useImagePreload } from '@/hooks/useImagePreload';
import { useSourceFilter } from '@/hooks/useSourceFilter';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector, { SourceCategory } from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
// Integrated VirtualGrid to render 1000+ items with 60FPS performance.
import VirtualGrid from '@/components/VirtualGrid';

function DoubanPageClient() {
  const searchParams = useSearchParams();

  // 参数映射: 中文 -> 英文 (解决 API 400 错误)
  const CATEGORY_MAPPING: Record<string, string> = {
    热门: 'hot',
    最新: 'new',
    经典: 'classic',
    可播放: 'playable',
    豆瓣高分: 'high_score',
    冷门佳片: 'hidden_gem',
    华语: 'chinese',
    欧美: 'western',
    韩国: 'korean',
    日本: 'japanese',
    全部: 'all',
    最近热门: 'recent_hot',
  };

  const TYPE_MAPPING: Record<string, string> = {
    全部: 'all',
    剧情: 'drama',
    喜剧: 'comedy',
    动作: 'action',
    爱情: 'romance',
    科幻: 'scifi',
    动画: 'animation',
    悬疑: 'suspense',
    犯罪: 'crime',
    恐怖: 'horror',
    纪录片: 'documentary',
    战争: 'war',
    历史: 'history',
    传记: 'biography',
    家庭: 'family',
    奇幻: 'fantasy',
    武侠: 'martial_arts',
    古装: 'costume',
    音乐: 'music',
    tv: 'tv',
    show: 'show',
  };

  // FIX: Manual append logic for reliable infinite scrolling
  // 分离豆瓣数据和源数据的状态管理
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [sourceData, setSourceData] = useState<DoubanItem[]>([]);

  // 豆瓣模式加载状态
  const [loading, setLoading] = useState(false);

  // 豆瓣模式分页状态 (SmoneTV Pattern)
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // 源模式分页状态
  const [sourceLoadingMore, setSourceLoadingMore] = useState(false);
  const [sourceHasMore, setSourceHasMore] = useState(false);
  const [sourcePage, setSourcePage] = useState(1);

  const [selectorsReady, setSelectorsReady] = useState(false);
  // observerRef 和 loadingRef 已移除 - 使用 VirtualGrid 内部触底检测
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 用于存储最新参数值的 refs
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
  });

  const type = searchParams.get('type') || 'movie';

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
    isLoadingSources,
    isLoadingCategories,
    setCurrentSource,
    getFilteredCategories,
  } = useSourceFilter();

  // 【核心修复】存储当前源的过滤后分类列表（用于渲染）
  const [filteredSourceCategories, setFilteredSourceCategories] = useState<
    SourceCategory[]
  >([]);

  // 选中的源分类
  const [selectedSourceCategory, setSelectedSourceCategory] =
    useState<SourceCategory | null>(null);

  // 源分类数据加载状态
  const [isLoadingSourceData, setIsLoadingSourceData] = useState(false);

  // 【性能优化】预加载首屏图片
  const imageUrls = useMemo(
    () =>
      (currentSource !== 'auto' ? sourceData : doubanData)
        .slice(0, 12)
        .map((item) => item.poster)
        .filter(Boolean),
    [currentSource, sourceData, doubanData],
  );
  useImagePreload(imageUrls, 12);

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
    };
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
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
  const skeletonData = Array.from({ length: 50 }, (_, index) => index);

  // 参数快照比较函数
  const isSnapshotEqual = useCallback(
    (
      snapshot1: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
      },
      snapshot2: {
        type: string;
        primarySelection: string;
        secondarySelection: string;
        multiLevelSelection: Record<string, string>;
        selectedWeekday: string;
      },
    ) => {
      return (
        snapshot1.type === snapshot2.type &&
        snapshot1.primarySelection === snapshot2.primarySelection &&
        snapshot1.secondarySelection === snapshot2.secondarySelection &&
        snapshot1.selectedWeekday === snapshot2.selectedWeekday &&
        JSON.stringify(snapshot1.multiLevelSelection) ===
          JSON.stringify(snapshot2.multiLevelSelection)
      );
    },
    [],
  );

  // 生成API请求参数的辅助函数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      // 应用映射: 中文 -> 英文
      const safeCategory =
        CATEGORY_MAPPING[primarySelection] || primarySelection;
      const safeType = TYPE_MAPPING[secondarySelection] || secondarySelection;

      // 当type为tv或show时，kind统一为'tv'，category使用type本身
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: safeType,
          pageLimit: 50,
          pageStart,
        };
      }

      // 电影类型使用映射后的参数
      return {
        kind: type as 'tv' | 'movie',
        category: safeCategory,
        type: safeType,
        pageLimit: 50,
        pageStart,
      };
    },
    [
      type,
      primarySelection,
      secondarySelection,
      CATEGORY_MAPPING,
      TYPE_MAPPING,
    ],
  );

  // 防抖的数据加载函数 - 缓存优先
  const loadInitialData = useCallback(async () => {
    // 创建当前参数的快照
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
    };

    // 【缓存优先】生成缓存键
    const cacheKey = generateCacheKey('douban', {
      type,
      primary: primarySelection,
      secondary: secondarySelection,
      weekday: type === 'anime' ? selectedWeekday : '',
      ...multiLevelValues,
    });

    // 尝试从缓存读取
    const cachedData = globalCache.get<DoubanItem[]>(cacheKey);
    if (cachedData && cachedData.length > 0) {
      console.log(
        `[DoubanPage] 缓存命中: ${cacheKey}, ${cachedData.length} items`,
      );
      setDoubanData(cachedData);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setDoubanData([]);

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
            pageLimit: 50,
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
          pageLimit: 50,
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
          pageLimit: 50,
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
          setDoubanData(data.list);
          setHasMore(data.list.length >= 50); // 如果返回满页，可能还有更多
          setCurrentPage(0); // 重置页码
          setLoading(false);

          // 【缓存写入】保存到缓存，下次瞬间加载
          if (data.list.length > 0) {
            globalCache.set(cacheKey, data.list, 3600); // 1小时缓存
            console.log(`[DoubanPage] 缓存写入: ${cacheKey}`);
          }
        } else {
          console.log('参数不一致，不执行任何操作，避免设置过期数据');
        }
        // 如果参数不一致，不执行任何操作，避免设置过期数据
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      console.error(err);
      setLoading(false); // 发生错误时总是停止loading状态
    }
  }, [
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    getRequestParams,
    customCategories,
    isSnapshotEqual,
  ]);

  // ========================================
  // SmoneTV Pattern: 无限滚动加载更多数据
  // ========================================
  const fetchMoreData = useCallback(async () => {
    // 防止重复请求
    if (isLoadingMore || !hasMore) {
      return;
    }

    // 1. 创建快照
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
      currentPage: currentPage + 1,
    };

    // 2. 关键修复: 立即更新 ref 防止竞态条件
    currentParamsRef.current = {
      type: requestSnapshot.type,
      primarySelection: requestSnapshot.primarySelection,
      secondarySelection: requestSnapshot.secondarySelection,
      multiLevelSelection: requestSnapshot.multiLevelSelection,
      selectedWeekday: requestSnapshot.selectedWeekday,
    };

    try {
      setIsLoadingMore(true);

      let data: DoubanResult;
      const pageStart = requestSnapshot.currentPage * 50;

      // 3. 使用映射后的参数获取数据
      if (type === 'custom') {
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection,
        );
        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 50,
            pageStart,
          });
        } else {
          throw new Error('没有找到对应的分类');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        // 每日放送模式不支持分页
        data = { code: 200, message: 'success', list: [] };
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: 50,
          pageStart,
          category: '动画',
          format: primarySelection === '番剧' ? '电视剧' : '',
          region: multiLevelValues.region || '',
          year: multiLevelValues.year || '',
          platform: multiLevelValues.platform || '',
          sort: multiLevelValues.sort || '',
          label: multiLevelValues.label || '',
        });
      } else if (primarySelection === '全部') {
        data = await getDoubanRecommends({
          kind: type === 'show' ? 'tv' : (type as 'tv' | 'movie'),
          pageLimit: 50,
          pageStart,
          category: multiLevelValues.type || '',
          format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
          region: multiLevelValues.region || '',
          year: multiLevelValues.year || '',
          platform: multiLevelValues.platform || '',
          sort: multiLevelValues.sort || '',
          label: multiLevelValues.label || '',
        });
      } else {
        // 使用 getRequestParams 获取已映射的参数
        data = await getDoubanCategories(getRequestParams(pageStart));
      }

      if (data.code === 200) {
        // 4. 宽松验证: 只检查关键筛选条件
        const currentSnapshot = { ...currentParamsRef.current };
        const isMatch =
          requestSnapshot.type === currentSnapshot.type &&
          requestSnapshot.primarySelection ===
            currentSnapshot.primarySelection &&
          requestSnapshot.secondarySelection ===
            currentSnapshot.secondarySelection;

        // 5. 直接追加数据，信任 React key 处理重复
        if (isMatch && data.list.length > 0) {
          console.log(
            '✅ [fetchMoreData] Appending',
            data.list.length,
            'items to existing',
            doubanData.length,
          );
          setDoubanData((prev) => [...prev, ...data.list]);
          setHasMore(data.list.length >= 50);
          setCurrentPage((prev) => prev + 1);
        } else if (!isMatch) {
          console.log('⚠️ [fetchMoreData] Filter changed, discarding data');
        } else {
          console.log('ℹ️ [fetchMoreData] No more data');
          setHasMore(false);
        }
      } else {
        console.error('❌ [fetchMoreData] API error:', data.message);
        setHasMore(false);
      }
    } catch (err) {
      console.error('❌ [fetchMoreData] Error:', err);
      setHasMore(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    isLoadingMore,
    hasMore,
    currentPage,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    customCategories,
    doubanData.length,
    getRequestParams,
  ]);

  // VirtualGrid 触底回调 - 触发加载更多
  const handleLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || loading) {
      return;
    }
    fetchMoreData();
  }, [hasMore, isLoadingMore, loading, fetchMoreData]);

  // 只在选择器准备好后才加载数据
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

    // 重置分页状态
    setCurrentPage(0);
    setHasMore(true);
    setIsLoadingMore(false);

    // 清除之前的防抖定时器
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    // 使用防抖机制加载数据，避免连续状态更新触发多次请求
    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, 100); // 100ms 防抖延迟

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

  // FIX: Source mode infinite scrolling with separate pagination state
  const handleSourceLoadMore = useCallback(() => {
    if (!sourceHasMore || sourceLoadingMore) {
      return;
    }
    setSourcePage((prev) => prev + 1);
  }, [sourceHasMore, sourceLoadingMore]);

  // FIX: Source mode pagination effect - 加载更多源数据
  useEffect(() => {
    if (sourcePage > 1 && selectedSourceCategory && currentSource !== 'auto') {
      const fetchMoreSourceData = async () => {
        const source = sources.find((s) => s.key === currentSource);
        if (!source) return;

        setSourceLoadingMore(true);
        try {
          const originalApiUrl = source.api.endsWith('/')
            ? `${source.api}?ac=videolist&t=${selectedSourceCategory.type_id}&pg=${sourcePage}`
            : `${source.api}/?ac=videolist&t=${selectedSourceCategory.type_id}&pg=${sourcePage}`;

          const isExternalUrl =
            originalApiUrl.startsWith('http://') ||
            originalApiUrl.startsWith('https://');
          const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
          const fetchUrl = isExternalUrl ? proxyUrl : originalApiUrl;

          console.log(
            '🔥 [fetchMoreSourceData] Fetching page',
            sourcePage,
            ':',
            fetchUrl,
          );

          const response = await fetch(fetchUrl, {
            headers: { Accept: 'application/json' },
          });

          if (!response.ok) throw new Error('获取分页数据失败');

          const data = await response.json();
          const items = data.list || [];
          const pageCount = data.pagecount || 1;

          // FIX: Manual append logic for reliable infinite scrolling
          const convertedItems: DoubanItem[] = items.map((item: any) => ({
            id: item.vod_id?.toString() || '',
            title: item.vod_name || '',
            poster: item.vod_pic || '',
            rating: 0,
            year: item.vod_year || '',
            subtitle: item.vod_remarks || '',
          }));

          // 追加到现有数据
          setSourceData((prev) => [...prev, ...convertedItems]);
          // FIX: Use newPage (sourcePage+1) for comparison since sourcePage is stale
          const newPage = sourcePage + 1;
          setSourceHasMore(newPage < pageCount);
          console.log(
            '✅ [fetchMoreSourceData] Appended',
            items.length,
            'items, hasMore:',
            newPage < pageCount,
            `(page ${newPage}/${pageCount})`,
          );
        } catch (error) {
          console.error('获取更多源数据失败:', error);
        } finally {
          setSourceLoadingMore(false);
        }
      };

      fetchMoreSourceData();
    }
  }, [sourcePage, selectedSourceCategory, currentSource, sources]);

  // 处理选择器变化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      // 只有当值真正改变时才设置loading状态
      if (value !== primarySelection) {
        setLoading(true);
        setDoubanData([]);

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
        setDoubanData([]);
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
      setDoubanData([]);
      setMultiLevelValues(values);
    },
    [multiLevelValues],
  );

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  // 从源接口获取分类数据（必须在 handleSourceChange 之前定义）
  const fetchSourceCategoryData = useCallback(
    async (category: SourceCategory) => {
      if (currentSource === 'auto') return;

      const source = sources.find((s) => s.key === currentSource);
      if (!source) {
        setLoading(false);
        return;
      }

      setIsLoadingSourceData(true);
      try {
        // 构建视频列表 API URL
        const originalApiUrl = source.api.endsWith('/')
          ? `${source.api}?ac=videolist&t=${category.type_id}&pg=1`
          : `${source.api}/?ac=videolist&t=${category.type_id}&pg=1`;

        // 🛡️ 全量代理：所有外部 URL 都走服务端代理（解决 Mixed Content + CORS）
        const isExternalUrl =
          originalApiUrl.startsWith('http://') ||
          originalApiUrl.startsWith('https://');
        const proxyUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;
        const fetchUrl = isExternalUrl ? proxyUrl : originalApiUrl;

        console.log('🔥 [fetchSourceCategoryData] Fetching:', fetchUrl);

        const response = await fetch(fetchUrl, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('获取分类数据失败');
        }

        const data = await response.json();
        const items = data.list || [];
        const pageCount = data.pagecount || 1;
        console.log(
          '✅ [fetchSourceCategoryData] Got',
          items.length,
          'items, pagecount:',
          pageCount,
        );

        // 转换为 DoubanItem 格式
        const convertedItems: DoubanItem[] = items.map((item: any) => ({
          id: item.vod_id?.toString() || '',
          title: item.vod_name || '',
          poster: item.vod_pic || '',
          rating: 0,
          year: item.vod_year || '',
          subtitle: item.vod_remarks || '',
        }));

        setSourceData(convertedItems);
        // FIX: 首次加载时 pg=1，判断是否有更多应该是 pageCount > 1
        setSourceHasMore(pageCount > 1);
      } catch (error) {
        console.error('获取源分类数据失败:', error);
        setSourceData([]);
      } finally {
        setIsLoadingSourceData(false);
        setLoading(false);
      }
    },
    [currentSource, sources],
  );

  // 处理数据源切换 - 实现链式自动选中逻辑
  const handleSourceChange = useCallback(
    async (sourceKey: string) => {
      if (sourceKey === currentSource) return;

      // === Step 1: 立即重置所有状态，防止状态污染 ===
      setLoading(true);
      setDoubanData([]); // 清空豆瓣数据
      setSourceData([]); // 清空源数据
      setSourceHasMore(false);
      setSourceLoadingMore(false);
      setSourcePage(1);
      setSelectedSourceCategory(null); // 清除旧分类ID，防止污染
      setFilteredSourceCategories([]); // 清空过滤后分类列表
      setIsLoadingSourceData(false);

      // === Step 2: 切换源状态 ===
      setCurrentSource(sourceKey);

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
          fetchSourceCategoryData(firstCategory);
        } catch (err) {
          console.error('🔥 [Debug] Fetch error:', err);
          setFilteredSourceCategories([]); // 出错时清空
          setLoading(false);
        }
      }
    },
    [currentSource, setCurrentSource, type, sources, fetchSourceCategoryData],
  );

  // 处理源分类切换
  const handleSourceCategoryChange = useCallback(
    (category: SourceCategory) => {
      if (selectedSourceCategory?.type_id !== category.type_id) {
        setLoading(true);
        setSourcePage(1);
        setSourceData([]);
        setSourceHasMore(false);
        setSourceLoadingMore(false);
        setSelectedSourceCategory(category);
        // 触发源分类数据加载
        fetchSourceCategoryData(category);
      }
    },
    [selectedSourceCategory, fetchSourceCategoryData],
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
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
              <DoubanSelector
                type={type as 'movie' | 'tv' | 'show' | 'anime'}
                primarySelection={primarySelection}
                secondarySelection={secondarySelection}
                onPrimaryChange={handlePrimaryChange}
                onSecondaryChange={handleSecondaryChange}
                onMultiLevelChange={handleMultiLevelChange}
                onWeekdayChange={handleWeekdayChange}
                // 数据源相关 props
                sources={sources}
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
                isLoadingSources={isLoadingSources}
                isLoadingCategories={isLoadingCategories}
                onSourceChange={handleSourceChange}
                onSourceCategoryChange={handleSourceCategoryChange}
                selectedSourceCategory={selectedSourceCategory}
              />
            </div>
          ) : (
            <div className='bg-white/60 dark:bg-gray-800/40 rounded-2xl p-4 sm:p-6 border border-gray-200/30 dark:border-gray-700/30 backdrop-blur-sm'>
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

        {/* 内容展示区域 - 使用 VirtualGrid + Window 全局滚动 */}
        <div className='max-w-[95%] mx-auto mt-8'>
          {loading || isLoadingSourceData || !selectorsReady ? (
            // 显示骨架屏
            <div className='grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
              {skeletonData.map((index) => (
                <DoubanCardSkeleton key={index} />
              ))}
            </div>
          ) : currentSource !== 'auto' && sourceData.length > 0 ? (
            // 显示源分类数据 - 使用 VirtualGrid (支持源模式分页)
            <VirtualGrid
              items={sourceData}
              priorityCount={12}
              hasMore={sourceHasMore}
              isLoadingMore={sourceLoadingMore}
              onLoadMore={handleSourceLoadMore}
              renderItem={(item, priority, index) => (
                <div
                  key={`source-${item.id}-${index}`}
                  className='w-full h-full'
                >
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''}
                    priority={priority}
                  />
                </div>
              )}
            />
          ) : currentSource !== 'auto' && selectedSourceCategory ? (
            // 选择了源分类但没有数据
            <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
              <p>该分类暂无数据</p>
              <p className='text-sm mt-2'>请尝试选择其他分类</p>
            </div>
          ) : currentSource !== 'auto' && !selectedSourceCategory ? (
            // 选择了源但未选择分类
            <div className='text-center py-12 text-gray-500 dark:text-gray-400'>
              <p>请选择一个分类</p>
              <p className='text-sm mt-2'>从上方分类列表中选择</p>
            </div>
          ) : (
            // 显示豆瓣数据 - 使用 VirtualGrid + 无限滚动
            <VirtualGrid
              items={doubanData}
              priorityCount={12}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={handleLoadMore}
              renderItem={(item, priority, index) => (
                <div key={`${item.title}-${index}`} className='w-full h-full'>
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''}
                    isBangumi={
                      type === 'anime' && primarySelection === '每日放送'
                    }
                    priority={priority}
                  />
                </div>
              )}
            />
          )}

          {/* 没有更多数据提示 */}
          {!hasMore && doubanData.length > 0 && currentSource === 'auto' && (
            <div className='text-center text-gray-500 py-4'>已加载全部内容</div>
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
