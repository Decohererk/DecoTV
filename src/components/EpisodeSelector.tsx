import { ArrowDownNarrowWide, Gauge, RefreshCw, Wifi } from 'lucide-react';
import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { SearchResult } from '@/lib/types';
import {
  getVideoResolutionFromM3u8,
  type VideoSourceTestResult,
} from '@/lib/utils';

import ExternalImage from '@/components/ExternalImage';

// 定义视频信息类型
type VideoInfo = VideoSourceTestResult;
type SourceSortMode = 'default' | 'latency';
const RESPONSE_TIE_BREAKER_MS = 300;

interface SourceSortItem {
  source: SearchResult;
  sourceKey: string;
  originalIndex: number;
  isCurrentSource: boolean;
  isTesting: boolean;
  videoInfo?: VideoInfo;
}

function hasMeasuredLatency(videoInfo?: VideoInfo) {
  return Boolean(
    videoInfo &&
    !videoInfo.hasError &&
    Number.isFinite(videoInfo.pingTime) &&
    videoInfo.pingTime > 0,
  );
}

function getLatencySortBucket(
  videoInfo: VideoInfo | undefined,
  isTesting: boolean,
) {
  if (hasMeasuredLatency(videoInfo)) return 0;
  if (videoInfo && !videoInfo.hasError) return 1;
  if (isTesting) return 2;
  if (!videoInfo) return 3;
  return 4;
}

function compareDefaultSourceOrder(a: SourceSortItem, b: SourceSortItem) {
  if (a.isCurrentSource && !b.isCurrentSource) return -1;
  if (!a.isCurrentSource && b.isCurrentSource) return 1;
  return a.originalIndex - b.originalIndex;
}

function compareLatencyMetrics(a: SourceSortItem, b: SourceSortItem) {
  const scoreDiff = (b.videoInfo?.score || 0) - (a.videoInfo?.score || 0);
  if (scoreDiff !== 0) return scoreDiff;

  const pingDiff = (a.videoInfo?.pingTime || 0) - (b.videoInfo?.pingTime || 0);
  if (Math.abs(pingDiff) > RESPONSE_TIE_BREAKER_MS) return pingDiff;

  const speedDiff =
    (b.videoInfo?.speedKBps || 0) - (a.videoInfo?.speedKBps || 0);
  if (speedDiff !== 0) return speedDiff;

  if (pingDiff !== 0) return pingDiff;

  if (a.isCurrentSource && !b.isCurrentSource) return -1;
  if (!a.isCurrentSource && b.isCurrentSource) return 1;

  return a.originalIndex - b.originalIndex;
}

function compareLatencySourceOrder(a: SourceSortItem, b: SourceSortItem) {
  const bucketDiff =
    getLatencySortBucket(a.videoInfo, a.isTesting) -
    getLatencySortBucket(b.videoInfo, b.isTesting);
  if (bucketDiff !== 0) return bucketDiff;

  if (hasMeasuredLatency(a.videoInfo) && hasMeasuredLatency(b.videoInfo)) {
    return compareLatencyMetrics(a, b);
  }

  if (
    a.videoInfo &&
    b.videoInfo &&
    !a.videoInfo.hasError &&
    !b.videoInfo.hasError
  ) {
    const speedDiff =
      (b.videoInfo.speedKBps || 0) - (a.videoInfo.speedKBps || 0);
    if (speedDiff !== 0) return speedDiff;
  }

  if (a.isCurrentSource && !b.isCurrentSource) return -1;
  if (!a.isCurrentSource && b.isCurrentSource) return 1;

  return a.originalIndex - b.originalIndex;
}

function formatResponseTime(ms: number) {
  if (!Number.isFinite(ms) || ms <= 0) return '未测得';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 1000)}s`;
}

function getLatencyTextClassName(pingTime: number) {
  if (pingTime <= 800) return 'text-green-600 dark:text-green-400';
  if (pingTime <= 2500) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function getSpeedTextClassName(speedKBps?: number) {
  if (!speedKBps || !Number.isFinite(speedKBps) || speedKBps <= 0) {
    return 'text-gray-500 dark:text-gray-400';
  }
  if (speedKBps >= 2048) return 'text-green-600 dark:text-green-400';
  if (speedKBps >= 512) return 'text-sky-600 dark:text-sky-300';
  return 'text-orange-600 dark:text-orange-400';
}

function getStrategyLabel(strategy?: VideoInfo['recommendedStrategy']) {
  switch (strategy) {
    case 'direct':
      return '直连';
    case 'manifest-proxy':
      return '列表代理';
    case 'asset-proxy':
      return '分片代理';
    default:
      return '待判断';
  }
}

function getHealthLine(videoInfo: VideoInfo) {
  const health = videoInfo.health;
  if (!health) return null;
  const apiText =
    videoInfo.pingTime > 0 ? formatResponseTime(videoInfo.pingTime) : '未测';
  const manifestText = health.manifest?.ok ? 'm3u8 成功' : 'm3u8 失败';
  const firstSegmentText = health.firstSegment?.ok
    ? `首片 ${formatResponseTime(health.firstSegment.timeToFirstByteMs || 0)}`
    : '首片失败';
  const corsText = health.cors?.checkedInBrowser
    ? health.cors.manifestReadable
      ? 'CORS 可直连'
      : 'CORS 需代理'
    : 'CORS 待浏览器确认';
  return `API ${apiText} · ${manifestText} · ${firstSegmentText} · ${corsText} · ${getStrategyLabel(
    health.recommendedStrategy,
  )}`;
}

interface EpisodeSelectorProps {
  /** 总集数 */
  totalEpisodes: number;
  /** 剧集标题 */
  episodes_titles: string[];
  /** 每页显示多少集，默认 50 */
  episodesPerPage?: number;
  /** 当前选中的集数（1 开始） */
  value?: number;
  /** 用户点击选集后的回调 */
  onChange?: (episodeNumber: number) => void;
  /** 换源相关 */
  onSourceChange?: (source: string, id: string, title: string) => void;
  currentSource?: string;
  currentId?: string;
  videoTitle?: string;
  videoYear?: string;
  availableSources?: SearchResult[];
  sourceSearchLoading?: boolean;
  sourceSearchError?: string | null;
  /** 预计算的测速结果，避免重复测速 */
  precomputedVideoInfo?: Map<string, VideoInfo>;
}

/**
 * 选集组件，支持分页、自动滚动聚焦当前分页标签，以及换源功能。
 */
const EpisodeSelector: React.FC<EpisodeSelectorProps> = ({
  totalEpisodes,
  episodes_titles,
  episodesPerPage = 50,
  value = 1,
  onChange,
  onSourceChange,
  currentSource,
  currentId,
  videoTitle,
  availableSources = [],
  sourceSearchLoading = false,
  sourceSearchError = null,
  precomputedVideoInfo,
}) => {
  const router = useRouter();
  const pageCount = Math.ceil(totalEpisodes / episodesPerPage);

  // 存储每个源的视频信息
  const [videoInfoMap, setVideoInfoMap] = useState<Map<string, VideoInfo>>(
    new Map(),
  );
  const [attemptedSources, setAttemptedSources] = useState<Set<string>>(
    new Set(),
  );
  const [testingSourceKeys, setTestingSourceKeys] = useState<Set<string>>(
    new Set(),
  );
  const [manualTesting, setManualTesting] = useState(false);
  const [manualProgress, setManualProgress] = useState({ done: 0, total: 0 });
  const [sourceSortMode, setSourceSortMode] =
    useState<SourceSortMode>('default');
  const [hasManualTested, setHasManualTested] = useState(false);

  // 使用 ref 来避免闭包问题
  const attemptedSourcesRef = useRef<Set<string>>(new Set());
  const videoInfoMapRef = useRef<Map<string, VideoInfo>>(new Map());

  // 同步状态到 ref
  useEffect(() => {
    attemptedSourcesRef.current = attemptedSources;
  }, [attemptedSources]);

  useEffect(() => {
    videoInfoMapRef.current = videoInfoMap;
  }, [videoInfoMap]);

  // 主要的 tab 状态：'episodes' 或 'sources'
  // 当只有一集时默认展示 "换源"，并隐藏 "选集" 标签
  const [activeTab, setActiveTab] = useState<'episodes' | 'sources'>(
    totalEpisodes > 1 ? 'episodes' : 'sources',
  );

  // 当前分页索引（0 开始）
  const initialPage = Math.floor((value - 1) / episodesPerPage);
  const [currentPage, setCurrentPage] = useState<number>(initialPage);

  // 是否倒序显示
  const [descending, setDescending] = useState<boolean>(false);

  // 根据 descending 状态计算实际显示的分页索引
  const displayPage = useMemo(() => {
    if (descending) {
      return pageCount - 1 - currentPage;
    }
    return currentPage;
  }, [currentPage, descending, pageCount]);

  const getSourceKey = useCallback((source: SearchResult) => {
    return `${source.source}-${source.id}`;
  }, []);

  const getTestEpisodeUrl = useCallback(
    (source: SearchResult) => {
      if (!source.episodes || source.episodes.length === 0) return '';
      return source.episodes[value - 1] || source.episodes[0];
    },
    [value],
  );

  const sourceListSignature = useMemo(
    () => availableSources.map((source) => getSourceKey(source)).join('|'),
    [availableSources, getSourceKey],
  );

  const testScopeRef = useRef({
    episode: value,
    sourceListSignature,
  });
  const testScopeVersionRef = useRef(0);

  useEffect(() => {
    const previousScope = testScopeRef.current;
    if (
      previousScope.episode === value &&
      previousScope.sourceListSignature === sourceListSignature
    ) {
      return;
    }

    testScopeRef.current = { episode: value, sourceListSignature };
    testScopeVersionRef.current += 1;
    const emptyVideoInfoMap = new Map<string, VideoInfo>();
    const emptyAttemptedSources = new Set<string>();
    const emptyTestingSourceKeys = new Set<string>();

    setVideoInfoMap(emptyVideoInfoMap);
    setAttemptedSources(emptyAttemptedSources);
    setTestingSourceKeys(emptyTestingSourceKeys);
    setManualProgress({ done: 0, total: 0 });
    setSourceSortMode('default');
    setHasManualTested(false);
    videoInfoMapRef.current = emptyVideoInfoMap;
    attemptedSourcesRef.current = emptyAttemptedSources;
  }, [sourceListSignature, value]);

  // 获取视频信息的函数 - 移除 attemptedSources 依赖避免不必要的重新创建
  const getVideoInfo = useCallback(
    async (source: SearchResult, force = false) => {
      const sourceKey = getSourceKey(source);
      const requestScopeVersion = testScopeVersionRef.current;
      const isCurrentTestScope = () =>
        testScopeVersionRef.current === requestScopeVersion;

      // 使用 ref 获取最新的状态，避免闭包问题
      if (!force && attemptedSourcesRef.current.has(sourceKey)) {
        return;
      }

      const episodeUrl = getTestEpisodeUrl(source);

      // 标记为已尝试
      setAttemptedSources((prev) => new Set(prev).add(sourceKey));
      attemptedSourcesRef.current.add(sourceKey);
      setTestingSourceKeys((prev) => new Set(prev).add(sourceKey));

      if (!episodeUrl) {
        if (isCurrentTestScope()) {
          setVideoInfoMap((prev) =>
            new Map(prev).set(sourceKey, {
              quality: '未知',
              loadSpeed: '未知',
              pingTime: 0,
              hasError: true,
              status: 'failed',
              message: '没有可用播放地址',
            }),
          );
          setTestingSourceKeys((prev) => {
            const next = new Set(prev);
            next.delete(sourceKey);
            return next;
          });
        }
        return;
      }

      try {
        const info = await getVideoResolutionFromM3u8(episodeUrl, {
          timeoutMs: force ? 10000 : 8000,
          source: source.source,
          sourceName: source.source_name,
          title: source.title,
          episodeIndex: value - 1,
        });
        if (isCurrentTestScope()) {
          setVideoInfoMap((prev) => new Map(prev).set(sourceKey, info));
        }
      } catch (error) {
        // 失败时保存错误状态
        if (isCurrentTestScope()) {
          setVideoInfoMap((prev) =>
            new Map(prev).set(sourceKey, {
              quality: '未知',
              loadSpeed: '未知',
              pingTime: 0,
              hasError: true,
              status: 'failed',
              message: error instanceof Error ? error.message : '检测失败',
            }),
          );
        }
      } finally {
        if (isCurrentTestScope()) {
          setTestingSourceKeys((prev) => {
            const next = new Set(prev);
            next.delete(sourceKey);
            return next;
          });
        }
      }
    },
    [getSourceKey, getTestEpisodeUrl, value],
  );

  const handleManualSpeedTest = useCallback(async () => {
    if (availableSources.length === 0 || manualTesting) return;

    const requestScopeVersion = testScopeVersionRef.current;
    setManualTesting(true);
    setManualProgress({ done: 0, total: availableSources.length });

    const batchSize = 2;
    try {
      for (let start = 0; start < availableSources.length; start += batchSize) {
        const batch = availableSources.slice(start, start + batchSize);
        await Promise.all(
          batch.map(async (source) => {
            await getVideoInfo(source, true);
            if (testScopeVersionRef.current === requestScopeVersion) {
              setManualProgress((prev) => ({
                done: Math.min(prev.done + 1, prev.total),
                total: prev.total,
              }));
            }
          }),
        );
      }
    } finally {
      if (testScopeVersionRef.current === requestScopeVersion) {
        setSourceSortMode('latency');
        setHasManualTested(true);
      }
      setManualTesting(false);
    }
  }, [availableSources, getVideoInfo, manualTesting]);

  // 当有预计算结果时，先合并到videoInfoMap中
  useEffect(() => {
    if (precomputedVideoInfo && precomputedVideoInfo.size > 0) {
      // 原子性地更新两个状态，避免时序问题
      setVideoInfoMap((prev) => {
        const newMap = new Map(prev);
        precomputedVideoInfo.forEach((value, key) => {
          newMap.set(key, value);
        });
        return newMap;
      });

      setAttemptedSources((prev) => {
        const newSet = new Set(prev);
        precomputedVideoInfo.forEach((_info, key) => {
          newSet.add(key);
        });
        return newSet;
      });

      // 同步更新 ref，确保 getVideoInfo 能立即看到更新
      precomputedVideoInfo.forEach((_info, key) => {
        attemptedSourcesRef.current.add(key);
      });
    }
  }, [precomputedVideoInfo]);

  // 读取本地"优选和测速"开关，默认开启
  const [optimizationEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('enableOptimization');
      if (saved !== null) {
        try {
          return JSON.parse(saved);
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  });

  // 当切换到换源tab并且有源数据时，异步获取视频信息 - 移除 attemptedSources 依赖避免循环触发
  useEffect(() => {
    const fetchVideoInfosInBatches = async () => {
      if (
        !optimizationEnabled || // 若关闭测速则直接退出
        activeTab !== 'sources' ||
        availableSources.length === 0
      )
        return;

      // 筛选出尚未测速的播放源
      const pendingSources = availableSources.filter((source) => {
        const sourceKey = `${source.source}-${source.id}`;
        return !attemptedSourcesRef.current.has(sourceKey);
      });

      if (pendingSources.length === 0) return;

      const batchSize = Math.min(
        2,
        Math.max(1, Math.ceil(pendingSources.length / 2)),
      );

      for (let start = 0; start < pendingSources.length; start += batchSize) {
        const batch = pendingSources.slice(start, start + batchSize);
        await Promise.all(batch.map((source) => getVideoInfo(source)));
      }
    };

    fetchVideoInfosInBatches();
    // 依赖项保持与之前一致
  }, [activeTab, availableSources, getVideoInfo, optimizationEnabled]);

  // 升序分页标签
  const categoriesAsc = useMemo(() => {
    return Array.from({ length: pageCount }, (_, i) => {
      const start = i * episodesPerPage + 1;
      const end = Math.min(start + episodesPerPage - 1, totalEpisodes);
      return { start, end };
    });
  }, [pageCount, episodesPerPage, totalEpisodes]);

  // 根据 descending 状态决定分页标签的排序和内容
  const categories = useMemo(() => {
    if (descending) {
      // 倒序时，label 也倒序显示
      return [...categoriesAsc]
        .reverse()
        .map(({ start, end }) => `${end}-${start}`);
    }
    return categoriesAsc.map(({ start, end }) => `${start}-${end}`);
  }, [categoriesAsc, descending]);

  const categoryContainerRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // 添加鼠标悬停状态管理
  const [isCategoryHovered, setIsCategoryHovered] = useState(false);

  // 阻止页面竖向滚动
  const preventPageScroll = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered) {
        e.preventDefault();
      }
    },
    [isCategoryHovered],
  );

  // 处理滚轮事件，实现横向滚动
  const handleWheel = useCallback(
    (e: WheelEvent) => {
      if (isCategoryHovered && categoryContainerRef.current) {
        e.preventDefault(); // 阻止默认的竖向滚动

        const container = categoryContainerRef.current;
        const scrollAmount = e.deltaY * 2; // 调整滚动速度

        // 根据滚轮方向进行横向滚动
        container.scrollBy({
          left: scrollAmount,
          behavior: 'smooth',
        });
      }
    },
    [isCategoryHovered],
  );

  // 添加全局wheel事件监听器
  useEffect(() => {
    if (isCategoryHovered) {
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
  }, [isCategoryHovered, preventPageScroll, handleWheel]);

  // 当分页切换时，将激活的分页标签滚动到视口中间
  useEffect(() => {
    const btn = buttonRefs.current[displayPage];
    const container = categoryContainerRef.current;
    if (btn && container) {
      // 手动计算滚动位置，只滚动分页标签容器
      const containerRect = container.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const scrollLeft = container.scrollLeft;

      // 计算按钮相对于容器的位置
      const btnLeft = btnRect.left - containerRect.left + scrollLeft;
      const btnWidth = btnRect.width;
      const containerWidth = containerRect.width;

      // 计算目标滚动位置，使按钮居中
      const targetScrollLeft = btnLeft - (containerWidth - btnWidth) / 2;

      // 平滑滚动到目标位置
      container.scrollTo({
        left: targetScrollLeft,
        behavior: 'smooth',
      });
    }
  }, [displayPage, pageCount]);

  // 处理换源tab点击，只在点击时才搜索
  const handleSourceTabClick = () => {
    setActiveTab('sources');
  };

  const handleCategoryClick = useCallback(
    (index: number) => {
      if (descending) {
        // 在倒序时，需要将显示索引转换为实际索引
        setCurrentPage(pageCount - 1 - index);
      } else {
        setCurrentPage(index);
      }
    },
    [descending, pageCount],
  );

  const handleEpisodeClick = useCallback(
    (episodeNumber: number) => {
      onChange?.(episodeNumber);
    },
    [onChange],
  );

  const handleSourceClick = useCallback(
    (source: SearchResult) => {
      onSourceChange?.(source.source, source.id, source.title);
    },
    [onSourceChange],
  );

  const currentStart = currentPage * episodesPerPage + 1;
  const currentEnd = Math.min(
    currentStart + episodesPerPage - 1,
    totalEpisodes,
  );

  const sourceItems = useMemo<SourceSortItem[]>(
    () =>
      availableSources.map((source, originalIndex) => {
        const sourceKey = getSourceKey(source);
        return {
          source,
          sourceKey,
          originalIndex,
          isCurrentSource:
            source.source?.toString() === currentSource?.toString() &&
            source.id?.toString() === currentId?.toString(),
          isTesting: testingSourceKeys.has(sourceKey),
          videoInfo: videoInfoMap.get(sourceKey),
        };
      }),
    [
      availableSources,
      currentId,
      currentSource,
      getSourceKey,
      testingSourceKeys,
      videoInfoMap,
    ],
  );

  const rankedLatencyItems = useMemo(
    () =>
      sourceItems
        .filter((item) => hasMeasuredLatency(item.videoInfo))
        .sort(compareLatencyMetrics),
    [sourceItems],
  );

  const latencyRankBySourceKey = useMemo(() => {
    const ranks = new Map<string, number>();
    rankedLatencyItems.forEach((item, index) => {
      ranks.set(item.sourceKey, index + 1);
    });
    return ranks;
  }, [rankedLatencyItems]);

  const fastestLatencyItem = rankedLatencyItems[0] || null;

  const testedSourceCount = useMemo(
    () => sourceItems.filter((item) => Boolean(item.videoInfo)).length,
    [sourceItems],
  );

  const failedSourceCount = useMemo(
    () => sourceItems.filter((item) => item.videoInfo?.hasError).length,
    [sourceItems],
  );

  const displaySourceItems = useMemo(() => {
    const items = [...sourceItems];
    items.sort(
      sourceSortMode === 'latency'
        ? compareLatencySourceOrder
        : compareDefaultSourceOrder,
    );
    return items;
  }, [sourceItems, sourceSortMode]);

  const sourceSortStatusText = (() => {
    if (manualTesting) {
      return `测速中 ${manualProgress.done}/${manualProgress.total}`;
    }

    if (sourceSortMode === 'latency') {
      if (fastestLatencyItem?.videoInfo) {
        const speedText =
          fastestLatencyItem.videoInfo.loadSpeed !== '未知'
            ? ` · 速度 ${fastestLatencyItem.videoInfo.loadSpeed}`
            : '';
        return `最快响应 ${formatResponseTime(
          fastestLatencyItem.videoInfo.pingTime,
        )}${speedText} · ${fastestLatencyItem.source.source_name}`;
      }
      return failedSourceCount > 0 ? '测速完成，暂无可用响应' : '等待响应数据';
    }

    if (hasManualTested) {
      return `已测速 ${testedSourceCount}/${availableSources.length}`;
    }

    return '手动测速后按响应排序';
  })();

  const getSourceStatusBadge = (
    videoInfo: VideoInfo | undefined,
    isTesting: boolean,
  ) => {
    if (isTesting) {
      return {
        label: '检测中',
        className: 'text-cyan-600 dark:text-cyan-300',
      };
    }

    if (!videoInfo) return null;

    if (videoInfo.grade && !videoInfo.hasError) {
      return {
        label: `评分 ${videoInfo.grade}`,
        className:
          videoInfo.grade === 'A'
            ? 'text-green-600 dark:text-green-400'
            : videoInfo.grade === 'B'
              ? 'text-sky-600 dark:text-sky-300'
              : videoInfo.grade === 'C'
                ? 'text-yellow-600 dark:text-yellow-400'
                : 'text-red-600 dark:text-red-400',
      };
    }

    if (videoInfo.hasError) {
      return {
        label: '检测失败',
        className: 'text-red-600 dark:text-red-400',
      };
    }

    if (videoInfo.quality && videoInfo.quality !== '未知') {
      const isUltraHigh = ['4K', '2K'].includes(videoInfo.quality);
      const isHigh = ['1080p', '720p'].includes(videoInfo.quality);
      return {
        label: videoInfo.quality,
        className: isUltraHigh
          ? 'text-purple-600 dark:text-purple-400'
          : isHigh
            ? 'text-green-600 dark:text-green-400'
            : 'text-yellow-600 dark:text-yellow-400',
      };
    }

    if (videoInfo.status === 'partial' || videoInfo.pingTime > 0) {
      return {
        label: '已连通',
        className: 'text-sky-600 dark:text-sky-300',
      };
    }

    return null;
  };

  return (
    <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
      {/* 主要的 Tab 切换 - 无缝融入设计 */}
      <div className='flex mb-1 -mx-6 shrink-0'>
        {totalEpisodes > 1 && (
          <div
            onClick={() => setActiveTab('episodes')}
            className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
              ${
                activeTab === 'episodes'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
              }
            `.trim()}
          >
            选集
          </div>
        )}
        <div
          onClick={handleSourceTabClick}
          className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
            ${
              activeTab === 'sources'
                ? 'text-green-600 dark:text-green-400'
                : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
            }
          `.trim()}
        >
          换源
        </div>
      </div>

      {/* 选集 Tab 内容 */}
      {activeTab === 'episodes' && (
        <>
          {/* 分类标签 */}
          <div className='flex items-center gap-4 mb-4 border-b border-gray-300 dark:border-gray-700 -mx-6 px-6 shrink-0'>
            <div
              className='flex-1 overflow-x-auto'
              ref={categoryContainerRef}
              onMouseEnter={() => setIsCategoryHovered(true)}
              onMouseLeave={() => setIsCategoryHovered(false)}
            >
              <div className='flex gap-2 min-w-max'>
                {categories.map((label, idx) => {
                  const isActive = idx === displayPage;
                  return (
                    <button
                      key={label}
                      ref={(el) => {
                        buttonRefs.current[idx] = el;
                      }}
                      onClick={() => handleCategoryClick(idx)}
                      className={`w-20 relative py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 text-center 
                        ${
                          isActive
                            ? 'text-green-500 dark:text-green-400'
                            : 'text-gray-700 hover:text-green-600 dark:text-gray-300 dark:hover:text-green-400'
                        }
                      `.trim()}
                    >
                      {label}
                      {isActive && (
                        <div className='absolute bottom-0 left-0 right-0 h-0.5 bg-green-500 dark:bg-green-400' />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
            {/* 向上/向下按钮 */}
            <button
              className='shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-gray-700 hover:text-green-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-green-400 dark:hover:bg-white/20 transition-colors transform -translate-y-1'
              onClick={() => {
                // 切换集数排序（正序/倒序）
                setDescending((prev) => !prev);
              }}
            >
              <svg
                className='w-4 h-4'
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4'
                />
              </svg>
            </button>
          </div>

          {/* 集数网格 */}
          <div className='flex flex-wrap gap-3 overflow-y-auto flex-1 content-start pb-4'>
            {(() => {
              const len = currentEnd - currentStart + 1;
              const episodes = Array.from({ length: len }, (_, i) =>
                descending ? currentEnd - i : currentStart + i,
              );
              return episodes;
            })().map((episodeNumber) => {
              const isActive = episodeNumber === value;
              return (
                <button
                  key={episodeNumber}
                  onClick={() => handleEpisodeClick(episodeNumber - 1)}
                  className={`h-10 min-w-10 px-3 py-2 flex items-center justify-center text-sm font-medium rounded-md transition-all duration-200 whitespace-nowrap font-mono
                    ${
                      isActive
                        ? 'bg-green-500 text-white shadow-lg shadow-green-500/25 dark:bg-green-600'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300 hover:scale-105 dark:bg-white/10 dark:text-gray-300 dark:hover:bg-white/20'
                    }`.trim()}
                >
                  {(() => {
                    const title = episodes_titles?.[episodeNumber - 1];
                    if (!title) {
                      return episodeNumber;
                    }
                    // 如果匹配"第X集"、"第X话"、"X集"、"X话"格式，提取中间的数字
                    const match = title.match(/(?:第)?(\d+)(?:集|话)/);
                    if (match) {
                      return match[1];
                    }
                    return title;
                  })()}
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* 换源 Tab 内容 */}
      {activeTab === 'sources' && (
        <div className='flex flex-col h-full mt-4'>
          {sourceSearchLoading && (
            <div className='flex items-center justify-center py-8'>
              <div className='animate-spin rounded-full h-8 w-8 border-b-2 border-green-500'></div>
              <span className='ml-2 text-sm text-gray-600 dark:text-gray-300'>
                搜索中...
              </span>
            </div>
          )}

          {sourceSearchError && (
            <div className='flex items-center justify-center py-8'>
              <div className='text-center'>
                <div className='text-red-500 text-2xl mb-2'>⚠️</div>
                <p className='text-sm text-red-600 dark:text-red-400'>
                  {sourceSearchError}
                </p>
              </div>
            </div>
          )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length === 0 && (
              <div className='flex items-center justify-center py-8'>
                <div className='text-center'>
                  <div className='text-gray-400 text-2xl mb-2'>📺</div>
                  <p className='text-sm text-gray-600 dark:text-gray-300'>
                    暂无可用的换源
                  </p>
                </div>
              </div>
            )}

          {!sourceSearchLoading &&
            !sourceSearchError &&
            availableSources.length > 0 && (
              <>
                <div className='mb-3 rounded-lg border border-gray-300/70 bg-white/45 p-2 shadow-sm dark:border-white/10 dark:bg-white/5'>
                  <div className='flex items-center justify-between gap-2'>
                    <div className='flex min-w-0 items-center gap-2'>
                      <span className='inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'>
                        <Gauge className='h-4 w-4' />
                      </span>
                      <div className='min-w-0'>
                        <div className='text-xs font-medium text-gray-800 dark:text-gray-100'>
                          源检测
                        </div>
                        <div className='truncate text-[11px] text-gray-500 dark:text-gray-400'>
                          第 {value} 集 · {availableSources.length} 个源
                        </div>
                      </div>
                    </div>
                    <button
                      type='button'
                      onClick={handleManualSpeedTest}
                      disabled={manualTesting}
                      className='inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 text-xs font-medium text-emerald-700 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:text-emerald-200'
                      title='手动重新检测全部播放源'
                    >
                      <RefreshCw
                        className={`h-3.5 w-3.5 ${
                          manualTesting ? 'animate-spin' : ''
                        }`}
                      />
                      {manualTesting
                        ? `${manualProgress.done}/${manualProgress.total}`
                        : '手动测速'}
                    </button>
                  </div>
                  <div className='mt-2 flex items-center justify-between gap-2 border-t border-gray-300/70 pt-2 dark:border-white/10'>
                    <div className='inline-flex h-7 shrink-0 rounded-md bg-gray-200/70 p-0.5 dark:bg-black/20'>
                      <button
                        type='button'
                        onClick={() => setSourceSortMode('default')}
                        aria-pressed={sourceSortMode === 'default'}
                        className={`rounded px-2.5 text-[11px] font-medium transition ${
                          sourceSortMode === 'default'
                            ? 'bg-white text-gray-900 shadow-sm dark:bg-white/15 dark:text-white'
                            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        默认
                      </button>
                      <button
                        type='button'
                        onClick={() => setSourceSortMode('latency')}
                        aria-pressed={sourceSortMode === 'latency'}
                        className={`inline-flex items-center gap-1 rounded px-2.5 text-[11px] font-medium transition ${
                          sourceSortMode === 'latency'
                            ? 'bg-white text-emerald-700 shadow-sm dark:bg-white/15 dark:text-emerald-200'
                            : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        <ArrowDownNarrowWide className='h-3 w-3' />
                        响应
                      </button>
                    </div>
                    <div
                      className='min-w-0 flex-1 truncate text-right text-[11px] text-gray-500 dark:text-gray-400'
                      title={sourceSortStatusText}
                    >
                      {sourceSortStatusText}
                    </div>
                  </div>
                </div>
                <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                  {displaySourceItems.map((item, index) => {
                    const {
                      source,
                      sourceKey,
                      isCurrentSource,
                      isTesting,
                      videoInfo,
                    } = item;
                    const latencyRank = latencyRankBySourceKey.get(sourceKey);
                    const statusBadge = getSourceStatusBadge(
                      videoInfo,
                      isTesting,
                    );
                    return (
                      <div
                        key={sourceKey}
                        onClick={() =>
                          !isCurrentSource && handleSourceClick(source)
                        }
                        className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                      ${
                        isCurrentSource
                          ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                          : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                      }`.trim()}
                      >
                        {/* 封面 */}
                        <div className='relative shrink-0 w-12 h-20 bg-gray-300 dark:bg-gray-600 rounded overflow-hidden'>
                          {source.episodes && source.episodes.length > 0 && (
                            <ExternalImage
                              src={source.poster || ''}
                              alt={source.title}
                              fill
                              className='object-cover'
                              loading='lazy'
                              decoding='async'
                              sizes='48px'
                            />
                          )}
                        </div>

                        {/* 信息区域 */}
                        <div className='flex-1 min-w-0 flex flex-col justify-between h-20'>
                          {/* 标题和分辨率 - 顶部 */}
                          <div className='flex items-start justify-between gap-3 h-6'>
                            <div className='flex min-w-0 flex-1 items-center gap-1.5'>
                              {sourceSortMode === 'latency' && latencyRank && (
                                <span className='inline-flex h-4 min-w-5 shrink-0 items-center justify-center rounded bg-emerald-500/10 px-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-200'>
                                  #{latencyRank}
                                </span>
                              )}
                              <div className='min-w-0 flex-1 relative group/title'>
                                <h3 className='font-medium text-base truncate text-gray-900 dark:text-gray-100 leading-none'>
                                  {source.title}
                                </h3>
                                {/* 标题级别的 tooltip - 第一个元素不显示 */}
                                {index !== 0 && (
                                  <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible group-hover/title:opacity-100 group-hover/title:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap z-500 pointer-events-none'>
                                    {source.title}
                                    <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
                                  </div>
                                )}
                              </div>
                            </div>
                            {(() => {
                              if (statusBadge) {
                                return (
                                  <div
                                    className={`bg-gray-500/10 dark:bg-gray-400/20 ${statusBadge.className} px-1.5 py-0 rounded text-xs shrink-0 min-w-12.5 text-center`}
                                  >
                                    {statusBadge.label}
                                  </div>
                                );
                              }

                              return null;
                            })()}
                          </div>

                          {/* 源名称和集数信息 - 垂直居中 */}
                          <div className='flex items-center justify-between'>
                            <div className='flex min-w-0 items-center gap-1.5'>
                              <span className='max-w-[8.5rem] truncate text-xs px-2 py-1 border border-gray-500/60 rounded text-gray-700 dark:text-gray-300'>
                                {source.source_name}
                              </span>
                              {isCurrentSource && (
                                <span className='shrink-0 rounded bg-green-500/12 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-300'>
                                  当前
                                </span>
                              )}
                            </div>
                            {source.episodes.length > 1 && (
                              <span className='text-xs text-gray-500 dark:text-gray-400 font-medium'>
                                {source.episodes.length} 集
                              </span>
                            )}
                          </div>

                          {/* 网络信息 - 底部 */}
                          <div className='flex items-end h-6'>
                            {(() => {
                              if (isTesting) {
                                return (
                                  <div className='flex items-center gap-1.5 text-xs font-medium text-cyan-600 dark:text-cyan-300'>
                                    <Wifi className='h-3 w-3' />
                                    正在测速...
                                  </div>
                                );
                              }

                              if (videoInfo) {
                                if (!videoInfo.hasError) {
                                  const healthLine = getHealthLine(videoInfo);
                                  return (
                                    <div className='flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs'>
                                      {healthLine && (
                                        <div
                                          className='w-full truncate font-medium text-emerald-600 dark:text-emerald-300'
                                          title={healthLine}
                                        >
                                          {healthLine}
                                        </div>
                                      )}
                                      {videoInfo.pingTime > 0 && (
                                        <div
                                          className={`${getLatencyTextClassName(
                                            videoInfo.pingTime,
                                          )} font-medium text-xs`}
                                        >
                                          响应{' '}
                                          {formatResponseTime(
                                            videoInfo.pingTime,
                                          )}
                                        </div>
                                      )}
                                      {videoInfo.loadSpeed !== '未知' ? (
                                        <div
                                          className={`${getSpeedTextClassName(
                                            videoInfo.speedKBps,
                                          )} font-medium text-xs`}
                                        >
                                          速度 {videoInfo.loadSpeed}
                                        </div>
                                      ) : (
                                        <div className='text-gray-500 dark:text-gray-400 font-medium text-xs'>
                                          速度未测得
                                        </div>
                                      )}
                                    </div>
                                  );
                                } else {
                                  return (
                                    <div
                                      className='text-red-500/90 dark:text-red-400 font-medium text-xs truncate'
                                      title={videoInfo.message || '检测失败'}
                                    >
                                      {videoInfo.message || '检测失败'}
                                    </div>
                                  );
                                }
                              }
                              return (
                                <div className='text-gray-400 dark:text-gray-500 font-medium text-xs'>
                                  待测速
                                </div>
                              );
                            })()}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div className='shrink-0 mt-auto pt-2 border-t border-gray-400 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        if (videoTitle) {
                          router.push(
                            `/search?q=${encodeURIComponent(videoTitle)}`,
                          );
                        }
                      }}
                      className='w-full text-center text-xs text-gray-500 dark:text-gray-400 hover:text-green-500 dark:hover:text-green-400 transition-colors py-2'
                    >
                      影片匹配有误？点击去搜索
                    </button>
                  </div>
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
};

export default EpisodeSelector;
