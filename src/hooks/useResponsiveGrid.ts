/**
 * useResponsiveGrid - 响应式网格布局 Hook
 *
 * 功能：
 * - 基于 ResizeObserver 动态计算网格列数
 * - 支持 sm/md/lg/xl/2xl 断点
 * - 自动计算每个单元格的尺寸
 *
 * 参考 LunaTV 的响应式布局策略
 */

'use client';

import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

// ============ 类型定义 ============

export interface GridDimensions {
  /** 网格列数 */
  columnCount: number;
  /** 每个单元格宽度 (px) */
  itemWidth: number;
  /** 每个单元格高度 (px) - 海报比例约 1:1.5 + 标题区域 */
  itemHeight: number;
  /** 容器宽度 (px) */
  containerWidth: number;
  /** 单元格间距 (px) */
  gap: number;
}

// ============ 断点配置 ============

interface Breakpoint {
  minWidth: number;
  columns: number;
  gap: number;
}

const BREAKPOINTS: Breakpoint[] = [
  { minWidth: 1536, columns: 8, gap: 24 }, // 2xl
  { minWidth: 1280, columns: 7, gap: 20 }, // xl
  { minWidth: 1024, columns: 6, gap: 16 }, // lg
  { minWidth: 768, columns: 5, gap: 12 }, // md
  { minWidth: 640, columns: 4, gap: 10 }, // sm
  { minWidth: 0, columns: 3, gap: 8 }, // xs (mobile)
];

// 海报宽高比 (宽:高) - 标准海报比例
const POSTER_ASPECT_RATIO = 2 / 3;
// 标题区域高度
const TITLE_AREA_HEIGHT = 60;

// ============ Hook 实现 ============

/**
 * 响应式网格 Hook
 *
 * @param containerRef 可选的容器引用，用于精确测量
 * @returns 网格尺寸信息
 *
 * @example
 * ```tsx
 * const containerRef = useRef<HTMLDivElement>(null);
 * const { columnCount, itemWidth, itemHeight } = useResponsiveGrid(containerRef);
 * ```
 */
export function useResponsiveGrid(
  containerRef?: React.RefObject<HTMLElement | null>,
): GridDimensions {
  const [dimensions, setDimensions] = useState<GridDimensions>({
    columnCount: 6,
    itemWidth: 160,
    itemHeight: 300,
    containerWidth: 1200,
    gap: 16,
  });

  /**
   * 根据容器宽度计算网格尺寸
   */
  const calculateDimensions = useCallback((width: number): GridDimensions => {
    // 找到匹配的断点
    const breakpoint =
      BREAKPOINTS.find((bp) => width >= bp.minWidth) ||
      BREAKPOINTS[BREAKPOINTS.length - 1];

    const { columns, gap } = breakpoint;

    // 计算每个单元格的宽度
    // 公式: itemWidth = (containerWidth - gap * (columns - 1)) / columns
    const totalGapWidth = gap * (columns - 1);
    const itemWidth = Math.floor((width - totalGapWidth) / columns);

    // 计算高度：海报高度 + 标题区域
    const posterHeight = Math.floor(itemWidth / POSTER_ASPECT_RATIO);
    const itemHeight = posterHeight + TITLE_AREA_HEIGHT;

    return {
      columnCount: columns,
      itemWidth,
      itemHeight,
      containerWidth: width,
      gap,
    };
  }, []);

  /**
   * 更新尺寸的处理函数
   */
  const updateDimensions = useCallback(() => {
    let width: number;

    if (containerRef?.current) {
      // 优先使用容器实际宽度
      width = containerRef.current.clientWidth;
    } else {
      // 回退到窗口宽度
      width = typeof window !== 'undefined' ? window.innerWidth : 1200;
    }

    // 减去页面边距 (移动端 16px * 2，桌面端 40px * 2)
    const padding = width < 640 ? 32 : 80;
    const effectiveWidth = width - padding;

    setDimensions(calculateDimensions(effectiveWidth));
  }, [containerRef, calculateDimensions]);

  // 使用 useLayoutEffect 在 DOM 更新后同步计算
  // 避免闪烁
  useLayoutEffect(() => {
    updateDimensions();
  }, [updateDimensions]);

  // 监听窗口大小变化
  useEffect(() => {
    if (typeof window === 'undefined') return;

    // 如果有容器引用，使用 ResizeObserver
    if (containerRef?.current) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === containerRef.current) {
            updateDimensions();
          }
        }
      });

      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }

    // 否则监听窗口 resize
    const handleResize = () => {
      updateDimensions();
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [containerRef, updateDimensions]);

  return dimensions;
}

export default useResponsiveGrid;
