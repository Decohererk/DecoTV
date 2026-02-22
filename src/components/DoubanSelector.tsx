/* eslint-disable react-hooks/exhaustive-deps */

'use client';

import {
  ChevronLeft,
  ChevronRight,
  Database,
  Grid3X3,
  Loader2,
  X,
} from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ApiSite } from '@/lib/config';

import MultiLevelSelector from './MultiLevelSelector';
import WeekdaySelector from './WeekdaySelector';

// 简单的 className 合并函数
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface SelectorOption {
  label: string;
  value: string;
}

// 源分类项
export interface SourceCategory {
  type_id: string | number;
  type_name: string;
  type_pid?: string | number;
}

interface DoubanSelectorProps {
  type: 'movie' | 'tv' | 'show' | 'anime';
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onMultiLevelChange?: (values: Record<string, string>) => void;
  onWeekdayChange: (weekday: string) => void;
  // 数据源相关 props
  sources?: ApiSite[];
  currentSource?: string;
  sourceCategories?: SourceCategory[];
  isLoadingSources?: boolean;
  isLoadingCategories?: boolean;
  onSourceChange?: (sourceKey: string) => void;
  onSourceCategoryChange?: (category: SourceCategory) => void;
  selectedSourceCategory?: SourceCategory | null;
  hideSourceSelector?: boolean;
}

const DoubanSelector: React.FC<DoubanSelectorProps> = ({
  type,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
  onMultiLevelChange,
  onWeekdayChange,
  // 数据源相关
  sources = [],
  currentSource = 'auto',
  sourceCategories = [],
  isLoadingSources = false,
  isLoadingCategories = false,
  onSourceChange,
  onSourceCategoryChange,
  selectedSourceCategory,
  hideSourceSelector = false,
}) => {
  // 数据源选择器的 refs
  const sourceButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 源分类选择器的 refs
  const sourceCategoryContainerRef = useRef<HTMLDivElement>(null);
  const sourceCategoryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 为不同的选择器创建独立的refs和状态
  const primaryContainerRef = useRef<HTMLDivElement>(null);
  const primaryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [primaryIndicatorStyle, setPrimaryIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const secondaryContainerRef = useRef<HTMLDivElement>(null);
  const secondaryButtonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [secondaryIndicatorStyle, setSecondaryIndicatorStyle] = useState<{
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  // 电影的一级选择器选项
  const moviePrimaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '热门电影', value: '热门' },
    { label: '最新电影', value: '最新' },
    { label: '豆瓣高分', value: '豆瓣高分' },
    { label: '冷门佳片', value: '冷门佳片' },
  ];

  // 电影的二级选择器选项
  const movieSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '华语', value: '华语' },
    { label: '欧美', value: '欧美' },
    { label: '韩国', value: '韩国' },
    { label: '日本', value: '日本' },
  ];

  // 电视剧一级选择器选项
  const tvPrimaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '最近热门', value: '最近热门' },
  ];

  // 电视剧二级选择器选项
  const tvSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: 'tv' },
    { label: '国产', value: 'tv_domestic' },
    { label: '欧美', value: 'tv_american' },
    { label: '日本', value: 'tv_japanese' },
    { label: '韩国', value: 'tv_korean' },
    { label: '动漫', value: 'tv_animation' },
    { label: '纪录片', value: 'tv_documentary' },
  ];

  // 综艺一级选择器选项
  const showPrimaryOptions: SelectorOption[] = [
    { label: '全部', value: '全部' },
    { label: '最近热门', value: '最近热门' },
  ];

  // 综艺二级选择器选项
  const showSecondaryOptions: SelectorOption[] = [
    { label: '全部', value: 'show' },
    { label: '国内', value: 'show_domestic' },
    { label: '国外', value: 'show_foreign' },
  ];

  // 动漫一级选择器选项
  const animePrimaryOptions: SelectorOption[] = [
    { label: '每日放送', value: '每日放送' },
    { label: '番剧', value: '番剧' },
    { label: '剧场版', value: '剧场版' },
  ];

  // 处理多级选择器变化
  const handleMultiLevelChange = (values: Record<string, string>) => {
    onMultiLevelChange?.(values);
  };

  // 更新指示器位置的通用函数
  const updateIndicatorPosition = useCallback(
    (
      activeIndex: number,
      containerRef: React.RefObject<HTMLDivElement | null>,
      buttonRefs: React.MutableRefObject<(HTMLButtonElement | null)[]>,
      setIndicatorStyle: React.Dispatch<
        React.SetStateAction<{ left: number; width: number }>
      >,
    ) => {
      if (
        activeIndex >= 0 &&
        buttonRefs.current[activeIndex] &&
        containerRef.current
      ) {
        const timeoutId = setTimeout(() => {
          const button = buttonRefs.current[activeIndex];
          const container = containerRef.current;
          if (button && container) {
            const buttonRect = button.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();

            if (buttonRect.width > 0) {
              setIndicatorStyle({
                left: buttonRect.left - containerRect.left,
                width: buttonRect.width,
              });
            }
          }
        }, 0);
        return () => clearTimeout(timeoutId);
      }
    },
    [],
  );

  // 重新计算所有指示器位置的函数
  const recalculateAllIndicators = useCallback(() => {
    // 主选择器
    if (type === 'movie') {
      const activeIndex = moviePrimaryOptions.findIndex(
        (opt) =>
          opt.value === (primarySelection || moviePrimaryOptions[0].value),
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
    } else if (type === 'tv') {
      const activeIndex = tvPrimaryOptions.findIndex(
        (opt) => opt.value === (primarySelection || tvPrimaryOptions[1].value),
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
    } else if (type === 'anime') {
      const activeIndex = animePrimaryOptions.findIndex(
        (opt) =>
          opt.value === (primarySelection || animePrimaryOptions[0].value),
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
    } else if (type === 'show') {
      const activeIndex = showPrimaryOptions.findIndex(
        (opt) =>
          opt.value === (primarySelection || showPrimaryOptions[1].value),
      );
      updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
    }

    // 副选择器
    let secondaryActiveIndex = -1;
    if (type === 'movie') {
      secondaryActiveIndex = movieSecondaryOptions.findIndex(
        (opt) =>
          opt.value === (secondarySelection || movieSecondaryOptions[0].value),
      );
    } else if (type === 'tv') {
      secondaryActiveIndex = tvSecondaryOptions.findIndex(
        (opt) =>
          opt.value === (secondarySelection || tvSecondaryOptions[0].value),
      );
    } else if (type === 'show') {
      secondaryActiveIndex = showSecondaryOptions.findIndex(
        (opt) =>
          opt.value === (secondarySelection || showSecondaryOptions[0].value),
      );
    }

    if (secondaryActiveIndex >= 0) {
      updateIndicatorPosition(
        secondaryActiveIndex,
        secondaryContainerRef,
        secondaryButtonRefs,
        setSecondaryIndicatorStyle,
      );
    }
  }, [
    type,
    primarySelection,
    secondarySelection,
    updateIndicatorPosition,
    moviePrimaryOptions,
    tvPrimaryOptions,
    animePrimaryOptions,
    showPrimaryOptions,
    movieSecondaryOptions,
    tvSecondaryOptions,
    showSecondaryOptions,
  ]);

  // 监听窗口 resize 事件，防抖更新指示器位置
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout;

    const handleResize = () => {
      // 防抖：窗口大小变化后 100ms 再更新
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        recalculateAllIndicators();
      }, 100);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(resizeTimeout);
    };
  }, [recalculateAllIndicators]);

  // 组件挂载时立即计算初始位置
  useEffect(() => {
    recalculateAllIndicators();
  }, [type, recalculateAllIndicators]);

  // 监听主选择器变化
  useEffect(() => {
    if (type === 'movie') {
      const activeIndex = moviePrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection,
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
      return cleanup;
    } else if (type === 'tv') {
      const activeIndex = tvPrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection,
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
      return cleanup;
    } else if (type === 'anime') {
      const activeIndex = animePrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection,
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
      return cleanup;
    } else if (type === 'show') {
      const activeIndex = showPrimaryOptions.findIndex(
        (opt) => opt.value === primarySelection,
      );
      const cleanup = updateIndicatorPosition(
        activeIndex,
        primaryContainerRef,
        primaryButtonRefs,
        setPrimaryIndicatorStyle,
      );
      return cleanup;
    }
  }, [primarySelection, updateIndicatorPosition]);

  // 监听副选择器变化
  useEffect(() => {
    let activeIndex = -1;
    let options: SelectorOption[] = [];

    if (type === 'movie') {
      activeIndex = movieSecondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection,
      );
      options = movieSecondaryOptions;
    } else if (type === 'tv') {
      activeIndex = tvSecondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection,
      );
      options = tvSecondaryOptions;
    } else if (type === 'show') {
      activeIndex = showSecondaryOptions.findIndex(
        (opt) => opt.value === secondarySelection,
      );
      options = showSecondaryOptions;
    }

    if (options.length > 0) {
      const cleanup = updateIndicatorPosition(
        activeIndex,
        secondaryContainerRef,
        secondaryButtonRefs,
        setSecondaryIndicatorStyle,
      );
      return cleanup;
    }
  }, [secondarySelection, updateIndicatorPosition]);

  // 渲染胶囊式选择器
  const renderCapsuleSelector = (
    options: SelectorOption[],
    activeValue: string | undefined,
    onChange: (value: string) => void,
    isPrimary = false,
  ) => {
    const containerRef = isPrimary
      ? primaryContainerRef
      : secondaryContainerRef;
    const buttonRefs = isPrimary ? primaryButtonRefs : secondaryButtonRefs;
    const indicatorStyle = isPrimary
      ? primaryIndicatorStyle
      : secondaryIndicatorStyle;

    return (
      <div
        ref={containerRef}
        className='relative inline-flex bg-gray-200/60 rounded-full p-0.5 sm:p-1 dark:bg-gray-700/60 backdrop-blur-sm'
      >
        {/* 滑动的白色背景指示器 */}
        {indicatorStyle.width > 0 && (
          <div
            className='absolute top-0.5 bottom-0.5 sm:top-1 sm:bottom-1 bg-white dark:bg-gray-500 rounded-full shadow-sm transition-all duration-300 ease-out'
            style={{
              left: `${indicatorStyle.left}px`,
              width: `${indicatorStyle.width}px`,
            }}
          />
        )}

        {options.map((option, index) => {
          const isActive = activeValue === option.value;
          return (
            <button
              key={option.value}
              ref={(el) => {
                buttonRefs.current[index] = el;
              }}
              onClick={() => onChange(option.value)}
              className={`relative z-10 px-2 py-1 sm:px-4 sm:py-2 text-xs sm:text-sm font-medium rounded-full transition-all duration-200 whitespace-nowrap ${
                isActive
                  ? 'text-gray-900 dark:text-gray-100 cursor-default'
                  : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 cursor-pointer'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    );
  };

  // 构建数据源选项（添加"聚合"选项在最前面）
  const sourceOptions: SelectorOption[] = [
    { label: '聚合', value: 'auto' },
    ...sources.map((s) => ({ label: s.name, value: s.key })),
  ];

  // ============================================
  // 数据源选择器状态和逻辑 (单行横滑 + 模态框)
  // ============================================
  const [isSourceModalOpen, setIsSourceModalOpen] = useState(false);
  const [showLeftArrow, setShowLeftArrow] = useState(false);
  const [showRightArrow, setShowRightArrow] = useState(false);
  const sourceScrollRef = useRef<HTMLDivElement>(null);
  const rafIdRef = useRef<number>(0);
  const scrollToActiveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const prevSourceRef = useRef<string>(currentSource);

  // 边界检测阈值 (5px 容错，避免高分屏小数问题)
  const BOUNDARY_THRESHOLD = 5;

  // 检测滚动位置，更新箭头显示状态
  const checkSourceScroll = useCallback(() => {
    const container = sourceScrollRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    setShowLeftArrow(scrollLeft > BOUNDARY_THRESHOLD);
    setShowRightArrow(
      scrollLeft < scrollWidth - clientWidth - BOUNDARY_THRESHOLD,
    );
  }, []);

  // 使用 requestAnimationFrame 包裹的滚动检测 (性能优化)
  const handleSourceScroll = useCallback(() => {
    if (rafIdRef.current) {
      cancelAnimationFrame(rafIdRef.current);
    }
    rafIdRef.current = requestAnimationFrame(checkSourceScroll);
  }, [checkSourceScroll]);

  // 滚动控制 - 滚动距离为容器宽度的一半
  const scrollSourceLeft = useCallback(() => {
    const container = sourceScrollRef.current;
    if (!container) return;
    const scrollAmount = Math.max(container.clientWidth / 2, 200);
    container.scrollBy({
      left: -scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  const scrollSourceRight = useCallback(() => {
    const container = sourceScrollRef.current;
    if (!container) return;
    const scrollAmount = Math.max(container.clientWidth / 2, 200);
    container.scrollBy({
      left: scrollAmount,
      behavior: 'smooth',
    });
  }, []);

  // 滚动到当前选中的数据源
  const scrollToActiveSource = useCallback(() => {
    const activeIndex = sourceOptions.findIndex(
      (opt) => opt.value === currentSource,
    );
    if (activeIndex === -1) return;

    const button = sourceButtonRefs.current[activeIndex];
    if (button) {
      button.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [currentSource, sourceOptions]);

  // 初始化和监听滚动 + ResizeObserver
  useEffect(() => {
    const container = sourceScrollRef.current;
    if (!container) return;

    // 初始检测
    checkSourceScroll();
    // 延迟再次检测，确保布局完成
    const initTimer = setTimeout(checkSourceScroll, 100);
    const delayTimer = setTimeout(checkSourceScroll, 300);

    // ResizeObserver: 容器尺寸变化时重新计算
    const resizeObserver = new ResizeObserver(() => {
      checkSourceScroll();
    });
    resizeObserver.observe(container);

    // 使用 RAF 优化的回调，避免滚动期间频繁更新导致卡顿
    container.addEventListener('scroll', handleSourceScroll, { passive: true });
    window.addEventListener('resize', checkSourceScroll);

    return () => {
      clearTimeout(initTimer);
      clearTimeout(delayTimer);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
      }
      resizeObserver.disconnect();
      container.removeEventListener('scroll', handleSourceScroll);
      window.removeEventListener('resize', checkSourceScroll);
    };
  }, [checkSourceScroll, handleSourceScroll, sources]);

  // 当选中的数据源变化时，滚动到对应位置 (带防抖，避免与用户手势冲突)
  useEffect(() => {
    // 只有真正切换数据源时才自动滚动
    if (prevSourceRef.current === currentSource) return;
    prevSourceRef.current = currentSource;

    // 清除之前的定时器
    if (scrollToActiveTimerRef.current) {
      clearTimeout(scrollToActiveTimerRef.current);
    }
    // 防抖 150ms
    scrollToActiveTimerRef.current = setTimeout(() => {
      scrollToActiveSource();
    }, 150);

    return () => {
      if (scrollToActiveTimerRef.current) {
        clearTimeout(scrollToActiveTimerRef.current);
      }
    };
  }, [currentSource, scrollToActiveSource]);

  // 关闭模态框时阻止背景滚动
  useEffect(() => {
    if (isSourceModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSourceModalOpen]);

  // 处理模态框内的数据源选择
  const handleSourceSelect = (value: string) => {
    onSourceChange?.(value);
    setIsSourceModalOpen(false);
  };

  // 渲染数据源选择器（单行横滑 + "全部"按钮打开模态框）
  const renderSourceSelector = () => {
    if (sources.length === 0 && !isLoadingSources) {
      return null;
    }

    return (
      <div className='flex flex-col gap-2 mb-4'>
        <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1'>
          <Database className='w-3.5 h-3.5' />
          数据源
          <span className='text-xs text-gray-400 dark:text-gray-500 ml-1'>
            ({sourceOptions.length})
          </span>
        </span>

        {isLoadingSources ? (
          <div className='flex items-center gap-2 px-3 py-2 text-sm text-gray-500'>
            <Loader2 className='w-4 h-4 animate-spin' />
            <span>加载中...</span>
          </div>
        ) : (
          <div className='flex items-center gap-2'>
            {/* 左侧固定按钮 - "全部源" */}
            <button
              onClick={() => setIsSourceModalOpen(true)}
              className={cn(
                'shrink-0 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium',
                'transition-all duration-200 border-2',
                'border-blue-500 dark:border-blue-400 bg-white dark:bg-gray-800',
                'text-blue-600 dark:text-blue-400',
                'hover:bg-blue-50 dark:hover:bg-blue-900/20',
                'flex items-center gap-1.5',
              )}
              title='查看全部数据源'
            >
              <Grid3X3 className='w-3.5 h-3.5' />
              <span className='hidden sm:inline'>全部源</span>
              <span className='text-xs opacity-75'>
                ({sourceOptions.length})
              </span>
            </button>

            {/* 右侧滚动区域 */}
            <div className='relative flex-1 min-w-0'>
              {/* 左侧箭头按钮 - 仅 PC 端显示，z-30 确保在遮罩之上 */}
              <button
                onClick={scrollSourceLeft}
                disabled={!showLeftArrow}
                className={cn(
                  'hidden lg:flex absolute left-0 top-1/2 -translate-y-1/2 z-30',
                  'w-8 h-8 items-center justify-center',
                  'rounded-full backdrop-blur-md',
                  'bg-black/50 dark:bg-black/70',
                  'text-white shadow-lg',
                  'transition-all duration-200 ease-out',
                  'hover:bg-blue-500 hover:scale-110',
                  'active:scale-95',
                  showLeftArrow
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none -translate-x-2',
                )}
                aria-label='向左滚动'
              >
                <ChevronLeft className='w-5 h-5' />
              </button>

              {/* 右侧箭头按钮 - 仅 PC 端显示，z-30 确保在遮罩之上 */}
              <button
                onClick={scrollSourceRight}
                disabled={!showRightArrow}
                className={cn(
                  'hidden lg:flex absolute right-0 top-1/2 -translate-y-1/2 z-30',
                  'w-8 h-8 items-center justify-center',
                  'rounded-full backdrop-blur-md',
                  'bg-black/50 dark:bg-black/70',
                  'text-white shadow-lg',
                  'transition-all duration-200 ease-out',
                  'hover:bg-blue-500 hover:scale-110',
                  'active:scale-95',
                  showRightArrow
                    ? 'opacity-100'
                    : 'opacity-0 pointer-events-none translate-x-2',
                )}
                aria-label='向右滚动'
              >
                <ChevronRight className='w-5 h-5' />
              </button>

              {/* 左侧渐变遮罩 */}
              <div
                className={cn(
                  'hidden lg:block absolute left-0 top-0 bottom-0 w-8 z-10',
                  'bg-linear-to-r from-white dark:from-gray-900 to-transparent',
                  'pointer-events-none transition-opacity duration-300',
                  showLeftArrow ? 'opacity-100' : 'opacity-0',
                )}
              />

              {/* 右侧渐变遮罩 */}
              <div
                className={cn(
                  'hidden lg:block absolute right-0 top-0 bottom-0 w-8 z-10',
                  'bg-linear-to-l from-white dark:from-gray-900 to-transparent',
                  'pointer-events-none transition-opacity duration-300',
                  showRightArrow ? 'opacity-100' : 'opacity-0',
                )}
              />

              {/* 横向滚动的数据源列表 */}
              <div
                ref={sourceScrollRef}
                className={cn(
                  'flex gap-1.5 sm:gap-2 overflow-x-auto py-1',
                  'lg:px-8', // PC 端留出箭头按钮空间
                  'touch-pan-x', // 移动端触摸滚动优化
                  // 注意：不使用 scroll-smooth，让原生惯性滚动更丝滑
                  // 不使用 snap-x snap-mandatory，避免回弹问题
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

                {sourceOptions.map((option, index) => {
                  const isActive = currentSource === option.value;
                  return (
                    <button
                      key={option.value}
                      ref={(el) => {
                        sourceButtonRefs.current[index] = el;
                      }}
                      onClick={() => onSourceChange?.(option.value)}
                      className={cn(
                        'shrink-0 px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium rounded-lg',
                        'transition-all duration-200 whitespace-nowrap',
                        isActive
                          ? 'bg-blue-500 text-white shadow-md shadow-blue-500/30 scale-105'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 hover:scale-102',
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  // 渲染数据源模态框
  const renderSourceModal = () => {
    if (!isSourceModalOpen) return null;

    const modalContent = (
      <>
        {/* 遮罩层 */}
        <div
          className='fixed inset-0 bg-black/60 backdrop-blur-sm z-50'
          onClick={() => setIsSourceModalOpen(false)}
        />

        {/* PC 端：居中模态框 | 移动端：底部抽屉 */}
        <div
          className={cn(
            'fixed z-50',
            // 移动端：底部抽屉样式
            'inset-x-0 bottom-0 max-h-[85vh]',
            'rounded-t-3xl',
            // PC 端：居中模态框样式
            'lg:inset-auto lg:top-1/2 lg:left-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2',
            'lg:max-w-4xl lg:w-[90vw] lg:max-h-[80vh]',
            'lg:rounded-2xl',
            // 通用样式
            'bg-white dark:bg-gray-900',
            'border-t lg:border border-gray-200 dark:border-gray-700',
            'shadow-2xl',
            'flex flex-col',
            'animate-in fade-in duration-200',
            'slide-in-from-bottom lg:slide-in-from-bottom-0 lg:zoom-in-95',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 移动端拖拽指示条 */}
          <div className='lg:hidden flex justify-center pt-3 pb-2'>
            <div className='w-10 h-1 bg-gray-300 dark:bg-gray-600 rounded-full' />
          </div>

          {/* 头部 */}
          <div className='flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 dark:border-gray-700'>
            <div className='flex items-center gap-2'>
              <Database className='w-5 h-5 text-blue-500' />
              <h2 className='text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100'>
                选择数据源
              </h2>
              <span className='text-sm text-gray-500 dark:text-gray-400'>
                ({sourceOptions.length} 个)
              </span>
            </div>
            <button
              onClick={() => setIsSourceModalOpen(false)}
              className={cn(
                'p-2 rounded-full',
                'text-gray-500 dark:text-gray-400',
                'hover:bg-gray-100 dark:hover:bg-gray-800',
                'transition-colors duration-200',
              )}
              aria-label='关闭'
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          {/* 主体 - Grid 布局 */}
          <div className='flex-1 overflow-y-auto p-4 sm:p-6'>
            <div className='grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3'>
              {sourceOptions.map((option) => {
                const isActive = currentSource === option.value;
                return (
                  <button
                    key={option.value}
                    onClick={() => handleSourceSelect(option.value)}
                    className={cn(
                      'px-3 py-2.5 sm:px-4 sm:py-3 text-sm sm:text-base font-medium rounded-xl',
                      'transition-all duration-200',
                      'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
                      isActive
                        ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30 scale-105 ring-2 ring-blue-400'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:scale-102 active:scale-98',
                    )}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 底部操作区 - 移动端 */}
          <div className='lg:hidden px-4 py-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'>
            <button
              onClick={() => setIsSourceModalOpen(false)}
              className={cn(
                'w-full py-3 rounded-xl text-base font-medium',
                'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300',
                'hover:bg-gray-300 dark:hover:bg-gray-600',
                'transition-colors duration-200',
              )}
            >
              关闭
            </button>
          </div>
        </div>
      </>
    );

    // 使用 Portal 渲染到 body，确保 z-index 正确
    if (typeof window !== 'undefined') {
      return createPortal(modalContent, document.body);
    }
    return null;
  };

  // 渲染源分类选择器（当选择了特定数据源时显示）
  const renderSourceCategorySelector = () => {
    if (currentSource === 'auto') {
      return null;
    }

    if (sourceCategories.length === 0) {
      // 显示空状态提示而不是直接返回 null
      return (
        <div className='flex flex-col gap-2'>
          <div className='flex items-center justify-between'>
            <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400'>
              {sources.find((s) => s.key === currentSource)?.name || '源'} 分类
            </span>
          </div>
          <div className='text-sm text-gray-500 dark:text-gray-400 py-2'>
            {isLoadingCategories
              ? '加载中...'
              : '该源暂无分类数据（可能受跨域限制）'}
          </div>
        </div>
      );
    }

    return (
      <div className='flex flex-col gap-2 mb-4'>
        <div className='flex items-center justify-between'>
          <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400'>
            {sources.find((s) => s.key === currentSource)?.name || '源'} 分类
          </span>
          <span className='text-xs text-gray-400 dark:text-gray-500'>
            {sourceCategories.length} 个分类
          </span>
        </div>
        {/* 多行换行容器 */}
        {isLoadingCategories ? (
          <div className='flex items-center gap-2 px-3 py-2 text-sm text-gray-500'>
            <Loader2 className='w-4 h-4 animate-spin' />
            <span>加载分类...</span>
          </div>
        ) : (
          <div
            ref={sourceCategoryContainerRef}
            className='flex flex-wrap gap-1.5 sm:gap-2 p-1 bg-gray-100/50 dark:bg-gray-800/50 rounded-xl'
          >
            {sourceCategories.map((category, index) => {
              const isActive =
                selectedSourceCategory?.type_id === category.type_id;
              return (
                <button
                  key={category.type_id}
                  ref={(el) => {
                    sourceCategoryButtonRefs.current[index] = el;
                  }}
                  onClick={() => onSourceCategoryChange?.(category)}
                  className={`px-2 py-1 sm:px-3 sm:py-1.5 text-xs sm:text-sm font-medium rounded-lg transition-all duration-200 ${
                    isActive
                      ? 'bg-blue-500 text-white shadow-sm'
                      : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 border border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {category.type_name}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // 判断是否使用豆瓣分类（聚合模式）
  const useDoubanCategories = currentSource === 'auto';

  return (
    <>
      {/* 数据源模态框 - 使用 Portal 渲染 */}
      {renderSourceModal()}

      <div className='space-y-4 sm:space-y-6'>
        {/* 数据源选择器 - 始终在最上方 */}
        {!hideSourceSelector && sources.length > 0 && renderSourceSelector()}

        {/* 源分类选择器 - 当选择特定源时显示 */}
        {!useDoubanCategories && renderSourceCategorySelector()}

        {/* === 以下是豆瓣分类（聚合模式时显示）=== */}

        {/* 电影类型 - 显示两级选择器 */}
        {useDoubanCategories && type === 'movie' && (
          <div className='space-y-3 sm:space-y-4'>
            {/* 一级选择器 */}
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                分类
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  moviePrimaryOptions,
                  primarySelection || moviePrimaryOptions[0].value,
                  onPrimaryChange,
                  true,
                )}
              </div>
            </div>

            {/* 二级选择器 - 只在非"全部"时显示 */}
            {primarySelection !== '全部' ? (
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  地区
                </span>
                <div className='overflow-x-auto'>
                  {renderCapsuleSelector(
                    movieSecondaryOptions,
                    secondarySelection || movieSecondaryOptions[0].value,
                    onSecondaryChange,
                    false,
                  )}
                </div>
              </div>
            ) : (
              /* 多级选择器 - 只在选中"全部"时显示 */
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  筛选
                </span>
                <div className='overflow-x-auto'>
                  <MultiLevelSelector
                    key={`${type}-${primarySelection}`}
                    onChange={handleMultiLevelChange}
                    contentType={type}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* 电视剧类型 - 显示两级选择器 */}
        {useDoubanCategories && type === 'tv' && (
          <div className='space-y-3 sm:space-y-4'>
            {/* 一级选择器 */}
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                分类
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  tvPrimaryOptions,
                  primarySelection || tvPrimaryOptions[1].value,
                  onPrimaryChange,
                  true,
                )}
              </div>
            </div>

            {/* 二级选择器 - 只在选中"最近热门"时显示，选中"全部"时显示多级选择器 */}
            {(primarySelection || tvPrimaryOptions[1].value) === '最近热门' ? (
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  类型
                </span>
                <div className='overflow-x-auto'>
                  {renderCapsuleSelector(
                    tvSecondaryOptions,
                    secondarySelection || tvSecondaryOptions[0].value,
                    onSecondaryChange,
                    false,
                  )}
                </div>
              </div>
            ) : (primarySelection || tvPrimaryOptions[1].value) === '全部' ? (
              /* 多级选择器 - 只在选中"全部"时显示 */
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  筛选
                </span>
                <div className='overflow-x-auto'>
                  <MultiLevelSelector
                    key={`${type}-${primarySelection}`}
                    onChange={handleMultiLevelChange}
                    contentType={type}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* 动漫类型 - 显示一级选择器和多级选择器 */}
        {useDoubanCategories && type === 'anime' && (
          <div className='space-y-3 sm:space-y-4'>
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                分类
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  animePrimaryOptions,
                  primarySelection || animePrimaryOptions[0].value,
                  onPrimaryChange,
                  true,
                )}
              </div>
            </div>

            {/* 筛选部分 - 根据一级选择器显示不同内容 */}
            {(primarySelection || animePrimaryOptions[0].value) ===
            '每日放送' ? (
              // 每日放送分类下显示星期选择器
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  星期
                </span>
                <div className='overflow-x-auto'>
                  <WeekdaySelector onWeekdayChange={onWeekdayChange} />
                </div>
              </div>
            ) : (
              // 其他分类下显示原有的筛选功能
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  筛选
                </span>
                <div className='overflow-x-auto'>
                  {(primarySelection || animePrimaryOptions[0].value) ===
                  '番剧' ? (
                    <MultiLevelSelector
                      key={`anime-tv-${primarySelection}`}
                      onChange={handleMultiLevelChange}
                      contentType='anime-tv'
                    />
                  ) : (
                    <MultiLevelSelector
                      key={`anime-movie-${primarySelection}`}
                      onChange={handleMultiLevelChange}
                      contentType='anime-movie'
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 综艺类型 - 显示两级选择器 */}
        {useDoubanCategories && type === 'show' && (
          <div className='space-y-3 sm:space-y-4'>
            {/* 一级选择器 */}
            <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
              <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                分类
              </span>
              <div className='overflow-x-auto'>
                {renderCapsuleSelector(
                  showPrimaryOptions,
                  primarySelection || showPrimaryOptions[1].value,
                  onPrimaryChange,
                  true,
                )}
              </div>
            </div>

            {/* 二级选择器 - 只在选中"最近热门"时显示，选中"全部"时显示多级选择器 */}
            {(primarySelection || showPrimaryOptions[1].value) ===
            '最近热门' ? (
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  类型
                </span>
                <div className='overflow-x-auto'>
                  {renderCapsuleSelector(
                    showSecondaryOptions,
                    secondarySelection || showSecondaryOptions[0].value,
                    onSecondaryChange,
                    false,
                  )}
                </div>
              </div>
            ) : (primarySelection || showPrimaryOptions[1].value) === '全部' ? (
              /* 多级选择器 - 只在选中"全部"时显示 */
              <div className='flex flex-col sm:flex-row sm:items-center gap-2'>
                <span className='text-xs sm:text-sm font-medium text-gray-600 dark:text-gray-400 min-w-12'>
                  筛选
                </span>
                <div className='overflow-x-auto'>
                  <MultiLevelSelector
                    key={`${type}-${primarySelection}`}
                    onChange={handleMultiLevelChange}
                    contentType={type}
                  />
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </>
  );
};

export default DoubanSelector;
