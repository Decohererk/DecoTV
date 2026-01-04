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
import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
// Integrated VirtualGrid to render 1000+ items with 60FPS performance.
import VirtualGrid from '@/components/VirtualGrid';

function DoubanPageClient() {
  const searchParams = useSearchParams();
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [selectorsReady, setSelectorsReady] = useState(false);
  // observerRef 和 loadingRef 已移除 - 使用 VirtualGrid 内部触底检测
  const debounceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 用于存储最新参数值的 refs（防止竞态）
  const currentParamsRef = useRef({
    type: '',
    primarySelection: '',
    secondarySelection: '',
    multiLevelSelection: {} as Record<string, string>,
    selectedWeekday: '',
    currentPage: 0,
  });

  const type = searchParams.get('type') || 'movie';

  // 自定义分类数据
  const [customCategories, setCustomCategories] = useState<
    Array<{ name: string; type: 'movie' | 'tv'; query: string }>
  >([]);

  // 选择器状态（完全独立，不依赖URL）
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

  // 多级筛选器状态
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

  // 星期选择器（仅动漫每日放送使用）
  const [selectedWeekday, setSelectedWeekday] = useState<string>('');

  // 获取自定义分类

  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setCustomCategories(runtimeConfig.CUSTOM_CATEGORIES);
    }
  }, []);

  // 同步参数到 ref
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

  // 组件挂载后短暂延迟标记选择器准备就绪
  useEffect(() => {
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, []);

  // type 变化时立即显示 loading 并重置选择器准备状态
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
  }, [type]);

  // type 变化时重置选择器默认值
  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type)),
      );
      let selectedType = types.includes('movie') ? 'movie' : types[0] || 'tv';
      setPrimarySelection(selectedType);

      const firstCategory = customCategories.find(
        (cat) => cat.type === selectedType,
      );
      if (firstCategory) {
        setSecondarySelection(firstCategory.query);
      }
    } else {
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

    // 重置多级筛选
    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });

    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);
    return () => clearTimeout(timer);
  }, [type, customCategories]);

  // 骨架屏
  const skeletonData = Array.from({ length: 25 }, (_, i) => i);

  // 参数比较（防止竞态）
  const isSnapshotEqual = useCallback(
    (s1: any, s2: any) =>
      s1.type === s2.type &&
      s1.primarySelection === s2.primarySelection &&
      s1.secondarySelection === s2.secondarySelection &&
      s1.selectedWeekday === s2.selectedWeekday &&
      s1.currentPage === s2.currentPage &&
      JSON.stringify(s1.multiLevelSelection) ===
        JSON.stringify(s2.multiLevelSelection),
    [],
  );

  // 生成请求参数
  const getRequestParams = useCallback(
    (pageStart: number) => {
      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: secondarySelection,
          pageLimit: 25,
          pageStart,
        };
      }
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

  // 加载初始数据（防抖）
  const loadInitialData = useCallback(async () => {
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

    // 尝试从缓存读取
    const cachedData = globalCache.get<DoubanItem[]>(cacheKey);
    if (cachedData && cachedData.length > 0) {
      console.log(`[DoubanPage] 缓存命中: ${cacheKey}`);
      setDoubanData(cachedData);
      setLoading(false);
      setHasMore(cachedData.length >= 25);
      return;
    }

    try {
      setLoading(true);
      setDoubanData([]);
      setCurrentPage(0);
      setHasMore(true);
      setIsLoadingMore(false);

      let data: DoubanResult;

      if (type === 'custom') {
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection,
        );
        if (!selectedCategory) throw new Error('没有找到对应分类');
        data = await getDoubanList({
          tag: selectedCategory.query,
          type: selectedCategory.type,
          pageLimit: 25,
          pageStart: 0,
        });
      } else if (type === 'anime' && primarySelection === '每日放送') {
        const calendarData = await GetBangumiCalendarData();
        const weekdayData = calendarData.find(
          (item) => item.weekday.en === selectedWeekday,
        );
        if (!weekdayData) throw new Error('没有找到对应日期');
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
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: 25,
          pageStart: 0,
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
          pageLimit: 25,
          pageStart: 0,
          category: multiLevelValues.type || '',
          format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
          region: multiLevelValues.region || '',
          year: multiLevelValues.year || '',
          platform: multiLevelValues.platform || '',
          sort: multiLevelValues.sort || '',
          label: multiLevelValues.label || '',
        });
      } else {
        data = await getDoubanCategories(getRequestParams(0));
      }

      if (data.code === 200) {
        if (isSnapshotEqual(requestSnapshot, currentParamsRef.current)) {
          setDoubanData(data.list);
          setHasMore(data.list.length > 0);
          setLoading(false);
        }
      } else {
        throw new Error(data.message || '获取数据失败');
      }
    } catch (err) {
      console.error(err);
      setLoading(false);
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

  // 选择器准备好后防抖加载数据
  useEffect(() => {
    if (!selectorsReady) return;

    if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);

    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, 100);

    return () => {
      if (debounceTimeoutRef.current) clearTimeout(debounceTimeoutRef.current);
    };
  }, [
    selectorsReady,
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    loadInitialData,
  ]);

  // 加载更多
  useEffect(() => {
    if (currentPage === 0) return;

    const fetchMore = async () => {
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
          const selectedCategory = customCategories.find(
            (cat) =>
              cat.type === primarySelection && cat.query === secondarySelection,
          );
          if (!selectedCategory) throw new Error('没有找到对应分类');
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: 25,
            pageStart: currentPage * 25,
          });
        } else if (type === 'anime' && primarySelection === '每日放送') {
          data = { code: 200, message: 'success', list: [] };
        } else if (type === 'anime') {
          data = await getDoubanRecommends({
            kind: primarySelection === '番剧' ? 'tv' : 'movie',
            pageLimit: 25,
            pageStart: currentPage * 25,
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
            pageLimit: 25,
            pageStart: currentPage * 25,
            category: multiLevelValues.type || '',
            format: type === 'show' ? '综艺' : type === 'tv' ? '电视剧' : '',
            region: multiLevelValues.region || '',
            year: multiLevelValues.year || '',
            platform: multiLevelValues.platform || '',
            sort: multiLevelValues.sort || '',
            label: multiLevelValues.label || '',
          });
        } else {
          data = await getDoubanCategories(getRequestParams(currentPage * 25));
        }

        if (data.code === 200) {
          if (isSnapshotEqual(requestSnapshot, currentParamsRef.current)) {
            setDoubanData((prev) => [...prev, ...data.list]);
            setHasMore(data.list.length > 0);
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsLoadingMore(false);
      }
    };

    fetchMore();
  }, [currentPage, type, primarySelection, secondarySelection, multiLevelValues, selectedWeekday, customCategories, getRequestParams, isSnapshotEqual]);

  // 无限滚动观察器
  useEffect(() => {
    if (!hasMore || isLoadingMore || loading || !loadingRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          setCurrentPage((p) => p + 1);
        }
      },
      { threshold: 0.1 },
    );

    observer.observe(loadingRef.current);
    observerRef.current = observer;

    return () => observerRef.current?.disconnect();
  }, [hasMore, isLoadingMore, loading]);

  // 选择器回调
  const handlePrimaryChange = useCallback((value: string) => {
    if (value === primarySelection) return;
    setLoading(true);
    setCurrentPage(0);
    setDoubanData([]);
    setHasMore(true);
    setMultiLevelValues({
      type: 'all',
      region: 'all',
      year: 'all',
      platform: 'all',
      label: 'all',
      sort: 'T',
    });

    if (type === 'custom' && customCategories.length > 0) {
      const first = customCategories.find((cat) => cat.type === value);
      setPrimarySelection(value);
      if (first) setSecondarySelection(first.query);
    } else if ((type === 'tv' || type === 'show') && value === '最近热门') {
      setPrimarySelection(value);
      setSecondarySelection(type === 'tv' ? 'tv' : 'show');
    } else {
      setPrimarySelection(value);
    }
  }, [primarySelection, type, customCategories]);

  const handleSecondaryChange = useCallback((value: string) => {
    if (value === secondarySelection) return;
    setLoading(true);
    setCurrentPage(0);
    setDoubanData([]);
    setHasMore(true);
    setSecondarySelection(value);
  }, [secondarySelection]);

  const handleMultiLevelChange = useCallback((values: Record<string, string>) => {
    const isEqual = JSON.stringify(values) === JSON.stringify(multiLevelValues);
    if (isEqual) return;
    setLoading(true);
    setCurrentPage(0);
    setDoubanData([]);
    setHasMore(true);
    setMultiLevelValues(values);
  }, [multiLevelValues]);

  const handleWeekdayChange = useCallback((weekday: string) => {
    setSelectedWeekday(weekday);
  }, []);

  const getPageTitle = () => {
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
    return `/douban${params.toString() ? `?${params.toString()}` : ''}`;
  };

  return (
    <PageLayout activePath={getActivePath()}>
      <div className='px-4 sm:px-10 py-4 sm:py-8 overflow-visible'>
        <div className='mb-6 sm:mb-8 space-y-4 sm:space-y-6'>
          <div>
            <h1 className='text-2xl sm:text-3xl font-bold text-gray-800 mb-1 sm:mb-2 dark:text-gray-200'>
              {getPageTitle()}
            </h1>
            <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400'>
              {getPageDescription()}
            </p>
          </div>

          {/* 选择器区域 */}
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
                // 已移除所有数据源相关 props，彻底隐藏数据源切换栏
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

        {/* 内容区域 */}
        <div className='max-w-[95%] mx-auto mt-8 overflow-visible'>
          <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
            {loading || !selectorsReady ? (
              skeletonData.map((i) => <DoubanCardSkeleton key={i} />)
            ) : (
              doubanData.map((item, index) => (
                <div key={`${item.title}-${index}`} className='w-full'>
                  <VideoCard
                    from='douban'
                    title={item.title}
                    poster={item.poster}
                    douban_id={Number(item.id)}
                    rate={item.rate}
                    year={item.year}
                    type={type === 'movie' ? 'movie' : ''}
                    isBangumi={type === 'anime' && primarySelection === '每日放送'}
                  />
                </div>
              ))
            )}
          </div>

          {/* 加载更多 */}
          {hasMore && !loading && (
            <div
              ref={(el) => {
                if (el && el.offsetParent !== null) {
                  loadingRef.current = el;
                }
              }}
              className='flex justify-center mt-12 py-8'
            >
              {isLoadingMore && (
                <div className='flex items-center gap-2'>
                  <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                  <span className='text-gray-600'>加载中...</span>
                </div>
              )}
            </div>
          )}

          {!hasMore && doubanData.length > 0 && (
            <div className='text-center text-gray-500 py-8'>已加载全部内容</div>
          )}

          {!loading && doubanData.length === 0 && (
            <div className='text-center text-gray-500 py-8'>暂无相关内容</div>
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
