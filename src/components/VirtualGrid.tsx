/**
 * VirtualGrid - 虚拟滚动网格组件
 *
 * 核心功能：
 * - 使用 react-window v2 实现虚拟滚动
 * - 只渲染可视区域的 DOM 节点，减少 90% 的 DOM 数量
 * - 响应式布局，自动适配不同屏幕尺寸
 * - 智能优先级：前 12 张图片使用 priority 加载
 * - Restored infinite scrolling within VirtualGrid implementation
 *
 * 性能提升：
 * - 100+ 个卡片 → 只渲染 ~20 个可见卡片
 * - 消除主线程阻塞，实现 60FPS 滚动
 *
 * 参考 LunaTV 的虚拟滚动实现
 * 兼容 react-window v2.2.3 API
 */

'use client';

import React, {
  CSSProperties,
  memo,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useImagePreload } from '@/hooks/useImagePreload';
import { useResponsiveGrid } from '@/hooks/useResponsiveGrid';

// ============ 类型定义 ============

export interface VirtualGridItem {
  id?: string;
  title?: string;
  poster?: string;
  year?: string;
  rate?: string;
  douban_id?: number;
}

export interface VirtualGridProps<T extends VirtualGridItem> {
  /** 数据列表 */
  items: T[];
  /** 渲染单个项目的函数 */
  renderItem: (item: T, priority: boolean, index: number) => React.ReactNode;
  /** 容器高度 (px 或 CSS 字符串) */
  height?: number | string;
  /** 额外的容器样式 */
  className?: string;
  /** 优先加载的项目数量 */
  priorityCount?: number;
  /** 是否还有更多数据 (用于无限滚动) */
  hasMore?: boolean;
  /** 是否正在加载更多 */
  isLoadingMore?: boolean;
  /** 加载更多回调 */
  onLoadMore?: () => void;
}

// ============ react-window Grid 类型 ============
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GridComponent = React.ComponentType<any>;

// ============ 主组件 ============

function VirtualGridInner<T extends VirtualGridItem>({
  items,
  renderItem,
  height = 'calc(100vh - 280px)',
  className = '',
  priorityCount = 12,
  hasMore = false,
  isLoadingMore = false,
  onLoadMore,
}: VirtualGridProps<T>): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const [GridComponent, setGridComponent] = useState<GridComponent | null>(
    null,
  );
  // 防止重复触发加载
  const loadMoreTriggeredRef = useRef(false);

  // 动态导入 react-window (ESM 模块)
  useEffect(() => {
    import('react-window').then((module) => {
      setGridComponent(() => module.Grid);
    });
  }, []);

  // 获取响应式网格尺寸
  const { columnCount, itemWidth, itemHeight, containerWidth, gap } =
    useResponsiveGrid(containerRef);

  // 预加载图片
  const imageUrls = useMemo(
    () => items.map((item) => item.poster || '').filter(Boolean),
    [items],
  );
  useImagePreload(imageUrls, priorityCount);

  // Add extra row for loading spinner to trigger infinite scroll
  // 计算行数 (如果有更多数据，额外加一行用于显示 loading 和触发加载)
  const dataRowCount = Math.ceil(items.length / columnCount) || 1;
  const rowCount = hasMore ? dataRowCount + 1 : dataRowCount;

  // 计算实际容器高度
  const containerHeight = useMemo(() => {
    if (typeof height === 'number') return height;
    return 600;
  }, [height]);

  // 计算网格宽度 (包含间距)
  const gridWidth = columnCount * itemWidth + (columnCount - 1) * gap;

  // Restored infinite scrolling within VirtualGrid implementation
  // 触底检测回调 - 放宽阈值到最后 3 行
  const handleCellsRendered = useCallback(
    (info: { visibleRowStopIndex: number }) => {
      const { visibleRowStopIndex } = info;

      // 如果滚动到最后 3 行，且有更多数据，且没有正在加载，且没有重复触发
      if (
        visibleRowStopIndex >= rowCount - 3 &&
        hasMore &&
        !isLoadingMore &&
        !loadMoreTriggeredRef.current &&
        onLoadMore
      ) {
        loadMoreTriggeredRef.current = true;
        onLoadMore();
      }
    },
    [rowCount, hasMore, isLoadingMore, onLoadMore],
  );

  // 当加载完成后重置触发标记
  useEffect(() => {
    if (!isLoadingMore) {
      loadMoreTriggeredRef.current = false;
    }
  }, [isLoadingMore]);

  // 创建 Cell 渲染函数
  const cellComponent = useMemo(() => {
    return function Cell(props: {
      columnIndex: number;
      rowIndex: number;
      style: CSSProperties;
    }): ReactElement {
      const { columnIndex, rowIndex, style } = props;
      const index = rowIndex * columnCount + columnIndex;

      // Loading 行 - 始终显示加载指示器（作为触发区域）
      if (rowIndex >= dataRowCount) {
        // 只在第一列显示 loading，其他列返回空
        if (columnIndex === 0) {
          const loadingStyle: CSSProperties = {
            ...style,
            width: gridWidth,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '20px 0',
          };
          return (
            <div style={loadingStyle}>
              <div className='flex items-center gap-2'>
                <div className='animate-spin rounded-full h-6 w-6 border-b-2 border-green-500'></div>
                <span className='text-gray-600 dark:text-gray-400'>
                  {isLoadingMore ? '加载中...' : '下滑加载更多'}
                </span>
              </div>
            </div>
          );
        }
        return <div style={style} />;
      }

      if (index >= items.length) {
        return <div style={style} />;
      }

      const item = items[index];
      const priority = index < priorityCount;

      const adjustedStyle: CSSProperties = {
        ...style,
        left: Number(style.left) + columnIndex * gap,
        top: Number(style.top) + rowIndex * gap,
        width: Number(style.width),
        height: Number(style.height),
        padding: 0,
      };

      return (
        <div style={adjustedStyle}>{renderItem(item, priority, index)}</div>
      );
    };
  }, [
    items,
    columnCount,
    priorityCount,
    gap,
    renderItem,
    dataRowCount,
    gridWidth,
    isLoadingMore,
  ]);

  // 空数据提示
  if (items.length === 0) {
    return (
      <div
        ref={containerRef}
        className={`flex items-center justify-center text-gray-500 dark:text-gray-400 ${className}`}
        style={{ height: typeof height === 'number' ? height : 200 }}
      >
        暂无数据
      </div>
    );
  }

  // 加载中
  if (!GridComponent) {
    return (
      <div
        ref={containerRef}
        className={`virtual-grid-container ${className}`}
        style={{
          height: typeof height === 'string' ? height : containerHeight,
        }}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className={`virtual-grid-container ${className}`}
      style={{
        height: typeof height === 'string' ? height : undefined,
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {containerWidth > 0 && (
        <GridComponent
          columnCount={columnCount}
          columnWidth={itemWidth}
          rowCount={rowCount}
          rowHeight={itemHeight}
          defaultWidth={gridWidth}
          defaultHeight={containerHeight}
          cellComponent={cellComponent}
          cellProps={{}}
          overscanCount={2}
          onCellsRendered={handleCellsRendered}
          style={{
            overflowX: 'hidden',
            overflowY: 'auto',
            height: containerHeight,
            width: gridWidth,
          }}
        />
      )}
    </div>
  );
}

// 导出 memo 包装的组件
const VirtualGrid = memo(VirtualGridInner) as typeof VirtualGridInner;

export default VirtualGrid;
