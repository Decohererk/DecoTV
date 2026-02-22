'use client';

import { ChevronLeft, ChevronRight, User } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';

import type { DoubanCelebrity, DoubanMovieDetail } from '@/hooks/useDoubanInfo';

import ExternalImage from '@/components/ExternalImage';

// ============================================================================
// Types
// ============================================================================

interface MovieMetaInfoProps {
  /** 豆瓣详情数据 */
  detail: DoubanMovieDetail | null;
  /** 是否正在加载 */
  loading?: boolean;
  /** 是否显示演员表 */
  showCast?: boolean;
  /** 是否显示简介 */
  showSummary?: boolean;
  /** 是否显示标签 */
  showTags?: boolean;
}

// ============================================================================
// Sub Components
// ============================================================================

/**
 * 元数据标签组件
 */
const MetaTags = memo(function MetaTags({
  genres,
  countries,
  year,
  durations,
}: {
  genres?: string[];
  countries?: string[];
  year?: string;
  durations?: string[];
}) {
  const allTags = [
    ...(year ? [year] : []),
    ...(genres || []),
    ...(countries || []),
    ...(durations || []),
  ];

  if (allTags.length === 0) return null;

  return (
    <div className='flex flex-wrap gap-2'>
      {allTags.map((tag, index) => (
        <span
          key={`${tag}-${index}`}
          className='inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors'
        >
          {tag}
        </span>
      ))}
    </div>
  );
});

/**
 * 演员/导演头像卡片
 */
const CelebrityCard = memo(function CelebrityCard({
  celebrity,
  role,
}: {
  celebrity: DoubanCelebrity;
  role?: string;
}) {
  const [imageError, setImageError] = useState(false);
  const avatarUrl = celebrity.avatars?.medium || celebrity.avatars?.small;

  return (
    <div className='flex flex-col items-center shrink-0 w-20'>
      {/* 头像 */}
      <div className='relative w-16 h-16 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 border-2 border-gray-100 dark:border-gray-600 shadow-md'>
        {avatarUrl && !imageError ? (
          <ExternalImage
            src={avatarUrl}
            alt={celebrity.name}
            fill
            className='object-cover'
            referrerPolicy='no-referrer'
            onError={() => setImageError(true)}
            sizes='64px'
          />
        ) : (
          <div className='w-full h-full flex items-center justify-center'>
            <User className='w-8 h-8 text-gray-400 dark:text-gray-500' />
          </div>
        )}
      </div>

      {/* 姓名 */}
      <p className='mt-2 text-xs font-medium text-gray-900 dark:text-gray-100 text-center truncate w-full'>
        {celebrity.name}
      </p>

      {/* 角色 */}
      {role && (
        <p className='text-xs text-gray-500 dark:text-gray-400 text-center truncate w-full'>
          {role}
        </p>
      )}
    </div>
  );
});

/**
 * 演员阵容横向滚动列表
 */
const CastSlider = memo(function CastSlider({
  directors,
  casts,
}: {
  directors?: DoubanCelebrity[];
  casts?: DoubanCelebrity[];
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(true);

  const allCelebrities = [
    ...(directors?.map((d) => ({ ...d, role: '导演' })) || []),
    ...(casts?.map((c) => ({
      ...c,
      role: c.roles?.join('/') || '演员',
    })) || []),
  ];

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setShowLeftArrow(scrollLeft > 10);
    setShowRightArrow(scrollLeft + clientWidth < scrollWidth - 10);
  }, []);

  const scroll = useCallback((direction: 'left' | 'right') => {
    if (!scrollRef.current) return;
    const scrollAmount = direction === 'left' ? -200 : 200;
    scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
  }, []);

  if (allCelebrities.length === 0) return null;

  return (
    <div className='relative'>
      {/* 标题 */}
      <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100 mb-3'>
        演员阵容
      </h3>

      {/* 滚动容器 */}
      <div className='relative'>
        {/* 左箭头 */}
        {showLeftArrow && (
          <button
            onClick={() => scroll('left')}
            className='absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-all'
            aria-label='向左滚动'
          >
            <ChevronLeft className='w-5 h-5 text-gray-600 dark:text-gray-300' />
          </button>
        )}

        {/* 右箭头 */}
        {showRightArrow && (
          <button
            onClick={() => scroll('right')}
            className='absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 shadow-lg hover:bg-white dark:hover:bg-gray-700 transition-all'
            aria-label='向右滚动'
          >
            <ChevronRight className='w-5 h-5 text-gray-600 dark:text-gray-300' />
          </button>
        )}

        {/* 演员列表 */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className='flex gap-4 overflow-x-auto pb-2 scrollbar-hide'
          style={{
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {allCelebrities.map((celebrity, index) => (
            <CelebrityCard
              key={`${celebrity.id}-${index}`}
              celebrity={celebrity}
              role={celebrity.role}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * 影片简介组件
 */
const Summary = memo(function Summary({ summary }: { summary?: string }) {
  const [expanded, setExpanded] = useState(false);

  if (!summary) return null;

  const isLong = summary.length > 200;
  const displayText = expanded ? summary : summary.slice(0, 200);

  return (
    <div className='space-y-2'>
      <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
        剧情简介
      </h3>
      <p className='text-sm text-gray-600 dark:text-gray-400 leading-relaxed'>
        {displayText}
        {!expanded && isLong && '...'}
      </p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className='text-sm text-green-600 dark:text-green-400 hover:underline'
        >
          {expanded ? '收起' : '展开全部'}
        </button>
      )}
    </div>
  );
});

/**
 * 骨架屏加载状态
 */
const Skeleton = memo(function Skeleton() {
  return (
    <div className='space-y-6 animate-pulse'>
      {/* 标签骨架 */}
      <div className='flex gap-2'>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className='h-6 w-16 bg-gray-200 dark:bg-gray-700 rounded-full'
          />
        ))}
      </div>

      {/* 演员骨架 */}
      <div>
        <div className='h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-3' />
        <div className='flex gap-4'>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className='flex flex-col items-center w-20'>
              <div className='w-16 h-16 bg-gray-200 dark:bg-gray-700 rounded-full' />
              <div className='h-3 w-12 bg-gray-200 dark:bg-gray-700 rounded mt-2' />
            </div>
          ))}
        </div>
      </div>

      {/* 简介骨架 */}
      <div>
        <div className='h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-3' />
        <div className='space-y-2'>
          <div className='h-4 w-full bg-gray-200 dark:bg-gray-700 rounded' />
          <div className='h-4 w-full bg-gray-200 dark:bg-gray-700 rounded' />
          <div className='h-4 w-3/4 bg-gray-200 dark:bg-gray-700 rounded' />
        </div>
      </div>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * 电影元信息组件
 * 包含标签、演员阵容、剧情简介
 */
function MovieMetaInfoComponent({
  detail,
  loading = false,
  showCast = true,
  showSummary = true,
  showTags = true,
}: MovieMetaInfoProps) {
  if (loading) {
    return <Skeleton />;
  }

  if (!detail) {
    return null;
  }

  return (
    <div className='space-y-6'>
      {/* 元数据标签 */}
      {showTags && (
        <MetaTags
          genres={detail.genres}
          countries={detail.countries}
          year={detail.year}
          durations={detail.durations}
        />
      )}

      {/* 演员阵容 */}
      {showCast && (
        <CastSlider directors={detail.directors} casts={detail.casts} />
      )}

      {/* 剧情简介 */}
      {showSummary && <Summary summary={detail.summary} />}
    </div>
  );
}

export const MovieMetaInfo = memo(MovieMetaInfoComponent);

export default MovieMetaInfo;
