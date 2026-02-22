'use client';

import { ReactNode, useCallback, useMemo } from 'react';
import { VirtuosoGrid } from 'react-virtuoso';

type VirtualizationMode = 'auto' | 'always' | 'never';

interface VirtualizedVideoGridProps<T> {
  data: T[] | null | undefined;
  className: string;
  itemClassName?: string;
  itemKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number) => ReactNode;
  onEndReached?: (index: number) => void;
  hasMore?: boolean;
  isLoadingMore?: boolean;
  mode?: VirtualizationMode;
  virtualizationThreshold?: number;
  overscan?: number;
}

function getAdaptiveOverscan(overscan?: number): number {
  if (typeof overscan === 'number' && Number.isFinite(overscan)) {
    return Math.min(Math.max(Math.round(overscan), 420), 1800);
  }

  if (typeof navigator === 'undefined') {
    return 900;
  }

  const deviceMemory = (navigator as { deviceMemory?: number } | undefined)
    ?.deviceMemory;

  if (typeof deviceMemory === 'number') {
    if (deviceMemory <= 4) {
      return 620;
    }
    if (deviceMemory <= 8) {
      return 820;
    }
  }

  return 980;
}

function resolveItemId(item: unknown): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const record = item as Record<string, unknown>;
  const candidates = ['vod_id', 'id', 'douban_id', 'uuid', 'key', 'slug'];

  for (const candidate of candidates) {
    const value = record[candidate];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

export default function VirtualizedVideoGrid<T>({
  data,
  className,
  itemClassName = 'w-full',
  itemKey,
  renderItem,
  onEndReached,
  hasMore = true,
  isLoadingMore = false,
  mode = 'auto',
  virtualizationThreshold = 80,
  overscan,
}: VirtualizedVideoGridProps<T>) {
  // NOTE: 防御性保护 —— 确保 data 始终是有效数组，避免上游传入 undefined/null 时崩溃
  const dataIsArray = Array.isArray(data);
  const safeData = useMemo(
    () => (dataIsArray ? data : ([] as T[])),
    [data, dataIsArray],
  );
  const shouldVirtualize =
    mode === 'always' ||
    (mode === 'auto' && safeData.length >= virtualizationThreshold);

  const resolvedKeys = useMemo(() => {
    const keyCount = new Map<string, number>();

    return safeData.map((item, index) => {
      const rawKey = itemKey(item, index);
      const trimmedKey = rawKey?.trim();
      const baseKey = trimmedKey || resolveItemId(item) || 'unknown-item';
      const duplicateCount = keyCount.get(baseKey) ?? 0;

      keyCount.set(baseKey, duplicateCount + 1);

      if (duplicateCount === 0) {
        return baseKey;
      }

      return `${baseKey}_${index}`;
    });
  }, [safeData, itemKey]);

  const handleEndReached = useCallback(
    (index: number) => {
      if (!onEndReached) return;
      if (!hasMore || isLoadingMore || safeData.length === 0) return;
      onEndReached(index);
    },
    [safeData.length, hasMore, isLoadingMore, onEndReached],
  );

  const footer = useCallback(() => {
    if (!onEndReached) {
      return null;
    }

    return (
      <div className='flex min-h-[60px] w-full items-center justify-center py-4'>
        {isLoadingMore ? (
          <span
            className='inline-block h-5 w-5 animate-spin rounded-full border-2 border-slate-500/50 border-t-emerald-300'
            aria-hidden='true'
          />
        ) : null}
      </div>
    );
  }, [isLoadingMore, onEndReached]);
  const emptyFooter = useCallback(() => null, []);

  const normalizedOverscan = useMemo(
    () => getAdaptiveOverscan(overscan),
    [overscan],
  );
  const reverseOverscan = Math.max(Math.round(normalizedOverscan * 0.85), 360);
  const mainOverscan = normalizedOverscan;

  const components = useMemo(
    () => ({
      Footer: onEndReached ? footer : emptyFooter,
    }),
    [emptyFooter, footer, onEndReached],
  );

  const endReached = onEndReached ? handleEndReached : undefined;

  const increaseViewportBy = useMemo(
    () => ({
      top: Math.max(Math.round(normalizedOverscan * 0.45), 260),
      bottom: Math.max(Math.round(normalizedOverscan * 0.75), 360),
    }),
    [normalizedOverscan],
  );

  if (!dataIsArray) {
    return (
      <div className='py-8 text-center text-sm text-slate-500 dark:text-slate-400'>
        加载失败，请重试
      </div>
    );
  }

  if (!shouldVirtualize) {
    return (
      <div className={className}>
        {safeData.map((item, index) => (
          <div
            key={resolvedKeys[index]}
            className={itemClassName}
            style={{
              contentVisibility: 'auto',
              containIntrinsicSize: '360px',
            }}
          >
            {renderItem(item, index)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <VirtuosoGrid
      useWindowScroll
      data={safeData}
      listClassName={className}
      itemClassName={itemClassName}
      overscan={{ main: mainOverscan, reverse: reverseOverscan }}
      increaseViewportBy={increaseViewportBy}
      computeItemKey={(index) => resolvedKeys[index]}
      itemContent={(index, item) => renderItem(item, index)}
      components={components}
      endReached={endReached}
    />
  );
}
