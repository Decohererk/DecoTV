/* eslint-disable no-console */
'use client';

import { useCallback, useEffect, useState } from 'react';

import { ApiSite } from '@/lib/config';
import {
  getStoredSourceBrowserValue,
  setStoredSourceBrowserValue,
  SOURCE_BROWSER_CHANGE_EVENT,
  SOURCE_BROWSER_STORAGE_KEY,
} from '@/lib/source-browser';

export interface SourceCategory {
  type_id: string | number;
  type_name: string;
  type_pid?: string | number;
}

interface SourceCategoryResponse extends Record<string, unknown> {
  class?: unknown;
  list?: unknown;
}

interface ServerConfigResponse {
  AdultFilterEnabled?: boolean;
}

export interface UseSourceFilterReturn {
  sources: ApiSite[];
  currentSource: string;
  sourceCategories: SourceCategory[];
  isLoadingSources: boolean;
  isLoadingCategories: boolean;
  error: string | null;
  setCurrentSource: (sourceKey: string) => void;
  refreshSources: () => Promise<void>;
  getFilteredCategories: (
    contentType: 'movie' | 'tv' | 'anime' | 'show',
  ) => SourceCategory[];
}

export interface UseSourceFilterOptions {
  syncWithGlobal?: boolean;
}

const CONTENT_TYPE_KEYWORDS: Record<string, string[]> = {
  movie: ['电影', '影片', '大片', '院线', '4k', '蓝光', '片'],
  tv: [
    '电视剧',
    '剧集',
    '连续剧',
    '国产剧',
    '美剧',
    '韩剧',
    '日剧',
    '港剧',
    '剧',
  ],
  anime: ['动漫', '动画', '番剧', '动画片', '卡通', '漫画'],
  show: ['综艺', '真人秀', '脱口秀', '晚会', '纪录片'],
};

function isAdultSource(source: ApiSite): boolean {
  const flag = (source as { is_adult?: unknown }).is_adult;

  if (typeof flag === 'boolean') return flag;
  if (typeof flag === 'number') return flag === 1;
  if (typeof flag === 'string') {
    const normalized = flag.trim().toLowerCase();
    return (
      normalized === '1' ||
      normalized === 'true' ||
      normalized === 'yes' ||
      normalized === 'on'
    );
  }

  return false;
}

function toCategoryScalar(value: unknown): string | number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function toCategoryArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    try {
      return toCategoryArray(JSON.parse(value));
    } catch {
      return [];
    }
  }

  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>);
  }

  return [];
}

function toSourceCategory(value: unknown): SourceCategory | null {
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const typeId =
    toCategoryScalar(record.type_id) ??
    toCategoryScalar(record.typeId) ??
    toCategoryScalar(record.id) ??
    toCategoryScalar(record.tid);
  const typeName =
    toCategoryScalar(record.type_name) ??
    toCategoryScalar(record.typeName) ??
    toCategoryScalar(record.name) ??
    toCategoryScalar(record.type);

  if (typeId == null || typeName == null) {
    return null;
  }

  const typePid =
    toCategoryScalar(record.type_pid) ??
    toCategoryScalar(record.typePid) ??
    toCategoryScalar(record.pid);

  const normalized: SourceCategory = {
    type_id: typeId,
    type_name: String(typeName),
  };

  if (typePid != null) {
    normalized.type_pid = typePid;
  }

  return normalized;
}

function extractSourceCategories(payload: unknown): SourceCategory[] {
  const candidates: unknown[] = [];

  if (Array.isArray(payload)) {
    candidates.push(payload);
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    candidates.push(
      record.class,
      record.classes,
      record.class_list,
      record.classlist,
      record.list,
      record.typelist,
    );

    const data = record.data;
    if (data && typeof data === 'object') {
      const dataRecord = data as Record<string, unknown>;
      candidates.push(
        dataRecord.class,
        dataRecord.classes,
        dataRecord.class_list,
        dataRecord.classlist,
        dataRecord.list,
        dataRecord.typelist,
      );
    } else {
      candidates.push(data);
    }
  }

  const dedup = new Map<string, SourceCategory>();

  candidates.forEach((candidate) => {
    toCategoryArray(candidate).forEach((item) => {
      const parsed = toSourceCategory(item);
      if (!parsed) return;

      const dedupKey = `${String(parsed.type_id)}::${parsed.type_name}`;
      if (!dedup.has(dedupKey)) {
        dedup.set(dedupKey, parsed);
      }
    });
  });

  return Array.from(dedup.values());
}

export function useSourceFilter(
  options: UseSourceFilterOptions = {},
): UseSourceFilterReturn {
  const { syncWithGlobal = true } = options;

  const [sources, setSources] = useState<ApiSite[]>([]);
  const [currentSource, setCurrentSourceState] = useState<string>(() =>
    syncWithGlobal ? getStoredSourceBrowserValue() : 'auto',
  );
  const [sourceCategories, setSourceCategories] = useState<SourceCategory[]>(
    [],
  );
  const [isLoadingSources, setIsLoadingSources] = useState(false);
  const [isLoadingCategories, setIsLoadingCategories] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSources = useCallback(async () => {
    setIsLoadingSources(true);
    setError(null);

    try {
      const [sourceResponse, serverConfigResponse] = await Promise.all([
        fetch('/api/search/resources', { credentials: 'include' }),
        fetch('/api/server-config', { credentials: 'include' }).catch(
          () => null,
        ),
      ]);

      if (!sourceResponse.ok) {
        throw new Error('获取数据源列表失败');
      }

      const data = (await sourceResponse.json()) as ApiSite[];
      const sourceList = Array.isArray(data) ? data : [];

      // 双重保险：读取全局过滤状态后，进入 UI 前再做一次成人源剔除
      let shouldFilterAdult =
        sourceResponse.headers.get('X-Adult-Filter')?.toLowerCase() ===
        'enabled';

      if (serverConfigResponse?.ok) {
        const serverConfig =
          (await serverConfigResponse.json()) as ServerConfigResponse;
        if (typeof serverConfig.AdultFilterEnabled === 'boolean') {
          shouldFilterAdult = serverConfig.AdultFilterEnabled;
        }
      }

      const normalizedSources = shouldFilterAdult
        ? sourceList.filter((source) => !isAdultSource(source))
        : sourceList;

      setSources(normalizedSources);
    } catch (err) {
      console.error('获取数据源失败:', err);
      setError(err instanceof Error ? err.message : '未知错误');
    } finally {
      setIsLoadingSources(false);
    }
  }, []);

  const fetchSourceCategories = useCallback(
    async (sourceKey: string) => {
      if (sourceKey === 'auto') {
        setSourceCategories([]);
        return;
      }

      setIsLoadingCategories(true);
      setError(null);

      try {
        const source = sources.find((item) => item.key === sourceKey);
        if (!source) {
          throw new Error('未找到指定的数据源');
        }

        const originalApiUrl = source.api.endsWith('/')
          ? `${source.api}?ac=class`
          : `${source.api}/?ac=class`;
        const apiUrl = `/api/proxy/cms?url=${encodeURIComponent(originalApiUrl)}`;

        const response = await fetch(apiUrl, {
          headers: {
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('获取分类列表失败');
        }

        const data = (await response.json()) as SourceCategoryResponse;
        const categories = extractSourceCategories(data);
        setSourceCategories(categories);
      } catch (err) {
        console.error('获取源分类失败:', err);
        setError(err instanceof Error ? err.message : '获取分类失败');
        setSourceCategories([]);
      } finally {
        setIsLoadingCategories(false);
      }
    },
    [sources],
  );

  const setCurrentSource = useCallback(
    (sourceKey: string) => {
      const nextSource = sourceKey || 'auto';
      setCurrentSourceState(nextSource);

      if (syncWithGlobal) {
        setStoredSourceBrowserValue(nextSource);
      }
    },
    [syncWithGlobal],
  );

  const getFilteredCategories = useCallback(
    (contentType: 'movie' | 'tv' | 'anime' | 'show'): SourceCategory[] => {
      if (sourceCategories.length === 0) return [];

      const keywords = CONTENT_TYPE_KEYWORDS[contentType] || [];

      let filtered = sourceCategories.filter((category) => {
        const name = category.type_name.toLowerCase();
        return keywords.some((keyword) => name.includes(keyword.toLowerCase()));
      });

      if (filtered.length === 0) {
        filtered = sourceCategories.filter((category) => {
          const name = category.type_name;
          return (
            name.includes('片') || name.includes('剧') || name.includes('漫')
          );
        });
      }

      if (filtered.length === 0) {
        return sourceCategories.slice(0, 15);
      }

      return filtered;
    },
    [sourceCategories],
  );

  const refreshSources = useCallback(async () => {
    await fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    void fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    if (!syncWithGlobal) return;

    const handleSourceChange = (event: Event) => {
      const detail = (event as CustomEvent<{ sourceKey?: string }>).detail;
      const nextSource = detail?.sourceKey || getStoredSourceBrowserValue();
      setCurrentSourceState((prev) =>
        prev === nextSource ? prev : nextSource,
      );
    };

    const handleStorageChange = (
      event: Event & { key?: string | null; newValue?: string | null },
    ) => {
      if (event.key !== SOURCE_BROWSER_STORAGE_KEY) return;
      const nextSource = event.newValue || 'auto';
      setCurrentSourceState((prev) =>
        prev === nextSource ? prev : nextSource,
      );
    };

    window.addEventListener(
      SOURCE_BROWSER_CHANGE_EVENT,
      handleSourceChange as EventListener,
    );
    window.addEventListener('storage', handleStorageChange as EventListener);

    return () => {
      window.removeEventListener(
        SOURCE_BROWSER_CHANGE_EVENT,
        handleSourceChange as EventListener,
      );
      window.removeEventListener(
        'storage',
        handleStorageChange as EventListener,
      );
    };
  }, [syncWithGlobal]);

  useEffect(() => {
    if (currentSource === 'auto') return;
    const exists = sources.some((source) => source.key === currentSource);
    if (exists) return;

    setCurrentSourceState('auto');
    if (syncWithGlobal) {
      setStoredSourceBrowserValue('auto');
    }
  }, [currentSource, sources, syncWithGlobal]);

  useEffect(() => {
    if (currentSource === 'auto') {
      setSourceCategories([]);
      return;
    }

    if (sources.length === 0) return;
    void fetchSourceCategories(currentSource);
  }, [currentSource, sources.length, fetchSourceCategories]);

  return {
    sources,
    currentSource,
    sourceCategories,
    isLoadingSources,
    isLoadingCategories,
    error,
    setCurrentSource,
    refreshSources,
    getFilteredCategories,
  };
}

export default useSourceFilter;
