'use client';

import {
  Copy,
  Database,
  ExternalLink,
  RefreshCw,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { Suspense, useMemo, useState } from 'react';

import PageLayout from '@/components/PageLayout';

type SortMode = 'relevance' | 'newest' | 'oldest';
type FileTypeFilter =
  | 'all'
  | 'video'
  | 'subtitle'
  | 'document'
  | 'archive'
  | 'audio'
  | 'image'
  | 'other';
type TimeRangeFilter = 'all' | '24h' | '7d' | '30d' | '90d' | '1y';
type SourceType = 'all' | 'plugin' | 'tg' | 'qqpd' | 'gying' | 'weibo';

interface PanSouSearchItem {
  id: string;
  title: string;
  url: string;
  password: string;
  cloudType: string;
  source: string;
  datetime: string | null;
  fileType: FileTypeFilter;
  images: string[];
}

interface PanSouMergedLink {
  url?: string;
  password?: string;
  note?: string;
  datetime?: string;
  source?: string;
  images?: string[];
}

interface PanSouSearchResponse {
  total?: number;
  data?: {
    total?: number;
    merged_by_type?: Record<string, PanSouMergedLink[]>;
  };
  merged_by_type?: Record<string, PanSouMergedLink[]>;
  error?: string;
}

const CLOUD_TYPES = [
  'baidu',
  'aliyun',
  'quark',
  'uc',
  'xunlei',
  'tianyi',
  '115',
  '123',
];

const SOURCE_OPTIONS: Array<{ value: SourceType; label: string }> = [
  { value: 'all', label: '全源' },
  { value: 'plugin', label: '插件源' },
  { value: 'tg', label: 'TG 源' },
  { value: 'qqpd', label: 'QQ频道 (QQPD)' },
  { value: 'gying', label: 'Gying影视' },
  { value: 'weibo', label: '微博 (Weibo)' },
];

function resolveSourceQuery(sourceType: SourceType): {
  src: 'all' | 'plugin' | 'tg';
  plugins?: string;
} {
  if (
    sourceType === 'qqpd' ||
    sourceType === 'gying' ||
    sourceType === 'weibo'
  ) {
    return {
      src: 'plugin',
      plugins: sourceType,
    };
  }

  return {
    src: sourceType,
  };
}

function detectFileType(input: string): FileTypeFilter {
  const text = input.toLowerCase();
  if (/\.(mp4|mkv|mov|avi|rmvb|ts|m4v|flv|wmv)(\b|$)/.test(text)) {
    return 'video';
  }
  if (/\.(srt|ass|ssa|vtt|sub)(\b|$)/.test(text)) {
    return 'subtitle';
  }
  if (/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|txt|epub|mobi)(\b|$)/.test(text)) {
    return 'document';
  }
  if (/\.(zip|rar|7z|tar|gz|bz2|iso)(\b|$)/.test(text)) {
    return 'archive';
  }
  if (/\.(mp3|wav|flac|aac|m4a)(\b|$)/.test(text)) {
    return 'audio';
  }
  if (/\.(jpg|jpeg|png|gif|webp|bmp|heic)(\b|$)/.test(text)) {
    return 'image';
  }
  return 'other';
}

function toTimestamp(value: string | null): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function inTimeRange(timestamp: number, filter: TimeRangeFilter): boolean {
  if (filter === 'all' || timestamp <= 0) return true;

  const elapsed = Date.now() - timestamp;
  const ranges: Record<Exclude<TimeRangeFilter, 'all'>, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000,
    '1y': 365 * 24 * 60 * 60 * 1000,
  };

  return elapsed <= ranges[filter];
}

function relevanceScore(item: PanSouSearchItem, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;

  const title = item.title.toLowerCase();
  const url = item.url.toLowerCase();
  let score = 0;

  if (title === q) score += 120;
  if (title.includes(q)) score += 80;
  if (url.includes(q)) score += 20;

  return score;
}

function normalizeItems(payload: PanSouSearchResponse): PanSouSearchItem[] {
  const mergedByType = payload.data?.merged_by_type || payload.merged_by_type;
  if (!mergedByType || typeof mergedByType !== 'object') {
    return [];
  }

  const dedup = new Map<string, PanSouSearchItem>();
  Object.entries(mergedByType).forEach(([cloudType, links]) => {
    if (!Array.isArray(links)) return;

    links.forEach((link, index) => {
      const url = typeof link.url === 'string' ? link.url.trim() : '';
      if (!url) return;

      const title =
        (typeof link.note === 'string' ? link.note.trim() : '') || '未命名资源';
      const source =
        (typeof link.source === 'string' ? link.source.trim() : '') ||
        'unknown';
      const datetime =
        typeof link.datetime === 'string' && link.datetime.trim()
          ? link.datetime.trim()
          : null;
      const id = `${cloudType}|${url}|${index}`;

      dedup.set(id, {
        id,
        title,
        url,
        password: typeof link.password === 'string' ? link.password.trim() : '',
        cloudType,
        source,
        datetime,
        fileType: detectFileType(`${title} ${url}`),
        images: Array.isArray(link.images)
          ? link.images.filter((item) => typeof item === 'string')
          : [],
      });
    });
  });

  return Array.from(dedup.values());
}

function NetdiskPageClient() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<PanSouSearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<SortMode>('relevance');
  const [fileType, setFileType] = useState<FileTypeFilter>('all');
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>('all');
  const [sourceType, setSourceType] = useState<SourceType>('all');
  const [selectedCloudTypes, setSelectedCloudTypes] = useState<string[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState('');

  const cloudTypesParam = useMemo(
    () => selectedCloudTypes.join(','),
    [selectedCloudTypes],
  );

  const toggleCloudType = (cloudType: string) => {
    setSelectedCloudTypes((prev) => {
      if (prev.includes(cloudType)) {
        return prev.filter((item) => item !== cloudType);
      }
      return [...prev, cloudType];
    });
  };

  const handleSearch = async (forceRefresh = false) => {
    const keyword = query.trim();
    if (!keyword) return;

    setLoading(true);
    setError('');
    try {
      const sourceQuery = resolveSourceQuery(sourceType);
      const params = new URLSearchParams({
        kw: keyword,
        src: sourceQuery.src,
        res: 'merge',
      });
      if (sourceQuery.plugins) {
        params.set('plugins', sourceQuery.plugins);
      }
      if (cloudTypesParam) {
        params.set('cloud_types', cloudTypesParam);
      }
      if (forceRefresh) {
        params.set('refresh', 'true');
      }

      const response = await fetch(`/api/pansou/search?${params.toString()}`, {
        cache: 'no-store',
      });
      const data = (await response.json()) as PanSouSearchResponse;
      if (!response.ok) {
        throw new Error(data?.error || '网盘搜索失败');
      }

      let normalizedItems = normalizeItems(data);

      if (fileType !== 'all') {
        normalizedItems = normalizedItems.filter(
          (item) => item.fileType === fileType,
        );
      }

      normalizedItems = normalizedItems.filter((item) =>
        inTimeRange(toTimestamp(item.datetime), timeRange),
      );

      if (sort === 'newest' || sort === 'oldest') {
        const factor = sort === 'newest' ? -1 : 1;
        normalizedItems.sort((a, b) => {
          return (toTimestamp(a.datetime) - toTimestamp(b.datetime)) * factor;
        });
      } else {
        normalizedItems.sort(
          (a, b) => relevanceScore(b, keyword) - relevanceScore(a, keyword),
        );
      }

      setItems(normalizedItems);
      setTotal(normalizedItems.length);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : '网盘搜索失败');
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PageLayout activePath='/netdisk'>
      <div className='px-4 sm:px-10 py-4 sm:py-8'>
        <div className='mx-auto w-full max-w-6xl space-y-6'>
          <section className='rounded-2xl border border-cyan-400/20 bg-linear-to-r from-slate-900/90 to-cyan-950/55 p-5 shadow-[0_18px_48px_-28px_rgba(6,182,212,0.8)] backdrop-blur-xl'>
            <div className='mb-4 flex items-center justify-between gap-3'>
              <div>
                <h1 className='text-2xl font-bold text-cyan-200'>
                  PanSou 网盘聚合搜索
                </h1>
                <p className='text-sm text-slate-300'>
                  支持阿里云盘 / 夸克 / 百度网盘等多源检索
                </p>
              </div>
              {lastUpdatedAt && (
                <span className='text-xs text-slate-300'>
                  最近更新: {new Date(lastUpdatedAt).toLocaleString('zh-CN')}
                </span>
              )}
            </div>

            <div className='flex flex-col gap-3 sm:flex-row'>
              <div className='relative flex-1'>
                <Search className='pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400' />
                <input
                  type='text'
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      void handleSearch();
                    }
                  }}
                  placeholder='输入资源关键词，例如：哈利波特合集'
                  className='h-11 w-full rounded-xl border border-slate-600/70 bg-slate-900/55 pl-10 pr-3 text-sm text-slate-100 outline-none transition-colors focus:border-cyan-400/70'
                />
              </div>
              <button
                type='button'
                onClick={() => void handleSearch()}
                disabled={loading}
                className='inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-cyan-400/40 bg-cyan-500/15 px-4 text-sm font-medium text-cyan-100 transition hover:bg-cyan-500/25 disabled:cursor-not-allowed disabled:opacity-60'
              >
                {loading ? (
                  <RefreshCw className='h-4 w-4 animate-spin' />
                ) : (
                  <Search className='h-4 w-4' />
                )}
                搜索
              </button>
              <button
                type='button'
                onClick={() => void handleSearch(true)}
                disabled={loading}
                className='inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-medium text-slate-100 transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60'
              >
                <RefreshCw className='h-4 w-4' />
                强制刷新
              </button>
            </div>

            <div className='mt-3 flex items-center gap-2'>
              <span className='inline-flex items-center gap-1 text-xs text-slate-300'>
                <Database className='h-3.5 w-3.5 text-cyan-300' />
                搜索来源
              </span>
              <div className='flex flex-wrap items-center gap-2'>
                {SOURCE_OPTIONS.map((option) => {
                  const active = sourceType === option.value;
                  return (
                    <button
                      key={option.value}
                      type='button'
                      onClick={() => setSourceType(option.value)}
                      className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                        active
                          ? 'border-cyan-300/60 bg-cyan-500/20 text-cyan-100'
                          : 'border-slate-600/80 bg-slate-800/60 text-slate-200 hover:border-cyan-400/55'
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>

          <section className='rounded-2xl border border-white/10 bg-slate-900/65 p-4 backdrop-blur-xl'>
            <div className='mb-3 flex items-center gap-2 text-sm font-medium text-slate-200'>
              <SlidersHorizontal className='h-4 w-4 text-cyan-300' />
              高级筛选
            </div>
            <div className='grid gap-3 sm:grid-cols-3'>
              <select
                value={sort}
                onChange={(event) => setSort(event.target.value as SortMode)}
                className='h-10 rounded-xl border border-slate-600/70 bg-slate-900/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/70'
              >
                <option value='relevance'>按相关度</option>
                <option value='newest'>按时间（最新）</option>
                <option value='oldest'>按时间（最早）</option>
              </select>
              <select
                value={fileType}
                onChange={(event) =>
                  setFileType(event.target.value as FileTypeFilter)
                }
                className='h-10 rounded-xl border border-slate-600/70 bg-slate-900/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/70'
              >
                <option value='all'>全部文件类型</option>
                <option value='video'>视频</option>
                <option value='subtitle'>字幕</option>
                <option value='document'>文档</option>
                <option value='archive'>压缩包</option>
                <option value='audio'>音频</option>
                <option value='image'>图片</option>
                <option value='other'>其他</option>
              </select>
              <select
                value={timeRange}
                onChange={(event) =>
                  setTimeRange(event.target.value as TimeRangeFilter)
                }
                className='h-10 rounded-xl border border-slate-600/70 bg-slate-900/60 px-3 text-sm text-slate-100 outline-none focus:border-cyan-400/70'
              >
                <option value='all'>全部时间</option>
                <option value='24h'>24 小时内</option>
                <option value='7d'>7 天内</option>
                <option value='30d'>30 天内</option>
                <option value='90d'>90 天内</option>
                <option value='1y'>1 年内</option>
              </select>
            </div>

            <div className='mt-3 flex flex-wrap gap-2'>
              {CLOUD_TYPES.map((cloudType) => {
                const active = selectedCloudTypes.includes(cloudType);
                return (
                  <button
                    key={cloudType}
                    type='button'
                    onClick={() => toggleCloudType(cloudType)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition ${
                      active
                        ? 'border-cyan-300/60 bg-cyan-500/20 text-cyan-100'
                        : 'border-slate-600/80 bg-slate-800/60 text-slate-200 hover:border-cyan-400/55'
                    }`}
                  >
                    {cloudType}
                  </button>
                );
              })}
            </div>
          </section>

          <section className='rounded-2xl border border-white/10 bg-slate-900/65 p-4 backdrop-blur-xl'>
            <div className='mb-4 flex flex-wrap items-center justify-between gap-2'>
              <h2 className='text-lg font-semibold text-slate-100'>
                搜索结果
                <span className='ml-2 text-sm font-normal text-slate-400'>
                  {total} 条
                </span>
              </h2>
            </div>

            {error && (
              <div className='mb-3 rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-sm text-red-200'>
                {error}
              </div>
            )}

            {loading ? (
              <div className='flex h-28 items-center justify-center text-sm text-slate-300'>
                <RefreshCw className='mr-2 h-4 w-4 animate-spin' />
                正在请求远程 PanSou 节点...
              </div>
            ) : items.length === 0 ? (
              <div className='py-10 text-center text-sm text-slate-300 space-y-2'>
                <p>暂无结果，试试调整关键词或筛选条件</p>
                <p className='text-xs text-slate-400'>
                  搜索服务由配置的远程节点提供
                </p>
              </div>
            ) : (
              <div className='space-y-3'>
                {items.map((item) => (
                  <article
                    key={item.id}
                    className='rounded-xl border border-white/10 bg-white/5 p-3'
                  >
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <h3 className='line-clamp-2 text-sm font-medium text-slate-100 sm:text-base'>
                          {item.title}
                        </h3>
                        <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300'>
                          <span className='rounded bg-cyan-500/15 px-2 py-0.5 text-cyan-100'>
                            {item.cloudType}
                          </span>
                          <span>{item.fileType}</span>
                          {item.datetime && (
                            <span>
                              {new Date(item.datetime).toLocaleString('zh-CN')}
                            </span>
                          )}
                          <span>{item.source}</span>
                        </div>
                        {item.password && (
                          <p className='mt-1 text-xs text-amber-200'>
                            提取码: {item.password}
                          </p>
                        )}
                      </div>

                      <div className='flex items-center gap-1.5'>
                        <button
                          type='button'
                          onClick={() => {
                            void navigator.clipboard.writeText(item.url);
                          }}
                          className='inline-flex items-center gap-1 rounded-lg border border-white/15 px-2 py-1 text-xs text-slate-200 transition hover:bg-white/10'
                        >
                          <Copy className='h-3.5 w-3.5' />
                          复制
                        </button>
                        <a
                          href={item.url}
                          target='_blank'
                          rel='noopener noreferrer'
                          className='inline-flex items-center gap-1 rounded-lg border border-cyan-400/35 px-2 py-1 text-xs text-cyan-100 transition hover:bg-cyan-500/15'
                        >
                          <ExternalLink className='h-3.5 w-3.5' />
                          打开
                        </a>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <p className='text-center text-xs text-slate-400'>
            搜索服务由配置的远程节点提供
          </p>
        </div>
      </div>
    </PageLayout>
  );
}

export default function NetdiskPage() {
  return (
    <Suspense>
      <NetdiskPageClient />
    </Suspense>
  );
}
