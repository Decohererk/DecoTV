'use client';

import { ChevronLeft, ChevronRight, Film } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { memo, useCallback, useRef, useState } from 'react';

import ExternalImage from '@/components/ExternalImage';

// ============================================================================
// Types
// ============================================================================

export interface RecommendItem {
  id: string;
  title: string;
  poster?: string;
  rate?: string;
  year?: string;
  type?: string;
}

interface MovieRecommendsProps {
  /** 推荐影片列表 */
  recommends: RecommendItem[];
  /** 是否正在加载 */
  loading?: boolean;
  /** 最多显示数量 */
  maxDisplay?: number;
}

// ============================================================================
// Sub Components
// ============================================================================

/**
 * 推荐影片卡片
 */
const RecommendCard = memo(function RecommendCard({
  item,
  onClick,
}: {
  item: RecommendItem;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} className='group shrink-0 w-32 cursor-pointer'>
      {/* 封面 */}
      <div className='relative aspect-2/3 rounded-xl overflow-hidden bg-gray-200 dark:bg-gray-700 shadow-md group-hover:shadow-lg transition-all duration-200 group-hover:scale-[1.02]'>
        {item.poster ? (
          <ExternalImage
            src={item.poster}
            alt={item.title}
            fill
            className='object-cover'
            referrerPolicy='no-referrer'
            sizes='128px'
          />
        ) : (
          <div className='w-full h-full flex items-center justify-center'>
            <Film className='w-8 h-8 text-gray-400 dark:text-gray-500' />
          </div>
        )}

        {/* 评分角标 */}
        {item.rate && parseFloat(item.rate) > 0 && (
          <div className='absolute top-2 right-2 px-1.5 py-0.5 bg-yellow-500/90 backdrop-blur-sm rounded text-xs font-bold text-white'>
            {item.rate}
          </div>
        )}

        {/* 悬浮遮罩 */}
        <div className='absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors' />
      </div>

      {/* 标题 */}
      <div className='mt-2 px-1'>
        <h4 className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
          {item.title}
        </h4>
        {item.year && (
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
            {item.year}
          </p>
        )}
      </div>
    </div>
  );
});

/**
 * 骨架屏
 */
const RecommendSkeleton = memo(function RecommendSkeleton() {
  return (
    <div className='shrink-0 w-32 animate-pulse'>
      <div className='aspect-2/3 rounded-xl bg-gray-200 dark:bg-gray-700' />
      <div className='mt-2 px-1 space-y-1'>
        <div className='h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4' />
        <div className='h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2' />
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export const MovieRecommends = memo(function MovieRecommends({
  recommends,
  loading = false,
  maxDisplay = 10,
}: MovieRecommendsProps) {
  const router = useRouter();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // 检查滚动状态
  const checkScrollState = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    setCanScrollLeft(container.scrollLeft > 0);
    setCanScrollRight(
      container.scrollLeft < container.scrollWidth - container.clientWidth - 10,
    );
  }, []);

  // 滚动处理
  const handleScroll = useCallback(
    (direction: 'left' | 'right') => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const scrollAmount = direction === 'left' ? -300 : 300;
      container.scrollBy({ left: scrollAmount, behavior: 'smooth' });

      // 延迟检查滚动状态
      setTimeout(checkScrollState, 300);
    },
    [checkScrollState],
  );

  // 点击推荐影片
  const handleClick = useCallback(
    (item: RecommendItem) => {
      // 跳转到搜索页
      const searchParams = new URLSearchParams();
      searchParams.set('q', item.title);
      if (item.year) {
        searchParams.set('year', item.year);
      }
      router.push(`/search?${searchParams.toString()}`);
    },
    [router],
  );

  // 如果没有推荐且不在加载中，不显示
  if (!loading && recommends.length === 0) {
    return null;
  }

  const displayItems = recommends.slice(0, maxDisplay);

  return (
    <div className='relative'>
      {/* 标题 */}
      <div className='flex items-center justify-between mb-4'>
        <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
          <Film className='w-5 h-5 text-green-500' />
          相关推荐
        </h3>

        {/* 滚动按钮 */}
        {displayItems.length > 4 && (
          <div className='flex gap-2'>
            <button
              onClick={() => handleScroll('left')}
              disabled={!canScrollLeft}
              className='p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
            >
              <ChevronLeft className='w-4 h-4' />
            </button>
            <button
              onClick={() => handleScroll('right')}
              disabled={!canScrollRight}
              className='p-1.5 rounded-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors'
            >
              <ChevronRight className='w-4 h-4' />
            </button>
          </div>
        )}
      </div>

      {/* 滚动容器 */}
      <div
        ref={scrollContainerRef}
        onScroll={checkScrollState}
        className='flex gap-4 overflow-x-auto scrollbar-hide pb-2 -mx-1 px-1'
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {loading
          ? // 加载骨架屏
            Array.from({ length: 6 }).map((_, i) => (
              <RecommendSkeleton key={i} />
            ))
          : // 推荐列表
            displayItems.map((item) => (
              <RecommendCard
                key={item.id}
                item={item}
                onClick={() => handleClick(item)}
              />
            ))}
      </div>

      {/* 渐变遮罩 */}
      {canScrollRight && displayItems.length > 4 && (
        <div className='absolute right-0 top-12 bottom-0 w-12 bg-linear-to-l from-white dark:from-gray-900 to-transparent pointer-events-none' />
      )}
    </div>
  );
});

export default MovieRecommends;
