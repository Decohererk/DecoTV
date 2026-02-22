'use client';

import { ChevronLeft, ChevronRight, Menu, MoveHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface CategoryBarProps {
  groupedChannels: { [key: string]: unknown[] };
  selectedGroup: string;
  onGroupChange: (group: string) => void;
  onOpenSelector?: () => void;
  disabled?: boolean;
  disabledMessage?: string;
}

interface DragState {
  isActive: boolean;
  pointerId: number | null;
  startX: number;
  startScrollLeft: number;
  preventClickUntil: number;
}

export default function CategoryBar({
  groupedChannels,
  selectedGroup,
  onGroupChange,
  onOpenSelector,
  disabled = false,
  disabledMessage = '切换直播源中...',
}: CategoryBarProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const dragStateRef = useRef<DragState>({
    isActive: false,
    pointerId: null,
    startX: 0,
    startScrollLeft: 0,
    preventClickUntil: 0,
  });

  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isMounted, setIsMounted] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const BOUNDARY_THRESHOLD = 2;
  const groups = useMemo(() => Object.keys(groupedChannels), [groupedChannels]);
  const currentGroupCount = selectedGroup
    ? groupedChannels[selectedGroup]?.length || 0
    : 0;

  const checkScroll = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > BOUNDARY_THRESHOLD);
    setShowRightArrow(
      scrollLeft < scrollWidth - clientWidth - BOUNDARY_THRESHOLD,
    );

    const maxScrollableDistance = Math.max(scrollWidth - clientWidth, 0);
    const progress =
      maxScrollableDistance === 0
        ? 0
        : Math.min(1, Math.max(0, scrollLeft / maxScrollableDistance));
    setScrollProgress(progress);
  }, []);

  const scrollByDistance = useCallback((direction: -1 | 1) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const distance = Math.max(260, Math.floor(container.clientWidth * 0.65));
    container.scrollBy({
      left: direction * distance,
      behavior: 'smooth',
    });
  }, []);

  const scrollToActiveGroup = useCallback(() => {
    if (!selectedGroup) return;

    const groupIndex = groups.indexOf(selectedGroup);
    if (groupIndex === -1) return;

    const button = buttonRefs.current[groupIndex];
    if (!button) return;

    button.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'center',
    });
  }, [selectedGroup, groups]);

  const endDrag = useCallback(() => {
    dragStateRef.current.isActive = false;
    dragStateRef.current.pointerId = null;
    setIsDragging(false);
  }, []);

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      // 仅在鼠标场景启用拖拽，避免触屏点击分类时误判为拖拽而吞掉点击
      if (event.pointerType !== 'mouse') return;
      if (event.button !== 0) return;

      const container = scrollContainerRef.current;
      if (!container) return;

      dragStateRef.current.isActive = true;
      dragStateRef.current.pointerId = event.pointerId;
      dragStateRef.current.startX = event.clientX;
      dragStateRef.current.startScrollLeft = container.scrollLeft;
      setIsDragging(true);
    },
    [disabled],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const container = scrollContainerRef.current;
      const dragState = dragStateRef.current;
      if (!container || !dragState.isActive) return;

      const deltaX = event.clientX - dragState.startX;
      if (Math.abs(deltaX) > 6) {
        dragState.preventClickUntil = Date.now() + 160;
      }
      container.scrollLeft = dragState.startScrollLeft - deltaX;
    },
    [],
  );

  const handlePointerUp = useCallback(
    (_event: React.PointerEvent<HTMLDivElement>) => {
      endDrag();
    },
    [endDrag],
  );

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (Math.abs(event.deltaY) < 4) return;

    container.scrollBy({
      left: event.deltaY,
      behavior: 'auto',
    });
    event.preventDefault();
  }, []);

  const handleKeyboardNavigation = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled || groups.length === 0) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

      event.preventDefault();
      const currentIndex = Math.max(0, groups.indexOf(selectedGroup));
      const nextIndex =
        event.key === 'ArrowRight'
          ? Math.min(groups.length - 1, currentIndex + 1)
          : Math.max(0, currentIndex - 1);
      if (nextIndex !== currentIndex) {
        onGroupChange(groups[nextIndex]);
      }
    },
    [disabled, groups, onGroupChange, selectedGroup],
  );

  const handleGroupClick = useCallback(
    (group: string) => {
      if (disabled) return;
      if (Date.now() < dragStateRef.current.preventClickUntil) return;
      onGroupChange(group);
    },
    [disabled, onGroupChange],
  );

  useEffect(() => {
    setIsMounted(true);

    const container = scrollContainerRef.current;
    if (!container) return;

    checkScroll();
    const initTimer = setTimeout(checkScroll, 100);
    const delayTimer = setTimeout(checkScroll, 260);

    container.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);

    return () => {
      clearTimeout(initTimer);
      clearTimeout(delayTimer);
      container.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [checkScroll]);

  useEffect(() => {
    if (!isMounted) return;
    const timer = setTimeout(checkScroll, 60);
    return () => clearTimeout(timer);
  }, [groupedChannels, isMounted, checkScroll]);

  useEffect(() => {
    if (!isMounted) return;
    scrollToActiveGroup();
  }, [selectedGroup, isMounted, scrollToActiveGroup]);

  useEffect(() => {
    return () => {
      endDrag();
    };
  }, [endDrag]);

  if (groups.length === 0) return null;

  const indicatorWidth = Math.max(14, Math.min(42, 100 / groups.length + 10));
  const indicatorOffset = scrollProgress * (100 - indicatorWidth);

  return (
    <div className='mb-3 shrink-0 -mx-6'>
      {disabled && disabledMessage && (
        <div className='flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 px-6 pb-2'>
          <div className='w-2 h-2 bg-amber-500 rounded-full animate-pulse' />
          {disabledMessage}
        </div>
      )}

      <div className='relative flex flex-col gap-2 px-6 pb-3'>
        <div className='flex items-center gap-2'>
          {onOpenSelector && (
            <button
              onClick={onOpenSelector}
              disabled={disabled}
              className={cn(
                'shrink-0 px-3 py-2 rounded-full text-sm font-medium',
                'transition-all duration-200 border-2',
                disabled
                  ? 'opacity-50 cursor-not-allowed border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-700 text-gray-400'
                  : 'border-green-500 dark:border-green-400 bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/20',
              )}
              title='打开分类管理面板'
            >
              <div className='flex items-center gap-1.5'>
                <Menu className='w-4 h-4' />
                <span>分类面板</span>
                <span className='text-xs opacity-75'>({groups.length})</span>
              </div>
            </button>
          )}

          <div className='min-w-0 flex-1 px-3 py-2 rounded-full border border-gray-200 dark:border-gray-700 bg-white/70 dark:bg-gray-800/50 text-xs text-gray-600 dark:text-gray-300 flex items-center gap-2'>
            <MoveHorizontal className='w-3.5 h-3.5 shrink-0 text-green-600 dark:text-green-400' />
            <span className='truncate'>
              当前分类: {selectedGroup || '全部'} ({currentGroupCount})
            </span>
          </div>
        </div>

        <div className='relative flex-1 min-w-0'>
          <button
            onClick={() => scrollByDistance(-1)}
            disabled={!showLeftArrow}
            className={cn(
              'hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 z-20',
              'w-9 h-9 items-center justify-center rounded-full backdrop-blur-md',
              'bg-black/40 dark:bg-black/60 text-white shadow-lg',
              'transition-all duration-200 ease-out',
              'hover:bg-green-500 hover:scale-110 hover:shadow-xl active:scale-95',
              'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2',
              showLeftArrow
                ? 'opacity-100 pointer-events-auto translate-x-0'
                : 'opacity-0 pointer-events-none -translate-x-2',
            )}
            aria-label='向左滚动'
          >
            <ChevronLeft className='w-5 h-5' />
          </button>

          <button
            onClick={() => scrollByDistance(1)}
            disabled={!showRightArrow}
            className={cn(
              'hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 z-20',
              'w-9 h-9 items-center justify-center rounded-full backdrop-blur-md',
              'bg-black/40 dark:bg-black/60 text-white shadow-lg',
              'transition-all duration-200 ease-out',
              'hover:bg-green-500 hover:scale-110 hover:shadow-xl active:scale-95',
              'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2',
              showRightArrow
                ? 'opacity-100 pointer-events-auto translate-x-0'
                : 'opacity-0 pointer-events-none translate-x-2',
            )}
            aria-label='向右滚动'
          >
            <ChevronRight className='w-5 h-5' />
          </button>

          <div
            className={cn(
              'hidden lg:block absolute left-0 top-0 bottom-0 w-12 z-10',
              'bg-linear-to-r from-gray-50 dark:from-gray-900 to-transparent',
              'pointer-events-none transition-opacity duration-300',
              showLeftArrow ? 'opacity-100' : 'opacity-0',
            )}
          />

          <div
            className={cn(
              'hidden lg:block absolute right-0 top-0 bottom-0 w-12 z-10',
              'bg-linear-to-l from-gray-50 dark:from-gray-900 to-transparent',
              'pointer-events-none transition-opacity duration-300',
              showRightArrow ? 'opacity-100' : 'opacity-0',
            )}
          />

          <div
            ref={scrollContainerRef}
            tabIndex={0}
            onWheel={handleWheel}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={endDrag}
            onPointerLeave={endDrag}
            onKeyDown={handleKeyboardNavigation}
            className={cn(
              'flex gap-2 overflow-x-auto scroll-smooth select-none',
              'lg:px-10',
              'focus:outline-none focus:ring-2 focus:ring-green-500/40 rounded-xl',
              isDragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
            style={{
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <style jsx>{`
              div::-webkit-scrollbar {
                display: none;
              }
            `}</style>

            {groups.map((group, index) => {
              const isActive = group === selectedGroup;
              const channelCount = groupedChannels[group].length;

              return (
                <button
                  key={group}
                  data-group={group}
                  ref={(el) => {
                    buttonRefs.current[index] = el;
                  }}
                  onClick={() => handleGroupClick(group)}
                  disabled={disabled}
                  className={cn(
                    'shrink-0 px-4 py-2 rounded-full text-sm font-medium',
                    'transition-all duration-200 whitespace-nowrap',
                    'focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-1',
                    disabled && 'opacity-50 cursor-not-allowed',
                    !disabled &&
                      isActive &&
                      'bg-green-500 text-white shadow-lg shadow-green-500/30 scale-105',
                    !disabled &&
                      !isActive &&
                      'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
                  )}
                >
                  {group}
                  <span
                    className={cn(
                      'ml-1.5 text-xs',
                      isActive
                        ? 'text-white/80'
                        : 'text-gray-500 dark:text-gray-400',
                    )}
                  >
                    ({channelCount})
                  </span>
                </button>
              );
            })}
          </div>

          <div className='hidden lg:block mt-2 px-10'>
            <div className='h-1 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden'>
              <div
                className='h-full rounded-full bg-green-500/70 transition-all duration-300'
                style={{
                  width: `${indicatorWidth}%`,
                  transform: `translateX(${indicatorOffset}%)`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
