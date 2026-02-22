/* eslint-disable react-hooks/exhaustive-deps */

import { Clock, Target, Tv } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { formatTimeToHHMM, parseCustomTimeFormat } from '@/lib/time';

interface EpgProgram {
  start: string;
  end: string;
  title: string;
}

interface EpgScrollableRowProps {
  programs: EpgProgram[];
  currentTime?: Date;
  isLoading?: boolean;
}

export default function EpgScrollableRow({
  programs,
  currentTime = new Date(),
  isLoading = false,
}: EpgScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [currentPlayingIndex, setCurrentPlayingIndex] = useState<number>(-1);

  // 处理滚轮事件，实现横向滚动
  const handleWheel = (e: WheelEvent) => {
    if (isHovered && containerRef.current) {
      e.preventDefault(); // 阻止默认的竖向滚动

      const container = containerRef.current;
      const scrollAmount = e.deltaY * 4; // 增加滚动速度

      // 根据滚轮方向进行横向滚动
      container.scrollBy({
        left: scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  // 阻止页面竖向滚动
  const preventPageScroll = (e: WheelEvent) => {
    if (isHovered) {
      e.preventDefault();
    }
  };

  // 自动滚动到正在播放的节目
  const scrollToCurrentProgram = () => {
    if (containerRef.current) {
      const currentProgramIndex = programs.findIndex((program) =>
        isCurrentlyPlaying(program),
      );
      if (currentProgramIndex !== -1) {
        const programElement = containerRef.current.children[
          currentProgramIndex
        ] as HTMLElement;
        if (programElement) {
          const container = containerRef.current;
          const programLeft = programElement.offsetLeft;
          const containerWidth = container.clientWidth;
          const programWidth = programElement.offsetWidth;

          // 计算滚动位置，使正在播放的节目居中显示
          const scrollLeft =
            programLeft - containerWidth / 2 + programWidth / 2;

          container.scrollTo({
            left: Math.max(0, scrollLeft),
            behavior: 'smooth',
          });
        }
      }
    }
  };

  useEffect(() => {
    if (isHovered) {
      // 鼠标悬停时阻止页面滚动
      document.addEventListener('wheel', preventPageScroll, { passive: false });
      document.addEventListener('wheel', handleWheel, { passive: false });
    } else {
      // 鼠标离开时恢复页面滚动
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    }

    return () => {
      document.removeEventListener('wheel', preventPageScroll);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [isHovered]);

  // 组件加载后自动滚动到正在播放的节目
  useEffect(() => {
    // 延迟执行，确保DOM完全渲染
    const timer = setTimeout(() => {
      // 初始化当前正在播放的节目索引
      const initialPlayingIndex = programs.findIndex((program) =>
        isCurrentlyPlaying(program),
      );
      setCurrentPlayingIndex(initialPlayingIndex);
      scrollToCurrentProgram();
    }, 100);

    return () => clearTimeout(timer);
  }, [programs, currentTime]);

  // 定时刷新正在播放状态
  useEffect(() => {
    // 每分钟刷新一次正在播放状态
    const interval = setInterval(() => {
      // 更新当前正在播放的节目索引
      const newPlayingIndex = programs.findIndex((program) => {
        try {
          const start = parseCustomTimeFormat(program.start);
          const end = parseCustomTimeFormat(program.end);
          return currentTime >= start && currentTime < end;
        } catch {
          return false;
        }
      });

      if (newPlayingIndex !== currentPlayingIndex) {
        setCurrentPlayingIndex(newPlayingIndex);
        // 如果正在播放的节目发生变化，自动滚动到新位置
        scrollToCurrentProgram();
      }
    }, 60000); // 60秒 = 1分钟

    return () => clearInterval(interval);
  }, [programs, currentTime, currentPlayingIndex]);

  // 格式化时间显示
  const formatTime = (timeString: string) => {
    return formatTimeToHHMM(timeString);
  };

  // 判断节目是否正在播放
  const isCurrentlyPlaying = (program: EpgProgram) => {
    try {
      const start = parseCustomTimeFormat(program.start);
      const end = parseCustomTimeFormat(program.end);
      return currentTime >= start && currentTime < end;
    } catch {
      return false;
    }
  };

  // 加载中状态
  if (isLoading) {
    return (
      <div className='pt-4'>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
            <Clock className='w-3 h-3 sm:w-4 sm:h-4' />
            今日节目单
          </h4>
          <div className='w-16 sm:w-20'></div>
        </div>
        <div className='min-h-[100px] sm:min-h-[120px] flex items-center justify-center'>
          <div className='flex items-center gap-3 sm:gap-4 text-gray-500 dark:text-gray-400'>
            <div className='w-5 h-5 sm:w-6 sm:h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin'></div>
            <span className='text-sm sm:text-base'>加载节目单...</span>
          </div>
        </div>
      </div>
    );
  }

  // 无节目单状态
  if (!programs || programs.length === 0) {
    return (
      <div className='pt-4'>
        <div className='mb-3 flex items-center justify-between'>
          <h4 className='text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
            <Clock className='w-3 h-3 sm:w-4 sm:h-4' />
            今日节目单
          </h4>
          <div className='w-16 sm:w-20'></div>
        </div>
        <div className='min-h-[100px] sm:min-h-[120px] flex items-center justify-center'>
          <div className='flex items-center gap-2 sm:gap-3 text-gray-400 dark:text-gray-500'>
            <Tv className='w-4 h-4 sm:w-5 sm:h-5' />
            <span className='text-sm sm:text-base'>暂无节目单数据</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className='pt-4 mt-2'>
      <div className='mb-3 flex items-center justify-between'>
        <h4 className='text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
          <Clock className='w-3 h-3 sm:w-4 sm:h-4' />
          今日节目单
        </h4>
        {currentPlayingIndex !== -1 && (
          <button
            onClick={scrollToCurrentProgram}
            className='flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 sm:py-2 text-xs font-medium text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 bg-gray-300/50 dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700 transition-all duration-200'
            title='滚动到当前播放位置'
          >
            <Target className='w-2.5 h-2.5 sm:w-3 sm:h-3' />
            <span className='hidden sm:inline'>当前播放</span>
            <span className='sm:hidden'>当前</span>
          </button>
        )}
      </div>

      <div
        className='relative'
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div
          ref={containerRef}
          className='flex overflow-x-auto scrollbar-hide py-2 pb-4 px-2 sm:px-4 min-h-[100px] sm:min-h-[120px]'
        >
          {programs.map((program, index) => {
            // 使用 currentPlayingIndex 来判断播放状态，确保样式能正确更新
            const isPlaying = index === currentPlayingIndex;
            const isFinishedProgram = index < currentPlayingIndex;
            const isUpcomingProgram = index > currentPlayingIndex;

            return (
              <div
                key={index}
                className={`flex-shrink-0 w-36 sm:w-48 p-2 sm:p-3 rounded-lg border transition-all duration-200 flex flex-col min-h-[100px] sm:min-h-[120px] ${
                  isPlaying
                    ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30'
                    : isFinishedProgram
                      ? 'bg-gray-300/50 dark:bg-gray-800 border-gray-300 dark:border-gray-700'
                      : isUpcomingProgram
                        ? 'bg-blue-500/10 dark:bg-blue-500/20 border-blue-500/30'
                        : 'bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {/* 时间显示在顶部 */}
                <div className='flex items-center justify-between mb-2 sm:mb-3 flex-shrink-0'>
                  <span
                    className={`text-xs font-medium ${
                      isPlaying
                        ? 'text-green-600 dark:text-green-400'
                        : isFinishedProgram
                          ? 'text-gray-500 dark:text-gray-400'
                          : isUpcomingProgram
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-600 dark:text-gray-300'
                    }`}
                  >
                    {formatTime(program.start)}
                  </span>
                  <span className='text-xs text-gray-400 dark:text-gray-500'>
                    {formatTime(program.end)}
                  </span>
                </div>

                {/* 标题在中间，占据剩余空间 */}
                <div
                  className={`text-xs sm:text-sm font-medium flex-1 ${
                    isPlaying
                      ? 'text-green-900 dark:text-green-100'
                      : isFinishedProgram
                        ? 'text-gray-600 dark:text-gray-400'
                        : isUpcomingProgram
                          ? 'text-blue-900 dark:text-blue-100'
                          : 'text-gray-900 dark:text-gray-100'
                  }`}
                  style={{
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.4',
                    maxHeight: '2.8em',
                  }}
                  title={program.title}
                >
                  {program.title}
                </div>

                {/* 正在播放状态在底部 */}
                {isPlaying && (
                  <div className='mt-auto pt-1 sm:pt-2 flex items-center gap-1 sm:gap-1.5 flex-shrink-0'>
                    <div className='w-1.5 h-1.5 sm:w-2 sm:h-2 bg-green-500 rounded-full animate-pulse'></div>
                    <span className='text-xs text-green-600 dark:text-green-400 font-medium'>
                      正在播放
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
