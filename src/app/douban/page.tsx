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

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import DoubanCustomSelector from '@/components/DoubanCustomSelector';
import DoubanSelector from '@/components/DoubanSelector';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';
import VirtualGrid from '@/components/VirtualGrid';

function DoubanPageClient() {
  const searchParams = useSearchParams();

  // 🔧 统一分页常量 - 防止分页步长不一致导致重复数据
  const PAGE_SIZE = 50;

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

  // 豆瓣数据状态管理
  const [doubanData, setDoubanData] = useState<DoubanItem[]>([]);

  // 豆瓣模式加载状态
  const [loading, setLoading] = useState(false);

  // 豆瓣模式分页状态 (SmoneTV Pattern) - 使用动态偏移，不再需要 currentPage
  const [hasMore, setHasMore] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const [selectorsReady, setSelectorsReady] = useState(false);
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

  // 【性能优化】预加载首屏图片
  const imageUrls = useMemo(
    () =>
      doubanData
        .slice(0, 12)
        .map((item) => item.poster)
        .filter(Boolean),
    [doubanData],
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
    const timer = setTimeout(() => {
      setSelectorsReady(true);
    }, 50);

    return () => clearTimeout(timer);
  }, []);

  // type变化时立即重置selectorsReady（最高优先级）
  useEffect(() => {
    setSelectorsReady(false);
    setLoading(true);
  }, [type]);

  // 当type变化时重置选择器状态
  useEffect(() => {
    if (type === 'custom' && customCategories.length > 0) {
      const types = Array.from(
        new Set(customCategories.map((cat) => cat.type)),
      );
      if (types.length > 0) {
        let selectedType = types.includes('movie') ? 'movie' : types[0];
        setPrimarySelection(selectedType);

        const firstCategory = customCategories.find(
          (cat) => cat.type === selectedType,
        );
        if (firstCategory) {
          setSecondarySelection(firstCategory.query);
        }
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
      const safeCategory =
        CATEGORY_MAPPING[primarySelection] || primarySelection;
      const safeType = TYPE_MAPPING[secondarySelection] || secondarySelection;

      if (type === 'tv' || type === 'show') {
        return {
          kind: 'tv' as const,
          category: type,
          type: safeType,
          pageLimit: PAGE_SIZE,
          pageStart,
        };
      }

      return {
        kind: type as 'tv' | 'movie',
        category: safeCategory,
        type: safeType,
        pageLimit: PAGE_SIZE,
        pageStart,
      };
    },
    [type, primarySelection, secondarySelection],
  );

  // 防抖的数据加载函数 - 缓存优先
  const loadInitialData = useCallback(async () => {
    const requestSnapshot = {
      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
    };

    const cacheKey = generateCacheKey('douban', {
      type,
      primary: primarySelection,
      secondary: secondarySelection,
      weekday: type === 'anime' ? selectedWeekday : '',
      ...multiLevelValues,
    });

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
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection,
        );

        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: PAGE_SIZE,
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
          pageLimit: PAGE_SIZE,
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
          pageLimit: 50,
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
        const currentSnapshot = { ...currentParamsRef.current };

        if (isSnapshotEqual(requestSnapshot, currentSnapshot)) {
          setDoubanData(data.list);
          setHasMore(data.list.length >= 50);
          setCurrentPage(0);

          setLoading(false);

          if (data.list.length > 0) {
            globalCache.set(cacheKey, data.list, 3600);
            console.log(`[DoubanPage] 缓存写入: ${cacheKey}`);
          }
        } else {
          console.log('参数不一致，不执行任何操作，避免设置过期数据');
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
  ]);

  // SmoneTV Pattern: 无限滚动加载更多数据
  const fetchMoreData = useCallback(async () => {
    if (isLoadingMore || !hasMore) {
      return;
    }


    const requestSnapshot = {

      type,
      primarySelection,
      secondarySelection,
      multiLevelSelection: multiLevelValues,
      selectedWeekday,
    };


    currentParamsRef.current = {
      type: requestSnapshot.type,
      primarySelection: requestSnapshot.primarySelection,
      secondarySelection: requestSnapshot.secondarySelection,
      multiLevelSelection: requestSnapshot.multiLevelSelection,
      selectedWeekday: requestSnapshot.selectedWeekday,
    };


    try {
      setIsLoadingMore(true);
      console.log(`📍 [fetchMoreData] Requesting from offset: ${pageStart}`);

      let data: DoubanResult;



      if (type === 'custom') {
        const selectedCategory = customCategories.find(
          (cat) =>
            cat.type === primarySelection && cat.query === secondarySelection,
        );
        if (selectedCategory) {
          data = await getDoubanList({
            tag: selectedCategory.query,
            type: selectedCategory.type,
            pageLimit: PAGE_SIZE,
            pageStart,
          });
        } else {
          throw new Error('没有找到对应的分类');
        }
      } else if (type === 'anime' && primarySelection === '每日放送') {
        data = { code: 200, message: 'success', list: [] };
      } else if (type === 'anime') {
        data = await getDoubanRecommends({
          kind: primarySelection === '番剧' ? 'tv' : 'movie',
          pageLimit: PAGE_SIZE,
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
          pageLimit: PAGE_SIZE,
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
        data = await getDoubanCategories(getRequestParams(pageStart));
      }

      if (data.code === 200) {

        const currentSnapshot = { ...currentParamsRef.current };
        const isMatch =
          requestSnapshot.type === currentSnapshot.type &&
          requestSnapshot.primarySelection ===
            currentSnapshot.primarySelection &&
          requestSnapshot.secondarySelection ===
            currentSnapshot.secondarySelection;

        if (isMatch && data.list.length > 0) {

          console.log(
            '✅ [fetchMoreData] Appending',
            data.list.length,
            'items to existing',
            doubanData.length,
          );

          // 🔧 双重锁定去重: 检查 New vs Old + New vs New (API内部重复)
          setDoubanData((prev) => {
            const existingIds = new Set(prev.map((item) => item.id));
            const uniqueNewItems: DoubanItem[] = [];

            for (const item of data.list) {
              // Check 1: 不在现有列表中
              // Check 2: 不在本批次已添加的项中 (修复 API 返回内部重复)
              if (!existingIds.has(item.id)) {
                existingIds.add(item.id); // 立即添加到 Set，阻止后续重复
                uniqueNewItems.push(item);
              }
            }

            console.log(
              `   📊 Batch: ${data.list.length}, Added: ${uniqueNewItems.length}, Duplicates removed: ${data.list.length - uniqueNewItems.length}`,
            );

            // 如果没有新数据，返回原数组避免不必要的重渲染
            if (uniqueNewItems.length === 0) return prev;
            return [...prev, ...uniqueNewItems];
          });

          // ✅ 宽松的 hasMore 条件: 只要返回了数据就继续
          setHasMore(data.list.length > 0);
        } else if (!isFilterMatch) {
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
    type,
    primarySelection,
    secondarySelection,
    multiLevelValues,
    selectedWeekday,
    customCategories,
    doubanData.length,
    getRequestParams,
    PAGE_SIZE,
  ]);

  // VirtualGrid 触底回调
  const handleLoadMore = useCallback(() => {
    if (!hasMore || isLoadingMore || loading) {
      return;
    }
    fetchMoreData();
  }, [hasMore, isLoadingMore, loading, fetchMoreData]);

  // 只在选择器准备好后才加载数据
  useEffect(() => {
    if (!selectorsReady) return;


    setCurrentPage(0);

    setHasMore(true);
    setIsLoadingMore(false);

    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }

    debounceTimeoutRef.current = setTimeout(() => {
      loadInitialData();
    }, 100);

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
  ]);

  // 处理选择器变化
  const handlePrimaryChange = useCallback(
    (value: string) => {
      if (value !== primarySelection) {
        setLoading(true);
        setDoubanData([]);
        setMultiLevelValues({
          type: 'all',
          region: 'all',
          year: 'all',
          platform: 'all',
          label: 'all',
          sort: 'T',
        });

        if (type === 'custom' && customCategories.length > 0) {
          const firstCategory = customCategories.find(
            (cat) => cat.type === value,
          );
          if (firstCategory) {
            setPrimarySelection(value);
            setSecondarySelection(firstCategory.query);
          } else {
            setPrimarySelection(value);
          }
        } else {
          if ((type === 'tv' || type === 'show') && value === '最近热门') {
            setPrimarySelection(value);
            setSecondarySelection(type === 'tv' ? 'tv' : 'show');
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
      const isEqual = (
        obj1: Record<string, string>,
        obj2: Record<string, string>,
      ) => {
        const keys1 = Object.keys(obj1).sort();
        const keys2 = Object.keys(obj2).sort();
        if (keys1.length !== keys2.length) return false;
        return keys1.every((key) => obj1[key] === obj2[key]);
      };

      if (isEqual(values, multiLevelValues)) return;

      setLoading(true);
      setDoubanData([]);
      setMultiLevelValues(values);
    },
    [multiLevelValues],
  );

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
    const queryString = params.toString();
    return `/douban${queryString ? `?${queryString}` : ''}`;
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

          {/* 选择器组件 - 已移除所有数据源相关 props */}
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

        <div className='max-w-[95%] mx-auto mt-8'>
          {loading || !selectorsReady ? (
            <div className='grid grid-cols-3 gap-x-2 gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-8 sm:gap-y-20'>
              {skeletonData.map((index) => (
                <DoubanCardSkeleton key={index} />
              ))}
            </div>

          ) : (
            <VirtualGrid
              items={doubanData}
              priorityCount={12}
              hasMore={hasMore}
              isLoadingMore={isLoadingMore}
              onLoadMore={handleLoadMore}
              renderItem={(item, priority) => (
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
              )}
            />
          )}

          {/* 没有更多数据提示 */}
          {!hasMore && doubanData.length > 0 && (
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
