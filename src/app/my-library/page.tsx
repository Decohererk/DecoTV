'use client';

import { Loader2, RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { POSTER_FALLBACK_SRC } from '@/lib/image-url';

import ExternalImage from '@/components/ExternalImage';
import PageLayout from '@/components/PageLayout';

type ConnectorType = 'openlist' | 'emby' | 'jellyfin' | 'xiaoya';

interface LibraryItem {
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  poster: string;
  connectorId: string;
  connectorType: ConnectorType;
  connectorName: string;
  connectorDisplayName?: string;
  connectorSourceName: string;
  sourceItemId: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
  originalLanguage?: string;
  tmdbRating?: number;
  runtimeMinutes?: number;
  episodeCount?: number;
  seasonCount?: number;
  isAnime?: boolean;
}

interface LibraryCategoryItem {
  key: string;
  label: string;
  count: number;
}

interface LibraryConnector {
  id: string;
  name: string;
  displayName?: string;
  sourceName: string;
  type: ConnectorType;
  typeLabel: string;
}

interface LibraryErrorItem {
  connectorId: string;
  connectorName: string;
  error: string;
}

interface PaginationPayload {
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number;
}

interface LibraryItemsResponse {
  items?: LibraryItem[];
  categories?: LibraryCategoryItem[];
  connectors?: LibraryConnector[];
  errors?: LibraryErrorItem[];
  pagination?: PaginationPayload;
  error?: string;
  details?: string;
}

interface LibraryStatusResponse {
  enabled: boolean;
  connectors: LibraryConnector[];
  error?: string;
}

interface QueryCacheEntry {
  items: LibraryItem[];
  categories: LibraryCategoryItem[];
  pagination: PaginationPayload;
  connectorErrors: LibraryErrorItem[];
  fetchedAt: number;
}

const PAGE_SIZE = 24;
const AUTO_LOAD_ROOT_MARGIN = '720px 0px';

const SOURCE_BADGE_STYLES: Record<ConnectorType, string> = {
  xiaoya:
    'border-violet-300/35 bg-violet-500/80 text-violet-50 shadow-[0_8px_24px_-16px_rgba(139,92,246,0.9)]',
  openlist:
    'border-teal-300/35 bg-teal-500/80 text-teal-50 shadow-[0_8px_24px_-16px_rgba(20,184,166,0.9)]',
  emby: 'border-sky-300/35 bg-sky-500/80 text-sky-50 shadow-[0_8px_24px_-16px_rgba(14,165,233,0.9)]',
  jellyfin:
    'border-sky-300/35 bg-sky-500/80 text-sky-50 shadow-[0_8px_24px_-16px_rgba(14,165,233,0.9)]',
};
const HERO_PANEL_CLASS =
  'rounded-3xl border border-emerald-200/70 bg-linear-to-r from-white/95 via-emerald-50/80 to-teal-100/70 p-5 shadow-[0_16px_48px_-30px_rgba(16,185,129,0.45)] dark:border-emerald-400/20 dark:from-slate-900/92 dark:via-slate-900/88 dark:to-emerald-950/70 dark:shadow-[0_16px_48px_-30px_rgba(16,185,129,0.55)] sm:p-6';
const SURFACE_PANEL_CLASS =
  'rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-[0_8px_28px_-24px_rgba(14,165,233,0.45)] dark:border-white/10 dark:bg-slate-900/78 dark:shadow-[0_8px_28px_-24px_rgba(14,165,233,0.55)]';
const FILTER_BUTTON_BASE =
  'rounded-xl border px-3 py-1.5 text-sm transition-all';
const FILTER_BUTTON_ACTIVE =
  'border-emerald-400/60 bg-emerald-100/85 text-emerald-700 shadow-sm dark:border-emerald-300/60 dark:bg-emerald-500/20 dark:text-emerald-200';
const FILTER_BUTTON_IDLE =
  'border-slate-200/90 bg-white/85 text-slate-700 hover:border-emerald-300/70 hover:bg-emerald-50/90 hover:text-emerald-700 dark:border-white/10 dark:bg-slate-900/55 dark:text-slate-300 dark:hover:border-emerald-300/30 dark:hover:bg-slate-800/70 dark:hover:text-emerald-200';
const EMPTY_PANEL_CLASS =
  'rounded-3xl border border-dashed border-slate-200/90 bg-white/75 px-6 py-10 text-center shadow-sm dark:border-white/10 dark:bg-slate-900/72';

function filterButtonClass(active: boolean): string {
  return `${FILTER_BUTTON_BASE} ${
    active ? FILTER_BUTTON_ACTIVE : FILTER_BUTTON_IDLE
  }`;
}

function defaultPagination(): PaginationPayload {
  return {
    total: 0,
    offset: 0,
    limit: PAGE_SIZE,
    hasMore: false,
    nextOffset: PAGE_SIZE,
  };
}

function LibrarySkeleton() {
  return (
    <div className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'>
      {Array.from({ length: 12 }).map((_, index) => (
        <div
          key={index}
          className='overflow-hidden rounded-2xl border border-slate-200/80 bg-white/80 dark:border-white/10 dark:bg-slate-900/70'
        >
          <div className='aspect-2/3 animate-pulse bg-slate-200/80 dark:bg-slate-800/80' />
          <div className='space-y-2 p-3'>
            <div className='h-4 animate-pulse rounded bg-slate-200/80 dark:bg-slate-800/80' />
            <div className='h-3 w-2/3 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70' />
            <div className='h-3 w-1/2 animate-pulse rounded bg-slate-200/70 dark:bg-slate-800/70' />
          </div>
        </div>
      ))}
    </div>
  );
}

function mergeLibraryItems(
  currentItems: LibraryItem[],
  nextItems: LibraryItem[],
): LibraryItem[] {
  const merged = new Map<string, LibraryItem>();

  for (const item of currentItems) {
    merged.set(`${item.connectorId}:${item.sourceItemId}`, item);
  }

  for (const item of nextItems) {
    merged.set(`${item.connectorId}:${item.sourceItemId}`, item);
  }

  return Array.from(merged.values());
}

function getConnectorUiLabel(
  connector: LibraryConnector,
  connectors: LibraryConnector[],
): string {
  const baseLabel =
    connector.sourceName?.trim() ||
    connector.displayName?.trim() ||
    connector.name ||
    connector.typeLabel;
  const duplicateCount = connectors.filter((item) => {
    const itemLabel =
      item.sourceName?.trim() ||
      item.displayName?.trim() ||
      item.name ||
      item.typeLabel;

    return itemLabel === baseLabel;
  }).length;

  if (duplicateCount <= 1) {
    return baseLabel;
  }

  return `${baseLabel} · ${connector.id.slice(-4)}`;
}

function mediaTypeLabel(item: LibraryItem): string {
  if (item.isAnime) {
    return '动漫';
  }

  return item.mediaType === 'movie' ? '电影' : '剧集';
}

function formatSourceLabel(item: LibraryItem): string {
  return (
    item.connectorSourceName || item.connectorDisplayName || item.connectorName
  );
}

function makeQueryKey(
  selectedSource: string,
  selectedCategory: string,
  searchKeyword: string,
): string {
  return [
    selectedSource || 'all',
    selectedCategory || 'all',
    searchKeyword || '',
  ]
    .map((value) => encodeURIComponent(value))
    .join('::');
}

function makePageKey(queryKey: string, offset: number): string {
  return `${queryKey}::${offset}`;
}

function buildRequestQuery(params: {
  connectorId?: string;
  category?: string;
  keyword?: string;
  offset?: number;
  limit?: number;
  refresh?: boolean;
}): URLSearchParams {
  const query = new URLSearchParams();
  query.set('offset', String(params.offset ?? 0));
  query.set('limit', String(params.limit ?? PAGE_SIZE));

  if (params.connectorId && params.connectorId !== 'all') {
    query.set('connectorId', params.connectorId);
  }

  if (params.category && params.category !== 'all') {
    query.set('category', params.category);
  }

  if (params.keyword) {
    query.set('q', params.keyword);
  }

  if (params.refresh) {
    query.set('refresh', '1');
  }

  return query;
}

function createCacheEntryFromResponse(
  response: LibraryItemsResponse,
  itemsOverride?: LibraryItem[],
): QueryCacheEntry {
  return {
    items: itemsOverride ?? response.items ?? [],
    categories: response.categories ?? [],
    pagination: response.pagination ?? defaultPagination(),
    connectorErrors: response.errors ?? [],
    fetchedAt: Date.now(),
  };
}

export default function MyLibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [categories, setCategories] = useState<LibraryCategoryItem[]>([]);
  const [connectors, setConnectors] = useState<LibraryConnector[]>([]);
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [connectorErrors, setConnectorErrors] = useState<LibraryErrorItem[]>(
    [],
  );
  const [pagination, setPagination] =
    useState<PaginationPayload>(defaultPagination());

  const queryCacheRef = useRef<Map<string, QueryCacheEntry>>(new Map());
  const pageCacheRef = useRef<Map<string, LibraryItemsResponse>>(new Map());
  const warmingQueryRef = useRef<Set<string>>(new Set());
  const inFlightPageRef = useRef<Set<string>>(new Set());
  const autoLoadLockRef = useRef('');
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<LibraryItem[]>([]);
  const categoriesRef = useRef<LibraryCategoryItem[]>([]);
  const connectorErrorsRef = useRef<LibraryErrorItem[]>([]);
  const paginationRef = useRef<PaginationPayload>(defaultPagination());

  const queryKey = useMemo(
    () => makeQueryKey(selectedSource, selectedCategory, searchKeyword),
    [searchKeyword, selectedCategory, selectedSource],
  );

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  useEffect(() => {
    categoriesRef.current = categories;
  }, [categories]);

  useEffect(() => {
    connectorErrorsRef.current = connectorErrors;
  }, [connectorErrors]);

  useEffect(() => {
    paginationRef.current = pagination;
  }, [pagination]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchKeyword(keyword.trim());
    }, 250);

    return () => window.clearTimeout(timer);
  }, [keyword]);

  const applyQueryEntry = useCallback((entry: QueryCacheEntry) => {
    setItems(entry.items);
    setCategories(entry.categories);
    setPagination(entry.pagination);
    setConnectorErrors(entry.connectorErrors);
    setError('');
  }, []);

  const requestPage = useCallback(
    async ({
      connectorId,
      category,
      keyword: currentKeyword,
      offset,
      refresh,
    }: {
      connectorId: string;
      category: string;
      keyword: string;
      offset: number;
      refresh?: boolean;
    }): Promise<LibraryItemsResponse> => {
      const query = buildRequestQuery({
        connectorId,
        category,
        keyword: currentKeyword,
        offset,
        limit: PAGE_SIZE,
        refresh,
      });
      const response = await fetch(`/api/private-library/items?${query}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as LibraryItemsResponse;

      if (!response.ok) {
        throw new Error(data.error || data.details || '读取私人影库失败');
      }

      return data;
    },
    [],
  );

  const primePageCache = useCallback(
    async ({
      queryKey: targetQueryKey,
      connectorId,
      category,
      keyword: currentKeyword,
      offset,
    }: {
      queryKey: string;
      connectorId: string;
      category: string;
      keyword: string;
      offset: number;
    }) => {
      const pageKey = makePageKey(targetQueryKey, offset);
      if (
        pageCacheRef.current.has(pageKey) ||
        inFlightPageRef.current.has(pageKey)
      ) {
        return;
      }

      inFlightPageRef.current.add(pageKey);
      try {
        const data = await requestPage({
          connectorId,
          category,
          keyword: currentKeyword,
          offset,
        });
        pageCacheRef.current.set(pageKey, data);
      } catch {
        // 静默预热失败，避免打断当前页面交互。
      } finally {
        inFlightPageRef.current.delete(pageKey);
      }
    },
    [requestPage],
  );

  const warmConnectorCache = useCallback(
    async (connectorId: string) => {
      const sourceQueryKey = makeQueryKey(connectorId, 'all', '');
      if (
        queryCacheRef.current.has(sourceQueryKey) ||
        warmingQueryRef.current.has(sourceQueryKey)
      ) {
        return;
      }

      warmingQueryRef.current.add(sourceQueryKey);
      try {
        const data = await requestPage({
          connectorId,
          category: 'all',
          keyword: '',
          offset: 0,
        });
        const entry = createCacheEntryFromResponse(data);
        queryCacheRef.current.set(sourceQueryKey, entry);

        if (entry.pagination.hasMore) {
          void primePageCache({
            queryKey: sourceQueryKey,
            connectorId,
            category: 'all',
            keyword: '',
            offset: entry.pagination.nextOffset,
          });
        }
      } catch {
        // 来源预热失败时不影响当前页面。
      } finally {
        warmingQueryRef.current.delete(sourceQueryKey);
      }
    },
    [primePageCache, requestPage],
  );

  const fetchConnectors = useCallback(async () => {
    try {
      const response = await fetch('/api/private-library/status', {
        cache: 'no-store',
      });
      const data = (await response.json()) as LibraryStatusResponse;

      if (!response.ok) {
        throw new Error(data.error || '读取影库来源失败');
      }

      setConnectors(data.connectors || []);
    } catch {
      // 保留已存在的来源信息，避免界面来源栏闪烁。
    }
  }, []);

  const fetchItems = useCallback(
    async ({
      append = false,
      offset = 0,
      forceRefresh = false,
    }: {
      append?: boolean;
      offset?: number;
      forceRefresh?: boolean;
    } = {}) => {
      if (!append && !forceRefresh) {
        const cached = queryCacheRef.current.get(queryKey);
        if (cached) {
          applyQueryEntry(cached);
          setLoading(false);

          if (cached.pagination.hasMore) {
            void primePageCache({
              queryKey,
              connectorId: selectedSource,
              category: selectedCategory,
              keyword: searchKeyword,
              offset: cached.pagination.nextOffset,
            });
          }
          return;
        }
      }

      if (append && !forceRefresh) {
        const pageKey = makePageKey(queryKey, offset);
        const prefetched = pageCacheRef.current.get(pageKey);
        if (prefetched) {
          pageCacheRef.current.delete(pageKey);

          const previousEntry =
            queryCacheRef.current.get(queryKey) ||
            createCacheEntryFromResponse(
              {
                categories: categoriesRef.current,
                errors: connectorErrorsRef.current,
                pagination: paginationRef.current,
              },
              itemsRef.current,
            );
          const mergedItems = mergeLibraryItems(
            previousEntry.items,
            prefetched.items || [],
          );
          const nextEntry = createCacheEntryFromResponse(
            prefetched,
            mergedItems,
          );
          queryCacheRef.current.set(queryKey, nextEntry);
          applyQueryEntry(nextEntry);

          if (nextEntry.pagination.hasMore) {
            void primePageCache({
              queryKey,
              connectorId: selectedSource,
              category: selectedCategory,
              keyword: searchKeyword,
              offset: nextEntry.pagination.nextOffset,
            });
          }
          return;
        }
      }

      if (append) {
        setLoadingMore(true);
      } else if (forceRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        setError('');
        const data = await requestPage({
          connectorId: selectedSource,
          category: selectedCategory,
          keyword: searchKeyword,
          offset,
          refresh: forceRefresh,
        });

        const previousEntry =
          append && queryCacheRef.current.has(queryKey)
            ? queryCacheRef.current.get(queryKey)
            : null;
        const nextItems = append
          ? mergeLibraryItems(
              previousEntry?.items || itemsRef.current,
              data.items || [],
            )
          : data.items || [];
        const nextEntry = createCacheEntryFromResponse(data, nextItems);
        queryCacheRef.current.set(queryKey, nextEntry);
        pageCacheRef.current.delete(makePageKey(queryKey, offset));
        applyQueryEntry(nextEntry);

        if ((data.connectors || []).length > 0) {
          setConnectors((current) =>
            current.length > 0 ? current : data.connectors || current,
          );
        }

        if (nextEntry.pagination.hasMore) {
          void primePageCache({
            queryKey,
            connectorId: selectedSource,
            category: selectedCategory,
            keyword: searchKeyword,
            offset: nextEntry.pagination.nextOffset,
          });
        }
      } catch (currentError) {
        if (!append) {
          const cached = queryCacheRef.current.get(queryKey);
          if (cached) {
            applyQueryEntry(cached);
          } else {
            setItems([]);
            setCategories([]);
            setPagination(defaultPagination());
            setConnectorErrors([]);
          }
        }

        setError(
          currentError instanceof Error
            ? currentError.message
            : '读取私人影库失败',
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [
      applyQueryEntry,
      primePageCache,
      queryKey,
      requestPage,
      searchKeyword,
      selectedCategory,
      selectedSource,
    ],
  );

  useEffect(() => {
    void fetchConnectors();
  }, [fetchConnectors]);

  useEffect(() => {
    void fetchItems({ append: false, offset: 0 });
  }, [fetchItems]);

  useEffect(() => {
    if (
      selectedSource !== 'all' &&
      connectors.length > 0 &&
      !connectors.some((item) => item.id === selectedSource)
    ) {
      setSelectedSource('all');
    }
  }, [connectors, selectedSource]);

  useEffect(() => {
    if (
      selectedCategory !== 'all' &&
      categories.length > 0 &&
      !categories.some((item) => item.key === selectedCategory)
    ) {
      setSelectedCategory('all');
    }
  }, [categories, selectedCategory]);

  useEffect(() => {
    if (connectors.length <= 1) {
      return;
    }

    const timer = window.setTimeout(() => {
      for (const connector of connectors) {
        void warmConnectorCache(connector.id);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [connectors, warmConnectorCache]);

  useEffect(() => {
    autoLoadLockRef.current = '';
  }, [queryKey]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node || !pagination.hasMore || loading || error) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || loadingMore) {
          return;
        }

        const nextLoadKey = `${queryKey}:${pagination.nextOffset}`;
        if (autoLoadLockRef.current === nextLoadKey) {
          return;
        }

        autoLoadLockRef.current = nextLoadKey;
        void fetchItems({
          append: true,
          offset: pagination.nextOffset,
        });
      },
      {
        rootMargin: AUTO_LOAD_ROOT_MARGIN,
      },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [
    error,
    fetchItems,
    loading,
    loadingMore,
    pagination.hasMore,
    pagination.nextOffset,
    queryKey,
  ]);

  const activeSummary = useMemo(() => {
    const currentCategory = categories.find(
      (item) => item.key === selectedCategory,
    );
    const sourceLabel =
      selectedSource === 'all'
        ? '全部来源'
        : connectors.find((item) => item.id === selectedSource)?.sourceName ||
          '当前来源';

    if (currentCategory) {
      return `${sourceLabel} · ${currentCategory.label} · ${currentCategory.count}`;
    }

    return `${sourceLabel} · 共 ${pagination.total} 部资源`;
  }, [
    categories,
    connectors,
    pagination.total,
    selectedCategory,
    selectedSource,
  ]);

  const renderCard = (item: LibraryItem) => {
    const playUrl = `/play?source=private_library&id=${encodeURIComponent(item.id)}&title=${encodeURIComponent(item.title)}&year=${encodeURIComponent(item.year ? String(item.year) : '')}&stitle=${encodeURIComponent(item.title)}&stype=${encodeURIComponent(item.mediaType)}&connectorId=${encodeURIComponent(item.connectorId)}&sourceItemId=${encodeURIComponent(item.sourceItemId)}`;
    const metaLine = [
      item.tmdbRating ? `TMDB ${item.tmdbRating.toFixed(1)}` : '',
      item.year ? String(item.year) : '',
      item.mediaType === 'tv'
        ? item.episodeCount
          ? `${item.episodeCount} 集`
          : ''
        : item.runtimeMinutes
          ? `${item.runtimeMinutes} 分钟`
          : '',
    ]
      .filter(Boolean)
      .join(' · ');

    return (
      <div
        key={`${item.connectorId}-${item.sourceItemId}`}
        className='group overflow-hidden rounded-2xl border border-slate-200/80 bg-white/85 shadow-[0_16px_40px_-30px_rgba(15,23,42,0.28)] transition-all hover:border-emerald-300/60 hover:bg-emerald-50/30 dark:border-white/10 dark:bg-slate-900/72 dark:shadow-[0_16px_40px_-28px_rgba(15,23,42,0.8)] dark:hover:border-emerald-300/30 dark:hover:bg-slate-900/86'
      >
        <Link href={playUrl} className='block'>
          <div className='relative aspect-2/3 bg-slate-100 dark:bg-slate-800/70'>
            <ExternalImage
              src={item.poster || POSTER_FALLBACK_SRC}
              alt={item.title}
              fill
              className='object-cover transition-transform duration-300 group-hover:scale-[1.02]'
              sizes='(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 16vw'
              fallbackSrc={POSTER_FALLBACK_SRC}
            />
            <div className='pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-linear-to-t from-slate-950 via-slate-950/45 to-transparent' />
            <div
              className={`absolute left-3 top-3 inline-flex max-w-[60%] truncate rounded-full border px-2 py-1 text-[11px] font-semibold backdrop-blur-sm ${SOURCE_BADGE_STYLES[item.connectorType]}`}
              title={formatSourceLabel(item)}
            >
              {formatSourceLabel(item)}
            </div>
            <div className='absolute right-3 top-3 inline-flex rounded-full border border-white/15 bg-slate-950/70 px-2 py-1 text-[11px] font-medium text-slate-100 backdrop-blur-sm'>
              {mediaTypeLabel(item)}
            </div>
          </div>
        </Link>

        <div className='space-y-2 p-3'>
          <div className='line-clamp-2 text-sm font-semibold text-slate-900 dark:text-slate-100'>
            {item.title}
          </div>

          {metaLine ? (
            <div className='text-xs text-slate-500 dark:text-slate-400'>
              {metaLine}
            </div>
          ) : null}

          {item.libraryName ? (
            <div className='text-xs text-slate-500 dark:text-slate-400'>
              {item.libraryName}
            </div>
          ) : null}

          {item.genres && item.genres.length > 0 ? (
            <div className='flex flex-wrap gap-1.5'>
              {item.genres.slice(0, 3).map((genre) => (
                <span
                  key={`${item.id}-${genre}`}
                  className='inline-flex rounded-full border border-emerald-300/40 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200'
                >
                  {genre}
                </span>
              ))}
            </div>
          ) : null}

          {item.overview ? (
            <p className='line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400'>
              {item.overview}
            </p>
          ) : null}
        </div>
      </div>
    );
  };

  return (
    <PageLayout activePath='/my-library'>
      <main className='mx-auto max-w-7xl space-y-6 px-4 pb-24 pt-24 sm:px-6'>
        <section className={HERO_PANEL_CLASS}>
          <div className='flex flex-wrap items-start justify-between gap-4'>
            <div>
              <h1 className='text-2xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-300'>
                我的影库
              </h1>
              <p className='mt-1 text-sm text-slate-600 dark:text-slate-300/90'>
                聚合已接入的 OpenList、小雅 Alist、Emby、Jellyfin 私人媒体资源，
                支持按来源、分类和关键词快速浏览。
              </p>
            </div>
            <div className='inline-flex rounded-full border border-emerald-200/80 bg-emerald-100/80 px-3 py-1 text-xs font-medium text-emerald-700 dark:border-emerald-300/20 dark:bg-emerald-500/10 dark:text-emerald-200'>
              {activeSummary}
            </div>
          </div>

          <div className='mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]'>
            <label className='relative'>
              <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400' />
              <input
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder='搜索片名、简介、类型或来源名称...'
                className='h-11 w-full rounded-xl border border-slate-200/90 bg-white/85 pl-10 pr-4 text-sm text-slate-900 outline-none shadow-sm transition-colors placeholder:text-slate-400 focus:border-emerald-400/70 dark:border-slate-600/60 dark:bg-slate-900/45 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-emerald-400/60'
              />
            </label>
            <button
              type='button'
              onClick={() => {
                queryCacheRef.current.clear();
                pageCacheRef.current.clear();
                warmingQueryRef.current.clear();
                inFlightPageRef.current.clear();
                autoLoadLockRef.current = '';
                void fetchConnectors();
                void fetchItems({
                  append: false,
                  offset: 0,
                  forceRefresh: true,
                });
              }}
              className='inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-white/85 px-4 py-2.5 text-sm text-slate-700 shadow-sm transition-colors hover:border-emerald-300/70 hover:bg-emerald-50/90 hover:text-emerald-700 dark:border-slate-600/70 dark:bg-slate-900/45 dark:text-slate-100 dark:hover:border-emerald-400/50 dark:hover:bg-slate-800/70 dark:hover:text-emerald-200'
            >
              {refreshing ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <RefreshCw className='h-4 w-4' />
              )}
              刷新影库
            </button>
          </div>
        </section>

        {connectors.length > 1 ? (
          <section className={SURFACE_PANEL_CLASS}>
            <div className='flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400'>
              <SlidersHorizontal className='h-4 w-4' />
              来源筛选
            </div>

            <div className='mt-4 flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() => {
                  setSelectedSource('all');
                  setSelectedCategory('all');
                }}
                className={filterButtonClass(selectedSource === 'all')}
              >
                全部来源
              </button>
              {connectors.map((connector) => (
                <button
                  key={connector.id}
                  type='button'
                  onClick={() => {
                    setSelectedSource(connector.id);
                    setSelectedCategory('all');
                  }}
                  className={filterButtonClass(selectedSource === connector.id)}
                >
                  {getConnectorUiLabel(connector, connectors)}
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {categories.length > 0 ? (
          <section className={SURFACE_PANEL_CLASS}>
            <div className='flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400'>
              <SlidersHorizontal className='h-4 w-4' />
              分类浏览
            </div>

            <div className='mt-4 flex flex-wrap gap-2'>
              {categories.map((category) => {
                const active = category.key === selectedCategory;

                return (
                  <button
                    key={category.key}
                    type='button'
                    onClick={() => setSelectedCategory(category.key)}
                    className={filterButtonClass(active)}
                  >
                    {category.label}
                    <span className='ml-1 text-xs opacity-80'>
                      {category.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {loading ? <LibrarySkeleton /> : null}

        {!loading && error ? (
          <section className='rounded-2xl border border-red-200 bg-red-50 px-4 py-5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-100'>
            {error}
          </section>
        ) : null}

        {!loading && connectorErrors.length > 0 ? (
          <section className='rounded-2xl border border-amber-200 bg-amber-50 px-4 py-5 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-100'>
            <div className='font-semibold'>部分连接加载失败</div>
            <div className='mt-2 space-y-1 text-amber-700 dark:text-amber-50/90'>
              {connectorErrors.map((item) => (
                <p key={item.connectorId}>
                  {item.connectorName}：{item.error}
                </p>
              ))}
            </div>
          </section>
        ) : null}

        {!loading && !error && items.length === 0 ? (
          <section className={EMPTY_PANEL_CLASS}>
            <p className='text-lg font-semibold text-slate-900 dark:text-slate-100'>
              当前条件下没有找到可显示的资源
            </p>
            <p className='mt-2 text-sm text-slate-500 dark:text-slate-400'>
              可以尝试切换来源、清空搜索关键词，或者前往后台重新扫描私人影库连接。
            </p>
            <div className='mt-4 flex justify-center gap-3'>
              <button
                type='button'
                onClick={() => {
                  setSelectedSource('all');
                  setSelectedCategory('all');
                  setKeyword('');
                  setSearchKeyword('');
                }}
                className='rounded-xl border border-emerald-300/50 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 transition-colors hover:bg-emerald-100/80 dark:border-emerald-300/30 dark:bg-emerald-500/10 dark:text-emerald-200 dark:hover:bg-emerald-500/20'
              >
                清空筛选
              </button>
              <Link
                href='/admin'
                className='rounded-xl border border-slate-200/90 bg-white/85 px-4 py-2 text-sm text-slate-700 transition-colors hover:border-emerald-300/70 hover:bg-emerald-50/90 hover:text-emerald-700 dark:border-white/10 dark:bg-slate-900/70 dark:text-slate-200 dark:hover:border-emerald-300/30 dark:hover:bg-slate-800/70 dark:hover:text-emerald-200'
              >
                前往后台配置
              </Link>
            </div>
          </section>
        ) : null}

        {!loading && !error && items.length > 0 ? (
          <>
            <section className='grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'>
              {items.map((item) => renderCard(item))}
            </section>

            <div className='flex flex-col items-center gap-3'>
              <p className='text-xs text-slate-500 dark:text-slate-400'>
                已显示 {items.length} / {pagination.total} 部资源
              </p>

              {pagination.hasMore ? (
                <div
                  ref={loadMoreRef}
                  className='flex min-h-14 items-center justify-center'
                >
                  {loadingMore ? (
                    <div className='inline-flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white/85 px-5 py-2.5 text-sm text-slate-700 shadow-sm dark:border-slate-600/70 dark:bg-slate-900/55 dark:text-slate-100'>
                      <Loader2 className='h-4 w-4 animate-spin' />
                      正在加载更多资源...
                    </div>
                  ) : (
                    <div className='rounded-xl border border-dashed border-slate-200/90 bg-white/70 px-5 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-400'>
                      下滑到底部会自动加载更多
                    </div>
                  )}
                </div>
              ) : (
                <div className='rounded-xl border border-dashed border-slate-200/90 bg-white/70 px-5 py-2 text-xs text-slate-500 dark:border-white/10 dark:bg-slate-900/45 dark:text-slate-400'>
                  当前来源的资源已经全部加载完成
                </div>
              )}
            </div>
          </>
        ) : null}
      </main>
    </PageLayout>
  );
}
