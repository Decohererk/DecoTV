import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface ScrollableRowProps {
  children: React.ReactNode;
  scrollDistance?: number;
}

export default function ScrollableRow({
  children,
  scrollDistance = 1000,
}: ScrollableRowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const showLeftScrollRef = useRef(false);
  const showRightScrollRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const checkScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    const { scrollWidth, clientWidth, scrollLeft } = container;
    const threshold = 1;
    const canScrollRight = scrollWidth - (scrollLeft + clientWidth) > threshold;
    const canScrollLeft = scrollLeft > threshold;

    if (showRightScrollRef.current !== canScrollRight) {
      showRightScrollRef.current = canScrollRight;
      setShowRightScroll(canScrollRight);
    }

    if (showLeftScrollRef.current !== canScrollLeft) {
      showLeftScrollRef.current = canScrollLeft;
      setShowLeftScroll(canScrollLeft);
    }
  }, []);

  const scheduleCheckScroll = useCallback(() => {
    if (rafRef.current !== null) return;

    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = null;
      checkScroll();
    });
  }, [checkScroll]);

  useEffect(() => {
    checkScroll();

    window.addEventListener('resize', scheduleCheckScroll);
    const resizeObserver = new ResizeObserver(scheduleCheckScroll);

    const container = containerRef.current;
    if (container) {
      resizeObserver.observe(container);
    }

    return () => {
      window.removeEventListener('resize', scheduleCheckScroll);
      resizeObserver.disconnect();
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [children, checkScroll, scheduleCheckScroll]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new MutationObserver(scheduleCheckScroll);
    observer.observe(container, { childList: true });

    return () => observer.disconnect();
  }, [scheduleCheckScroll]);

  const handleScrollRightClick = () => {
    containerRef.current?.scrollBy({
      left: scrollDistance,
      behavior: 'smooth',
    });
  };

  const handleScrollLeftClick = () => {
    containerRef.current?.scrollBy({
      left: -scrollDistance,
      behavior: 'smooth',
    });
  };

  return (
    <div
      className='relative'
      onMouseEnter={() => {
        setIsHovered(true);
        checkScroll();
      }}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        ref={containerRef}
        className='flex space-x-6 overflow-x-auto scrollbar-hide py-1 sm:py-2 pb-12 sm:pb-14 px-4 sm:px-6'
        onScroll={scheduleCheckScroll}
      >
        {children}
      </div>
      {showLeftScroll && (
        <div
          className={`hidden sm:flex absolute left-0 top-0 bottom-0 w-16 items-center justify-center z-[600] transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'transparent',
            pointerEvents: 'none',
          }}
        >
          <div
            className='absolute inset-0 flex items-center justify-center'
            style={{
              top: '40%',
              bottom: '60%',
              left: '-4.5rem',
              pointerEvents: 'auto',
            }}
          >
            <button
              onClick={handleScrollLeftClick}
              className='w-12 h-12 bg-white/95 rounded-full shadow-lg flex items-center justify-center hover:bg-white border border-gray-200 transition-transform hover:scale-105 dark:bg-gray-800/90 dark:hover:bg-gray-700 dark:border-gray-600'
            >
              <ChevronLeft className='w-6 h-6 text-gray-600 dark:text-gray-300' />
            </button>
          </div>
        </div>
      )}

      {showRightScroll && (
        <div
          className={`hidden sm:flex absolute right-0 top-0 bottom-0 w-16 items-center justify-center z-[600] transition-opacity duration-200 ${
            isHovered ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            background: 'transparent',
            pointerEvents: 'none',
          }}
        >
          <div
            className='absolute inset-0 flex items-center justify-center'
            style={{
              top: '40%',
              bottom: '60%',
              right: '-4.5rem',
              pointerEvents: 'auto',
            }}
          >
            <button
              onClick={handleScrollRightClick}
              className='w-12 h-12 bg-white/95 rounded-full shadow-lg flex items-center justify-center hover:bg-white border border-gray-200 transition-transform hover:scale-105 dark:bg-gray-800/90 dark:hover:bg-gray-700 dark:border-gray-600'
            >
              <ChevronRight className='w-6 h-6 text-gray-600 dark:text-gray-300' />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
