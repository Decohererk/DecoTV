'use client';

import { ChevronLeft, ChevronRight, LoaderCircle, User } from 'lucide-react';
import { memo, useCallback, useRef, useState } from 'react';

import type { DoubanCelebrity, DoubanMovieDetail } from '@/hooks/useDoubanInfo';

import ExternalImage from '@/components/ExternalImage';

interface MovieMetaInfoProps {
  detail: DoubanMovieDetail | null;
  loading?: boolean;
  showCast?: boolean;
  showSummary?: boolean;
  showTags?: boolean;
  primarySummaryLabel?: string;
  secondarySummary?: string;
  secondarySummaryLabel?: string;
  secondarySummaryLoading?: boolean;
}

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
          className='inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
        >
          {tag}
        </span>
      ))}
    </div>
  );
});

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
    <div className='flex w-20 shrink-0 flex-col items-center'>
      <div className='relative h-16 w-16 overflow-hidden rounded-full border-2 border-gray-100 bg-gray-200 shadow-md dark:border-gray-600 dark:bg-gray-700'>
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
          <div className='flex h-full w-full items-center justify-center'>
            <User className='h-8 w-8 text-gray-400 dark:text-gray-500' />
          </div>
        )}
      </div>

      <p className='mt-2 w-full truncate text-center text-xs font-medium text-gray-900 dark:text-gray-100'>
        {celebrity.name}
      </p>

      {role ? (
        <p className='w-full truncate text-center text-xs text-gray-500 dark:text-gray-400'>
          {role}
        </p>
      ) : null}
    </div>
  );
});

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
    ...(directors?.map((director) => ({ ...director, role: '导演' })) || []),
    ...(casts?.map((cast) => ({
      ...cast,
      role: cast.roles?.join('/') || '演员',
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
    scrollRef.current.scrollBy({
      left: direction === 'left' ? -200 : 200,
      behavior: 'smooth',
    });
  }, []);

  if (allCelebrities.length === 0) return null;

  return (
    <div className='relative'>
      <h3 className='mb-3 text-base font-semibold text-gray-900 dark:text-gray-100'>
        演职员
      </h3>

      <div className='relative'>
        {showLeftArrow ? (
          <button
            onClick={() => scroll('left')}
            className='absolute left-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/90 shadow-lg backdrop-blur-sm transition-all hover:bg-white dark:border-gray-700 dark:bg-gray-800/90 dark:hover:bg-gray-700'
            aria-label='向左滚动演职员'
          >
            <ChevronLeft className='h-5 w-5 text-gray-600 dark:text-gray-300' />
          </button>
        ) : null}

        {showRightArrow ? (
          <button
            onClick={() => scroll('right')}
            className='absolute right-0 top-1/2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-gray-200 bg-white/90 shadow-lg backdrop-blur-sm transition-all hover:bg-white dark:border-gray-700 dark:bg-gray-800/90 dark:hover:bg-gray-700'
            aria-label='向右滚动演职员'
          >
            <ChevronRight className='h-5 w-5 text-gray-600 dark:text-gray-300' />
          </button>
        ) : null}

        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className='scrollbar-hide flex gap-4 overflow-x-auto pb-2'
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
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

const Summary = memo(function Summary({
  summary,
  primarySummaryLabel = '豆瓣简介',
  secondarySummary,
  secondarySummaryLabel = 'TMDB 简介',
  secondarySummaryLoading = false,
}: {
  summary?: string;
  primarySummaryLabel?: string;
  secondarySummary?: string;
  secondarySummaryLabel?: string;
  secondarySummaryLoading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const normalizedPrimary = (summary || '').trim();
  const normalizedSecondary = (secondarySummary || '').trim();
  const hasPrimary = Boolean(normalizedPrimary);
  const hasSecondary = Boolean(normalizedSecondary);

  const tabs = [
    hasPrimary
      ? {
          key: 'primary' as const,
          label: primarySummaryLabel,
          value: normalizedPrimary,
        }
      : null,
    hasSecondary || secondarySummaryLoading
      ? {
          key: 'secondary' as const,
          label: secondarySummaryLabel,
          value: normalizedSecondary,
        }
      : null,
  ].filter(Boolean) as Array<{
    key: 'primary' | 'secondary';
    label: string;
    value: string;
  }>;

  const [activeTab, setActiveTab] = useState<'primary' | 'secondary'>(
    hasPrimary ? 'primary' : 'secondary',
  );

  if (tabs.length === 0) {
    return null;
  }

  const currentTab = tabs.find((tab) => tab.key === activeTab) || tabs[0];
  const isSecondaryActive = currentTab.key === 'secondary';
  const isLoading =
    isSecondaryActive && secondarySummaryLoading && !currentTab.value;
  const currentSummary = currentTab.value;

  if (!currentSummary && !isLoading) {
    return null;
  }

  const isLong = currentSummary.length > 200;
  const displayText = expanded ? currentSummary : currentSummary.slice(0, 200);

  return (
    <div className='space-y-2'>
      <div className='flex items-center justify-between gap-3'>
        <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
          剧情简介
        </h3>
        {tabs.length > 1 ? (
          <div className='inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-800'>
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type='button'
                onClick={() => {
                  setActiveTab(tab.key);
                  setExpanded(false);
                }}
                className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                  currentTab.key === tab.key
                    ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <div className='flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400'>
          <LoaderCircle className='h-4 w-4 animate-spin' />
          <span>TMDB 简介加载中…</span>
        </div>
      ) : (
        <>
          <p className='text-sm leading-relaxed text-gray-600 dark:text-gray-400'>
            {displayText}
            {!expanded && isLong ? '...' : ''}
          </p>
          {isLong ? (
            <button
              onClick={() => setExpanded((prev) => !prev)}
              className='text-sm text-green-600 hover:underline dark:text-green-400'
            >
              {expanded ? '收起' : '展开更多'}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
});

const Skeleton = memo(function Skeleton() {
  return (
    <div className='animate-pulse space-y-6'>
      <div className='flex gap-2'>
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className='h-6 w-16 rounded-full bg-gray-200 dark:bg-gray-700'
          />
        ))}
      </div>

      <div>
        <div className='mb-3 h-5 w-20 rounded bg-gray-200 dark:bg-gray-700' />
        <div className='flex gap-4'>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className='flex w-20 flex-col items-center'>
              <div className='h-16 w-16 rounded-full bg-gray-200 dark:bg-gray-700' />
              <div className='mt-2 h-3 w-12 rounded bg-gray-200 dark:bg-gray-700' />
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className='mb-3 h-5 w-20 rounded bg-gray-200 dark:bg-gray-700' />
        <div className='space-y-2'>
          <div className='h-4 w-full rounded bg-gray-200 dark:bg-gray-700' />
          <div className='h-4 w-full rounded bg-gray-200 dark:bg-gray-700' />
          <div className='h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700' />
        </div>
      </div>
    </div>
  );
});

function MovieMetaInfoComponent({
  detail,
  loading = false,
  showCast = true,
  showSummary = true,
  showTags = true,
  primarySummaryLabel = '豆瓣简介',
  secondarySummary,
  secondarySummaryLabel = 'TMDB 简介',
  secondarySummaryLoading = false,
}: MovieMetaInfoProps) {
  if (loading) {
    return <Skeleton />;
  }

  if (!detail) {
    return null;
  }

  return (
    <div className='space-y-6'>
      {showTags ? (
        <MetaTags
          genres={detail.genres}
          countries={detail.countries}
          year={detail.year}
          durations={detail.durations}
        />
      ) : null}

      {showCast ? (
        <CastSlider directors={detail.directors} casts={detail.casts} />
      ) : null}

      {showSummary ? (
        <Summary
          summary={detail.summary}
          primarySummaryLabel={primarySummaryLabel}
          secondarySummary={secondarySummary}
          secondarySummaryLabel={secondarySummaryLabel}
          secondarySummaryLoading={secondarySummaryLoading}
        />
      ) : null}
    </div>
  );
}

export const MovieMetaInfo = memo(MovieMetaInfoComponent);

export default MovieMetaInfo;
