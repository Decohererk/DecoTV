/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console, @next/next/no-img-element */

'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import {
  ArrowDownAZ,
  ArrowDownWideNarrow,
  Clock3,
  Heart,
  Info,
  LayoutGrid,
  Pin,
  PinOff,
  Radio,
  Tv,
  Zap,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import {
  deleteFavorite,
  generateStorageKey,
  isFavorited as checkIsFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { parseCustomTimeFormat } from '@/lib/time';

import CategoryBar from '@/components/CategoryBar';
import EpgScrollableRow from '@/components/EpgScrollableRow';
import PageLayout from '@/components/PageLayout';

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
    flv?: any;
  }
}

// 直播频道接口
interface LiveChannel {
  id: string;
  tvgId: string;
  name: string;
  logo: string;
  group: string;
  url: string;
}

// 直播源接口
interface LiveSource {
  key: string;
  name: string;
  url: string; // m3u 地址
  ua?: string;
  epg?: string; // 节目单
  from: 'config' | 'custom';
  channelNumber?: number;
  disabled?: boolean;
}

type LiveStreamType = 'm3u8' | 'mp4' | 'flv' | 'unknown';
type GroupSortMode = 'default' | 'count' | 'name';
type ChannelHealthStatus =
  | 'unknown'
  | 'checking'
  | 'healthy'
  | 'slow'
  | 'unreachable';

interface GroupSummary {
  name: string;
  count: number;
  order: number;
}

interface ChannelHealthInfo {
  type: LiveStreamType;
  status: ChannelHealthStatus;
  latencyMs?: number;
  checkedAt: number;
  message?: string;
}

const RECENT_GROUPS_STORAGE_KEY = 'liveRecentGroups';
const PINNED_GROUPS_STORAGE_KEY = 'livePinnedGroups';
const AUTO_FAILOVER_STORAGE_KEY = 'liveAutoFailover';
const MAX_RECENT_GROUPS = 8;
const HEALTH_CHECK_CACHE_MS = 3 * 60 * 1000;
const HEALTH_CHECK_BATCH_SIZE = 12;
const PLAYBACK_TIMEOUT_MS = 15 * 1000;

function parseStoredStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function normalizeStreamType(type: unknown): LiveStreamType {
  if (type === 'm3u8' || type === 'mp4' || type === 'flv') {
    return type;
  }
  return 'unknown';
}

function detectTypeFromUrl(rawUrl: string): LiveStreamType {
  const lowerUrl = rawUrl.toLowerCase();
  if (lowerUrl.includes('.m3u8')) return 'm3u8';
  if (lowerUrl.includes('.mp4')) return 'mp4';
  if (lowerUrl.includes('.flv')) return 'flv';
  return 'unknown';
}

function deriveHealthStatus(
  isReachable: boolean,
  latencyMs?: number,
): ChannelHealthStatus {
  if (!isReachable) return 'unreachable';
  if (typeof latencyMs === 'number' && latencyMs > 3500) return 'slow';
  return 'healthy';
}

function getTypeBadgeStyle(type: LiveStreamType) {
  if (type === 'm3u8') {
    return 'bg-blue-100 dark:bg-blue-900/35 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800';
  }
  if (type === 'flv') {
    return 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  }
  if (type === 'mp4') {
    return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800';
  }
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700';
}

function getHealthBadgeStyle(status: ChannelHealthStatus) {
  if (status === 'healthy') {
    return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  }
  if (status === 'slow') {
    return 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800';
  }
  if (status === 'unreachable') {
    return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800';
  }
  if (status === 'checking') {
    return 'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800';
  }
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700';
}

function LivePageClient() {
  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'loading' | 'fetching' | 'ready'
  >('loading');
  const [loadingMessage, setLoadingMessage] = useState('正在加载直播源...');
  const [error, setError] = useState<string | null>(null);

  const searchParams = useSearchParams();
  const router = useRouter();

  // 直播源相关
  const [liveSources, setLiveSources] = useState<LiveSource[]>([]);
  const [currentSource, setCurrentSource] = useState<LiveSource | null>(null);
  const currentSourceRef = useRef<LiveSource | null>(null);
  useEffect(() => {
    currentSourceRef.current = currentSource;
  }, [currentSource]);

  // 频道相关
  const [currentChannels, setCurrentChannels] = useState<LiveChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<LiveChannel | null>(
    null,
  );
  useEffect(() => {
    currentChannelRef.current = currentChannel;
  }, [currentChannel]);

  const [needLoadSource] = useState(searchParams.get('source'));
  const [needLoadChannel] = useState(searchParams.get('id'));

  // 播放器相关
  const [videoUrl, setVideoUrl] = useState('');
  const [isVideoLoading, setIsVideoLoading] = useState(false);
  const [unsupportedType, setUnsupportedType] = useState<string | null>(null);

  // 切换直播源状态
  const [isSwitchingSource, setIsSwitchingSource] = useState(false);

  // 分组相关
  const [groupedChannels, setGroupedChannels] = useState<{
    [key: string]: LiveChannel[];
  }>({});
  const [selectedGroup, setSelectedGroup] = useState<string>('');

  // Tab 切换
  const [activeTab, setActiveTab] = useState<'channels' | 'sources'>(
    'channels',
  );

  // 频道列表收起状态
  const [isChannelListCollapsed, setIsChannelListCollapsed] = useState(false);

  // 过滤后的频道列表
  const [filteredChannels, setFilteredChannels] = useState<LiveChannel[]>([]);

  // 节目单信息
  const [epgData, setEpgData] = useState<{
    tvgId: string;
    source: string;
    epgUrl: string;
    programs: Array<{
      start: string;
      end: string;
      title: string;
    }>;
  } | null>(null);

  // EPG 数据加载状态
  const [isEpgLoading, setIsEpgLoading] = useState(false);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);
  const favoritedRef = useRef(false);
  const currentChannelRef = useRef<LiveChannel | null>(null);

  // 搜索相关
  const [sourceSearchQuery, setSourceSearchQuery] = useState('');
  const [channelSearchQuery, setChannelSearchQuery] = useState('');
  const [isGroupSelectorOpen, setIsGroupSelectorOpen] = useState(false);
  const [groupSearchQuery, setGroupSearchQuery] = useState('');
  const [groupSortMode, setGroupSortMode] = useState<GroupSortMode>('default');
  const [recentGroups, setRecentGroups] = useState<string[]>([]);
  const [pinnedGroups, setPinnedGroups] = useState<string[]>([]);
  const [channelHealthMap, setChannelHealthMap] = useState<
    Record<string, ChannelHealthInfo>
  >({});
  const [autoFailoverEnabled, setAutoFailoverEnabled] = useState(true);
  const [autoFailoverMessage, setAutoFailoverMessage] = useState<string | null>(
    null,
  );

  // 直连模式状态
  const [isDirectConnect, setIsDirectConnect] = useState(false);
  const [showDirectConnectTip, setShowDirectConnectTip] = useState(false);

  const normalizedChannelSearchQuery = channelSearchQuery.trim().toLowerCase();
  const normalizedSourceSearchQuery = sourceSearchQuery.trim().toLowerCase();
  const normalizedGroupSearchQuery = groupSearchQuery.trim().toLowerCase();
  const hasChannelSearch = normalizedChannelSearchQuery.length > 0;

  const groups = useMemo(() => Object.keys(groupedChannels), [groupedChannels]);
  const groupSummaries = useMemo<GroupSummary[]>(
    () =>
      groups.map((group, index) => ({
        name: group,
        count: groupedChannels[group]?.length || 0,
        order: index,
      })),
    [groups, groupedChannels],
  );

  const sortedGroupSummaries = useMemo(() => {
    const summaries = [...groupSummaries];

    if (groupSortMode === 'count') {
      summaries.sort((a, b) => b.count - a.count || a.order - b.order);
      return summaries;
    }

    if (groupSortMode === 'name') {
      summaries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
      return summaries;
    }

    summaries.sort((a, b) => a.order - b.order);
    return summaries;
  }, [groupSortMode, groupSummaries]);

  const searchedGroupSummaries = useMemo(() => {
    if (!normalizedGroupSearchQuery) return sortedGroupSummaries;
    return sortedGroupSummaries.filter((item) =>
      item.name.toLowerCase().includes(normalizedGroupSearchQuery),
    );
  }, [normalizedGroupSearchQuery, sortedGroupSummaries]);

  const pinnedGroupSet = useMemo(() => new Set(pinnedGroups), [pinnedGroups]);

  const pinnedGroupSummaries = useMemo(() => {
    const sourceList = normalizedGroupSearchQuery
      ? searchedGroupSummaries
      : groupSummaries;
    return sourceList.filter((item) => pinnedGroupSet.has(item.name));
  }, [
    groupSummaries,
    normalizedGroupSearchQuery,
    pinnedGroupSet,
    searchedGroupSummaries,
  ]);

  const recentGroupSummaries = useMemo(() => {
    const sourceList = normalizedGroupSearchQuery
      ? searchedGroupSummaries
      : groupSummaries;
    const sourceMap = new Map(sourceList.map((item) => [item.name, item]));
    return recentGroups
      .map((groupName) => sourceMap.get(groupName))
      .filter(
        (item): item is GroupSummary =>
          !!item && !pinnedGroupSet.has(item.name),
      );
  }, [
    groupSummaries,
    normalizedGroupSearchQuery,
    pinnedGroupSet,
    recentGroups,
    searchedGroupSummaries,
  ]);

  const panelGroupSummaries = useMemo(() => {
    if (normalizedGroupSearchQuery) {
      return searchedGroupSummaries;
    }

    const hiddenGroups = new Set([
      ...pinnedGroupSummaries.map((item) => item.name),
      ...recentGroupSummaries.map((item) => item.name),
    ]);

    return sortedGroupSummaries.filter((item) => !hiddenGroups.has(item.name));
  }, [
    normalizedGroupSearchQuery,
    pinnedGroupSummaries,
    recentGroupSummaries,
    searchedGroupSummaries,
    sortedGroupSummaries,
  ]);

  const displayChannels = useMemo(() => {
    if (!hasChannelSearch) {
      return filteredChannels;
    }

    return currentChannels.filter(
      (channel) =>
        channel.name.toLowerCase().includes(normalizedChannelSearchQuery) ||
        channel.group.toLowerCase().includes(normalizedChannelSearchQuery),
    );
  }, [
    currentChannels,
    filteredChannels,
    hasChannelSearch,
    normalizedChannelSearchQuery,
  ]);

  const displaySources = useMemo(() => {
    if (!normalizedSourceSearchQuery) {
      return liveSources;
    }

    return liveSources.filter((source) =>
      source.name.toLowerCase().includes(normalizedSourceSearchQuery),
    );
  }, [liveSources, normalizedSourceSearchQuery]);

  const totalChannelCount = currentChannels.length;
  const currentGroupChannelCount = selectedGroup
    ? groupedChannels[selectedGroup]?.length || 0
    : 0;

  useEffect(() => {
    channelHealthMapRef.current = channelHealthMap;
  }, [channelHealthMap]);

  // EPG数据清洗函数 - 去除重叠的节目，保留时间较短的，只显示今日节目
  const cleanEpgData = (
    programs: Array<{ start: string; end: string; title: string }>,
  ) => {
    if (!programs || programs.length === 0) return programs;

    // 获取今日日期（只考虑年月日，忽略时间）
    const today = new Date();
    const todayStart = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const todayEnd = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() + 1,
    );

    // 首先过滤出今日的节目（包括跨天节目）
    const todayPrograms = programs.filter((program) => {
      const programStart = parseCustomTimeFormat(program.start);
      const programEnd = parseCustomTimeFormat(program.end);

      // 获取节目的日期范围
      const programStartDate = new Date(
        programStart.getFullYear(),
        programStart.getMonth(),
        programStart.getDate(),
      );
      const programEndDate = new Date(
        programEnd.getFullYear(),
        programEnd.getMonth(),
        programEnd.getDate(),
      );

      // 如果节目的开始时间或结束时间在今天，或者节目跨越今天，都算作今天的节目
      return (
        (programStartDate >= todayStart && programStartDate < todayEnd) || // 开始时间在今天
        (programEndDate >= todayStart && programEndDate < todayEnd) || // 结束时间在今天
        (programStartDate < todayStart && programEndDate >= todayEnd) // 节目跨越今天（跨天节目）
      );
    });

    // 按开始时间排序
    const sortedPrograms = [...todayPrograms].sort((a, b) => {
      const startA = parseCustomTimeFormat(a.start).getTime();
      const startB = parseCustomTimeFormat(b.start).getTime();
      return startA - startB;
    });

    const cleanedPrograms: Array<{
      start: string;
      end: string;
      title: string;
    }> = [];

    for (let i = 0; i < sortedPrograms.length; i++) {
      const currentProgram = sortedPrograms[i];
      const currentStart = parseCustomTimeFormat(currentProgram.start);
      const currentEnd = parseCustomTimeFormat(currentProgram.end);

      // 检查是否与已添加的节目重叠
      let hasOverlap = false;

      for (const existingProgram of cleanedPrograms) {
        const existingStart = parseCustomTimeFormat(existingProgram.start);
        const existingEnd = parseCustomTimeFormat(existingProgram.end);

        // 检查时间重叠（考虑完整的日期和时间）
        if (
          (currentStart >= existingStart && currentStart < existingEnd) || // 当前节目开始时间在已存在节目时间段内
          (currentEnd > existingStart && currentEnd <= existingEnd) || // 当前节目结束时间在已存在节目时间段内
          (currentStart <= existingStart && currentEnd >= existingEnd) // 当前节目完全包含已存在节目
        ) {
          hasOverlap = true;
          break;
        }
      }

      // 如果没有重叠，则添加该节目
      if (!hasOverlap) {
        cleanedPrograms.push(currentProgram);
      } else {
        // 如果有重叠，检查是否需要替换已存在的节目
        for (let j = 0; j < cleanedPrograms.length; j++) {
          const existingProgram = cleanedPrograms[j];
          const existingStart = parseCustomTimeFormat(existingProgram.start);
          const existingEnd = parseCustomTimeFormat(existingProgram.end);

          // 检查是否与当前节目重叠（考虑完整的日期和时间）
          if (
            (currentStart >= existingStart && currentStart < existingEnd) ||
            (currentEnd > existingStart && currentEnd <= existingEnd) ||
            (currentStart <= existingStart && currentEnd >= existingEnd)
          ) {
            // 计算节目时长
            const currentDuration =
              currentEnd.getTime() - currentStart.getTime();
            const existingDuration =
              existingEnd.getTime() - existingStart.getTime();

            // 如果当前节目时间更短，则替换已存在的节目
            if (currentDuration < existingDuration) {
              cleanedPrograms[j] = currentProgram;
            }
            break;
          }
        }
      }
    }

    return cleanedPrograms;
  };

  // 播放器引用
  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);
  const flvLibRef = useRef<any>(null);

  // 频道列表引用
  const channelListRef = useRef<HTMLDivElement>(null);
  const channelHealthMapRef = useRef<Record<string, ChannelHealthInfo>>({});
  const healthByUrlCacheRef = useRef<Record<string, ChannelHealthInfo>>({});
  const healthCheckingRef = useRef<Set<string>>(new Set());
  const autoFailoverTriedUrlRef = useRef<Set<string>>(new Set());
  const autoFailoverRunningRef = useRef(false);
  const playbackWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  const clearPlaybackWatchdog = () => {
    if (playbackWatchdogRef.current) {
      clearTimeout(playbackWatchdogRef.current);
      playbackWatchdogRef.current = null;
    }
  };

  const setChannelHealth = (channelId: string, info: ChannelHealthInfo) => {
    setChannelHealthMap((prevMap) => ({
      ...prevMap,
      [channelId]: info,
    }));
  };

  const checkChannelHealth = async (
    channel: LiveChannel,
    options?: { force?: boolean },
  ): Promise<ChannelHealthInfo> => {
    const sourceKey = currentSource?.key || currentSourceRef.current?.key;
    const fallbackType = detectTypeFromUrl(channel.url);
    const now = Date.now();

    const fallbackInfo: ChannelHealthInfo = {
      type: fallbackType,
      status: 'unknown',
      checkedAt: now,
    };

    if (!sourceKey) {
      setChannelHealth(channel.id, fallbackInfo);
      return fallbackInfo;
    }

    const cacheKey = `${sourceKey}:${channel.url}`;
    const cachedInfo = healthByUrlCacheRef.current[cacheKey];
    if (
      !options?.force &&
      cachedInfo &&
      now - cachedInfo.checkedAt < HEALTH_CHECK_CACHE_MS
    ) {
      setChannelHealth(channel.id, cachedInfo);
      return cachedInfo;
    }

    if (healthCheckingRef.current.has(cacheKey)) {
      return (
        channelHealthMapRef.current[channel.id] || {
          ...fallbackInfo,
          status: 'checking',
        }
      );
    }

    healthCheckingRef.current.add(cacheKey);
    const checkingInfo: ChannelHealthInfo = {
      type: fallbackType,
      status: 'checking',
      checkedAt: now,
    };
    setChannelHealth(channel.id, checkingInfo);

    try {
      const startedAt =
        typeof performance !== 'undefined' ? performance.now() : 0;
      const precheckUrl = `/api/live/precheck?url=${encodeURIComponent(
        channel.url,
      )}&decotv-source=${sourceKey}`;
      const response = await fetch(precheckUrl, { cache: 'no-store' });
      const elapsedMs =
        typeof performance !== 'undefined'
          ? Math.round(performance.now() - startedAt)
          : undefined;

      if (!response.ok) {
        const unreachableInfo: ChannelHealthInfo = {
          type: fallbackType,
          status: 'unreachable',
          latencyMs: elapsedMs,
          checkedAt: Date.now(),
          message: `HTTP ${response.status}`,
        };
        healthByUrlCacheRef.current[cacheKey] = unreachableInfo;
        setChannelHealth(channel.id, unreachableInfo);
        return unreachableInfo;
      }

      const result = await response.json();
      const detectedType = normalizeStreamType(result?.type);
      const finalType =
        detectedType === 'unknown' ? fallbackType : detectedType;
      const latencyMs =
        typeof result?.latencyMs === 'number'
          ? result.latencyMs
          : elapsedMs || undefined;
      const healthy = Boolean(result?.success);

      const healthInfo: ChannelHealthInfo = {
        type: finalType,
        status: deriveHealthStatus(healthy, latencyMs),
        latencyMs,
        checkedAt: Date.now(),
        message: healthy ? undefined : result?.error || '预检查失败',
      };
      healthByUrlCacheRef.current[cacheKey] = healthInfo;
      setChannelHealth(channel.id, healthInfo);
      return healthInfo;
    } catch (error) {
      const unreachableInfo: ChannelHealthInfo = {
        type: fallbackType,
        status: 'unreachable',
        checkedAt: Date.now(),
        message: error instanceof Error ? error.message : '网络异常',
      };
      healthByUrlCacheRef.current[cacheKey] = unreachableInfo;
      setChannelHealth(channel.id, unreachableInfo);
      return unreachableInfo;
    } finally {
      healthCheckingRef.current.delete(cacheKey);
    }
  };

  // 获取直播源列表
  const fetchLiveSources = async () => {
    try {
      setLoadingStage('fetching');
      setLoadingMessage('正在获取直播源...');

      // 获取 AdminConfig 中的直播源信息
      const response = await fetch('/api/live/sources');
      if (!response.ok) {
        throw new Error('获取直播源失败');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '获取直播源失败');
      }

      const sources = result.data;
      setLiveSources(sources);

      if (sources.length > 0) {
        // 默认选中第一个源
        const firstSource = sources[0];
        if (needLoadSource) {
          const foundSource = sources.find(
            (s: LiveSource) => s.key === needLoadSource,
          );
          if (foundSource) {
            setCurrentSource(foundSource);
            await fetchChannels(foundSource);
          } else {
            setCurrentSource(firstSource);
            await fetchChannels(firstSource);
          }
        } else {
          setCurrentSource(firstSource);
          await fetchChannels(firstSource);
        }
      }

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪...');

      setTimeout(() => {
        setLoading(false);
      }, 1000);
    } catch (err) {
      console.error('获取直播源失败:', err);
      // 不设置错误，而是显示空状态
      setLiveSources([]);
      setLoading(false);
    } finally {
      // 移除 URL 搜索参数中的 source 和 id
      const newSearchParams = new URLSearchParams(searchParams.toString());
      newSearchParams.delete('source');
      newSearchParams.delete('id');

      const newUrl = newSearchParams.toString()
        ? `?${newSearchParams.toString()}`
        : window.location.pathname;

      router.replace(newUrl);
    }
  };

  // 获取频道列表
  const fetchChannels = async (source: LiveSource) => {
    try {
      setIsVideoLoading(true);
      clearPlaybackWatchdog();
      setAutoFailoverMessage(null);
      setChannelHealthMap({});
      channelHealthMapRef.current = {};
      healthByUrlCacheRef.current = {};
      healthCheckingRef.current.clear();
      autoFailoverTriedUrlRef.current.clear();
      autoFailoverRunningRef.current = false;

      // 从 cachedLiveChannels 获取频道信息
      const response = await fetch(`/api/live/channels?source=${source.key}`);
      if (!response.ok) {
        throw new Error('获取频道列表失败');
      }

      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || '获取频道列表失败');
      }

      const channelsData = result.data;
      if (!channelsData || channelsData.length === 0) {
        // 不抛出错误，而是设置空频道列表
        setCurrentChannels([]);
        setGroupedChannels({});
        setFilteredChannels([]);

        // 更新直播源的频道数为 0
        setLiveSources((prevSources) =>
          prevSources.map((s) =>
            s.key === source.key ? { ...s, channelNumber: 0 } : s,
          ),
        );

        setIsVideoLoading(false);
        return;
      }

      // 转换频道数据格式
      const channels: LiveChannel[] = channelsData.map((channel: any) => ({
        id: channel.id,
        tvgId: channel.tvgId || channel.name,
        name: channel.name,
        logo: channel.logo,
        group: channel.group || '其他',
        url: channel.url,
      }));

      setCurrentChannels(channels);

      // 更新直播源的频道数
      setLiveSources((prevSources) =>
        prevSources.map((s) =>
          s.key === source.key ? { ...s, channelNumber: channels.length } : s,
        ),
      );

      // 默认选中第一个频道
      if (channels.length > 0) {
        let initialChannel: LiveChannel = channels[0];
        if (needLoadChannel) {
          const foundChannel = channels.find(
            (c: LiveChannel) => c.id === needLoadChannel,
          );
          if (foundChannel) {
            initialChannel = foundChannel;
            // 延迟滚动到选中的频道
            setTimeout(() => {
              scrollToChannel(foundChannel);
            }, 200);
          }
        }
        setCurrentChannel(initialChannel);
        setVideoUrl(initialChannel.url);
        autoFailoverTriedUrlRef.current.add(initialChannel.url);
      }

      // 按分组组织频道
      const grouped = channels.reduce(
        (acc, channel) => {
          const group = channel.group || '其他';
          if (!acc[group]) {
            acc[group] = [];
          }
          acc[group].push(channel);
          return acc;
        },
        {} as { [key: string]: LiveChannel[] },
      );

      setGroupedChannels(grouped);

      // 默认选中当前加载的channel所在的分组，如果没有则选中第一个分组
      let targetGroup = '';
      if (needLoadChannel) {
        const foundChannel = channels.find(
          (c: LiveChannel) => c.id === needLoadChannel,
        );
        if (foundChannel) {
          targetGroup = foundChannel.group || '其他';
        }
      }

      // 如果目标分组不存在，则使用第一个分组
      if (!targetGroup || !grouped[targetGroup]) {
        targetGroup = Object.keys(grouped)[0] || '';
      }

      // 设置默认分组和对应频道列表
      setSelectedGroup(targetGroup);
      setFilteredChannels(targetGroup ? grouped[targetGroup] : channels);

      if (targetGroup) {
        setActiveTab('channels');
      }

      setIsVideoLoading(false);
    } catch (err) {
      console.error('获取频道列表失败:', err);
      // 不设置错误，而是设置空频道列表
      setCurrentChannels([]);
      setGroupedChannels({});
      setFilteredChannels([]);
      setChannelHealthMap({});
      channelHealthMapRef.current = {};
      healthByUrlCacheRef.current = {};
      healthCheckingRef.current.clear();
      autoFailoverTriedUrlRef.current.clear();
      autoFailoverRunningRef.current = false;

      // 更新直播源的频道数为 0
      setLiveSources((prevSources) =>
        prevSources.map((s) =>
          s.key === source.key ? { ...s, channelNumber: 0 } : s,
        ),
      );

      setIsVideoLoading(false);
    }
  };

  // 切换直播源
  const handleSourceChange = async (source: LiveSource) => {
    try {
      // 设置切换状态，锁住频道切换器
      setIsSwitchingSource(true);
      autoFailoverRunningRef.current = false;
      autoFailoverTriedUrlRef.current.clear();
      clearPlaybackWatchdog();
      setAutoFailoverMessage(null);

      // 首先销毁当前播放器
      cleanupPlayer();

      // 重置不支持的类型状态
      setUnsupportedType(null);

      // 清空节目单信息
      setEpgData(null);

      setCurrentSource(source);
      await fetchChannels(source);
    } catch (err) {
      console.error('切换直播源失败:', err);
      // 不设置错误，保持当前状态
    } finally {
      // 切换完成，解锁频道切换器
      setIsSwitchingSource(false);
      // 自动切换到频道 tab
      setActiveTab('channels');
    }
  };

  // 切换频道
  const handleChannelChange = async (
    channel: LiveChannel,
    options?: { fromAutoFailover?: boolean },
  ) => {
    // 如果正在切换直播源，则禁用频道切换
    if (isSwitchingSource) return;

    clearPlaybackWatchdog();

    // 首先销毁当前播放器
    cleanupPlayer();

    // 重置不支持的类型状态
    setUnsupportedType(null);

    setCurrentChannel(channel);
    setVideoUrl(channel.url);

    if (options?.fromAutoFailover) {
      autoFailoverTriedUrlRef.current.add(channel.url);
    } else {
      autoFailoverRunningRef.current = false;
      autoFailoverTriedUrlRef.current.clear();
      autoFailoverTriedUrlRef.current.add(channel.url);
      setAutoFailoverMessage(null);
    }

    void checkChannelHealth(channel, { force: true });

    // 自动滚动到选中的频道位置
    setTimeout(() => {
      scrollToChannel(channel);
    }, 100);

    // 获取节目单信息
    if (channel.tvgId && currentSource) {
      try {
        setIsEpgLoading(true); // 开始加载 EPG 数据
        const response = await fetch(
          `/api/live/epg?source=${currentSource.key}&tvgId=${channel.tvgId}`,
        );
        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            // 清洗EPG数据，去除重叠的节目
            const cleanedData = {
              ...result.data,
              programs: cleanEpgData(result.data.programs),
            };
            setEpgData(cleanedData);
          }
        }
      } catch (error) {
        console.error('获取节目单信息失败:', error);
      } finally {
        setIsEpgLoading(false); // 无论成功失败都结束加载状态
      }
    } else {
      // 如果没有 tvgId 或 currentSource，清空 EPG 数据
      setEpgData(null);
      setIsEpgLoading(false);
    }
  };

  // 滚动到指定频道位置的函数
  const scrollToChannel = (channel: LiveChannel) => {
    if (!channelListRef.current) return;

    // 使用 data 属性来查找频道元素
    const targetElement = channelListRef.current.querySelector(
      `[data-channel-id="${channel.id}"]`,
    ) as HTMLButtonElement;

    if (targetElement) {
      // 计算滚动位置，使频道居中显示
      const container = channelListRef.current;
      const containerRect = container.getBoundingClientRect();
      const elementRect = targetElement.getBoundingClientRect();

      // 计算目标滚动位置
      const scrollTop =
        container.scrollTop +
        (elementRect.top - containerRect.top) -
        containerRect.height / 2 +
        elementRect.height / 2;

      // 平滑滚动到目标位置
      container.scrollTo({
        top: Math.max(0, scrollTop),
        behavior: 'smooth',
      });
    }
  };

  // 清理播放器资源的统一函数
  const cleanupPlayer = () => {
    // 重置不支持的类型状态
    setUnsupportedType(null);
    clearPlaybackWatchdog();

    if (artPlayerRef.current) {
      try {
        const videoElement = artPlayerRef.current
          .video as HTMLVideoElement | null;

        // 销毁 HLS 实例
        if (videoElement && videoElement.hls) {
          videoElement.hls.destroy();
          videoElement.hls = null;
        }

        // 销毁 FLV 实例 - 增强清理逻辑
        if (videoElement && videoElement.flv) {
          try {
            // 先停止加载
            if (videoElement.flv.unload) {
              videoElement.flv.unload();
            }
            if (videoElement.flv.detachMediaElement) {
              videoElement.flv.detachMediaElement();
            }
            // 销毁播放器
            videoElement.flv.destroy();
            // 确保引用被清空
            videoElement.flv = null;
          } catch (flvError) {
            console.warn('FLV实例销毁时出错:', flvError);
            // 强制清空引用
            videoElement.flv = null;
          }
        }

        if (videoElement) {
          videoElement.pause();
          videoElement.removeAttribute('src');
          const sourceElements = Array.from(
            videoElement.getElementsByTagName('source'),
          );
          sourceElements.forEach((source) => source.remove());
          try {
            videoElement.load();
          } catch {
            // ignore
          }
        }

        // 移除所有事件监听器
        artPlayerRef.current.off('ready');
        artPlayerRef.current.off('loadstart');
        artPlayerRef.current.off('loadeddata');
        artPlayerRef.current.off('canplay');
        artPlayerRef.current.off('waiting');
        artPlayerRef.current.off('error');

        // 销毁 ArtPlayer 实例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // 确保视频源正确设置
  const ensureVideoSource = (video: HTMLVideoElement | null, url: string) => {
    if (!video || !url) return;
    const sources = Array.from(video.getElementsByTagName('source'));
    const existed = sources.some((s) => s.src === url);
    if (!existed) {
      // 移除旧的 source，保持唯一
      sources.forEach((s) => s.remove());
      const sourceEl = document.createElement('source');
      sourceEl.src = url;
      video.appendChild(sourceEl);
    }

    // 始终允许远程播放（AirPlay / Cast）
    video.disableRemotePlayback = false;
    // 如果曾经有禁用属性，移除之
    if (video.hasAttribute('disableRemotePlayback')) {
      video.removeAttribute('disableRemotePlayback');
    }
  };

  const persistRecentGroups = (nextGroups: string[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(RECENT_GROUPS_STORAGE_KEY, JSON.stringify(nextGroups));
  };

  const persistPinnedGroups = (nextGroups: string[]) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PINNED_GROUPS_STORAGE_KEY, JSON.stringify(nextGroups));
  };

  const pushRecentGroup = (group: string) => {
    setRecentGroups((prevGroups) => {
      const nextGroups = [group, ...prevGroups.filter((item) => item !== group)]
        .filter(Boolean)
        .slice(0, MAX_RECENT_GROUPS);
      persistRecentGroups(nextGroups);
      return nextGroups;
    });
  };

  const handlePinnedGroupToggle = (group: string) => {
    setPinnedGroups((prevGroups) => {
      const exists = prevGroups.includes(group);
      const nextGroups = exists
        ? prevGroups.filter((item) => item !== group)
        : [group, ...prevGroups];
      persistPinnedGroups(nextGroups);
      return nextGroups;
    });
  };

  const handleSelectGroupFromPanel = (group: string) => {
    handleGroupChange(group);
    setIsGroupSelectorOpen(false);
    setGroupSearchQuery('');
  };

  // 切换分组
  const handleGroupChange = (
    group: string,
    options?: { preserveSearch?: boolean; skipRecent?: boolean },
  ) => {
    // 如果正在切换直播源，则禁用分组切换
    if (isSwitchingSource) return;

    // 清空搜索框
    if (!options?.preserveSearch) {
      setChannelSearchQuery('');
    }

    setSelectedGroup(group);
    const filtered = groupedChannels[group] || [];
    setFilteredChannels(filtered);
    if (!options?.skipRecent) {
      pushRecentGroup(group);
    }

    // 如果当前选中的频道在新的分组中，自动滚动到该频道位置
    if (
      currentChannel &&
      filtered.some((channel) => channel.id === currentChannel.id)
    ) {
      setTimeout(() => {
        scrollToChannel(currentChannel);
      }, 100);
    } else {
      // 否则滚动到频道列表顶端
      if (channelListRef.current) {
        channelListRef.current.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      }
    }
  };

  const attemptAutoFailover = async (reason: string) => {
    if (!autoFailoverEnabled || isSwitchingSource) return false;
    if (autoFailoverRunningRef.current) return false;

    const current = currentChannelRef.current;
    if (!current) return false;

    autoFailoverRunningRef.current = true;

    try {
      const normalizedName = current.name.trim().toLowerCase();
      const candidates = currentChannels.filter((candidate) => {
        if (candidate.id === current.id) return false;
        if (autoFailoverTriedUrlRef.current.has(candidate.url)) return false;

        const sameName = candidate.name.trim().toLowerCase() === normalizedName;
        const sameTvg =
          current.tvgId &&
          candidate.tvgId &&
          current.tvgId === candidate.tvgId &&
          current.tvgId !== current.name;
        return sameName || sameTvg;
      });

      if (candidates.length === 0) {
        setAutoFailoverMessage(`自动切换失败: 未找到候选线路（${reason}）`);
        return false;
      }

      const unresolvedCandidates = candidates
        .filter((candidate) => {
          const status = channelHealthMapRef.current[candidate.id]?.status;
          return !status || status === 'unknown' || status === 'checking';
        })
        .slice(0, 3);
      if (unresolvedCandidates.length > 0) {
        await Promise.all(
          unresolvedCandidates.map((candidate) =>
            checkChannelHealth(candidate),
          ),
        );
      }

      const priorityScore: Record<ChannelHealthStatus, number> = {
        healthy: 5,
        slow: 4,
        unknown: 3,
        checking: 2,
        unreachable: 1,
      };

      const rankedCandidates = [...candidates].sort((a, b) => {
        const healthA = channelHealthMapRef.current[a.id]?.status || 'unknown';
        const healthB = channelHealthMapRef.current[b.id]?.status || 'unknown';
        return priorityScore[healthB] - priorityScore[healthA];
      });

      const nextChannel = rankedCandidates[0];
      autoFailoverTriedUrlRef.current.add(nextChannel.url);
      setAutoFailoverMessage(
        `线路异常，已自动切换到候选线路（${reason}）: ${nextChannel.name}`,
      );
      await handleChannelChange(nextChannel, { fromAutoFailover: true });
      return true;
    } finally {
      autoFailoverRunningRef.current = false;
    }
  };

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (!currentSourceRef.current || !currentChannelRef.current) return;

    try {
      const currentFavorited = favoritedRef.current;
      const newFavorited = !currentFavorited;

      // 立即更新状态
      setFavorited(newFavorited);
      favoritedRef.current = newFavorited;

      // 异步执行收藏操作
      try {
        if (newFavorited) {
          // 如果未收藏，添加收藏
          await saveFavorite(
            `live_${currentSourceRef.current.key}`,
            `live_${currentChannelRef.current.id}`,
            {
              title: currentChannelRef.current.name,
              source_name: currentSourceRef.current.name,
              year: '',
              cover: `/api/proxy/logo?url=${encodeURIComponent(
                currentChannelRef.current.logo,
              )}&source=${currentSourceRef.current.key}`,
              total_episodes: 1,
              save_time: Date.now(),
              search_title: '',
              origin: 'live',
            },
          );
        } else {
          // 如果已收藏，删除收藏
          await deleteFavorite(
            `live_${currentSourceRef.current.key}`,
            `live_${currentChannelRef.current.id}`,
          );
        }
      } catch (err) {
        console.error('收藏操作失败:', err);
        // 如果操作失败，回滚状态
        setFavorited(currentFavorited);
        favoritedRef.current = currentFavorited;
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  // 初始化
  useEffect(() => {
    fetchLiveSources();

    // 初始化直连模式状态
    const savedDirectConnect = localStorage.getItem('liveDirectConnect');
    if (savedDirectConnect !== null) {
      setIsDirectConnect(savedDirectConnect === 'true');
    }

    const savedAutoFailover = localStorage.getItem(AUTO_FAILOVER_STORAGE_KEY);
    if (savedAutoFailover !== null) {
      setAutoFailoverEnabled(savedAutoFailover === 'true');
    }

    const savedRecentGroups = parseStoredStringArray(
      localStorage.getItem(RECENT_GROUPS_STORAGE_KEY),
    ).slice(0, MAX_RECENT_GROUPS);
    setRecentGroups(savedRecentGroups);

    const savedPinnedGroups = parseStoredStringArray(
      localStorage.getItem(PINNED_GROUPS_STORAGE_KEY),
    );
    setPinnedGroups(savedPinnedGroups);
  }, []);

  useEffect(() => {
    if (groups.length === 0) {
      return;
    }

    setRecentGroups((prevGroups) => {
      const nextGroups = prevGroups
        .filter((group) => groups.includes(group))
        .slice(0, MAX_RECENT_GROUPS);
      if (nextGroups.length !== prevGroups.length) {
        persistRecentGroups(nextGroups);
      }
      return nextGroups;
    });

    setPinnedGroups((prevGroups) => {
      const nextGroups = prevGroups.filter((group) => groups.includes(group));
      if (nextGroups.length !== prevGroups.length) {
        persistPinnedGroups(nextGroups);
      }
      return nextGroups;
    });
  }, [groups]);

  useEffect(() => {
    if (
      !currentSource ||
      activeTab !== 'channels' ||
      displayChannels.length === 0
    )
      return;

    const probeTargets = displayChannels.slice(0, HEALTH_CHECK_BATCH_SIZE);
    let cancelled = false;

    const runProbeQueue = async () => {
      for (let i = 0; i < probeTargets.length; i++) {
        if (cancelled) break;
        const channel = probeTargets[i];
        void checkChannelHealth(channel);
        if (i < probeTargets.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
    };

    void runProbeQueue();
    return () => {
      cancelled = true;
    };
  }, [
    activeTab,
    currentSource,
    displayChannels,
    selectedGroup,
    normalizedChannelSearchQuery,
  ]);

  useEffect(() => {
    if (!currentChannel) return;
    void checkChannelHealth(currentChannel, { force: true });
  }, [currentChannel]);

  // 切换直连模式
  const handleDirectConnectToggle = (value: boolean) => {
    setIsDirectConnect(value);
    localStorage.setItem('liveDirectConnect', JSON.stringify(value));
    // 显示提示
    setShowDirectConnectTip(true);
    setTimeout(() => setShowDirectConnectTip(false), 5000);
  };

  const handleAutoFailoverToggle = (value: boolean) => {
    setAutoFailoverEnabled(value);
    localStorage.setItem(AUTO_FAILOVER_STORAGE_KEY, JSON.stringify(value));
    setAutoFailoverMessage(value ? '自动失败切换已启用' : '自动失败切换已关闭');
    setTimeout(() => setAutoFailoverMessage(null), 3500);
  };

  // 检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentChannel) return;
    (async () => {
      try {
        const fav = await checkIsFavorited(
          `live_${currentSource.key}`,
          `live_${currentChannel.id}`,
        );
        setFavorited(fav);
        favoritedRef.current = fav;
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentChannel]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentChannel) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(
          `live_${currentSource.key}`,
          `live_${currentChannel.id}`,
        );
        const isFav = !!favorites[key];
        setFavorited(isFav);
        favoritedRef.current = isFav;
      },
    );

    return unsubscribe;
  }, [currentSource, currentChannel]);

  const ensureFlvLibrary = async () => {
    if (flvLibRef.current) {
      return flvLibRef.current;
    }

    const flvModule = await import('flv.js');
    flvLibRef.current = flvModule.default || flvModule;
    return flvLibRef.current;
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 所有的请求都带一个 source 参数
        try {
          const url = new URL(context.url);
          url.searchParams.set(
            'decotv-source',
            currentSourceRef.current?.key || '',
          );
          context.url = url.toString();
        } catch {
          // ignore
        }
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          // 判断是否浏览器直连
          const isLiveDirectConnectStr =
            localStorage.getItem('liveDirectConnect');
          const isLiveDirectConnect = isLiveDirectConnectStr === 'true';
          if (isLiveDirectConnect) {
            // 浏览器直连，使用 URL 对象处理参数
            try {
              const url = new URL(context.url);
              url.searchParams.set('allowCORS', 'true');
              context.url = url.toString();
            } catch {
              // 如果 URL 解析失败，回退到字符串拼接
              context.url = context.url + '&allowCORS=true';
            }
          }
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  function m3u8Loader(video: HTMLVideoElement, url: string) {
    if (!Hls) {
      console.error('HLS.js 未加载');
      return;
    }

    // 清理之前的 HLS 实例
    if (video.hls) {
      try {
        video.hls.destroy();
        video.hls = null;
      } catch (err) {
        console.warn('清理 HLS 实例时出错:', err);
      }
    }

    const hls = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: true,
      maxBufferLength: 30,
      backBufferLength: 30,
      maxBufferSize: 60 * 1000 * 1000,
      loader: CustomHlsJsLoader,
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    video.hls = hls;

    hls.on(Hls.Events.ERROR, function (event: any, data: any) {
      console.error('HLS Error:', event, data);

      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            // hls.recoverMediaError();
            break;
          default:
            hls.destroy();
            break;
        }
      }
    });
  }

  function mp4Loader(video: HTMLVideoElement, url: string) {
    if (!video) return;

    if (video.flv) {
      try {
        if (video.flv.unload) {
          video.flv.unload();
        }
        if (video.flv.detachMediaElement) {
          video.flv.detachMediaElement();
        }
        video.flv.destroy();
      } catch {
        // ignore
      } finally {
        video.flv = null;
      }
    }

    if (video.hls) {
      try {
        video.hls.destroy();
      } catch {
        // ignore
      } finally {
        video.hls = null;
      }
    }

    ensureVideoSource(video, url);
  }

  function flvLoader(video: HTMLVideoElement, url: string) {
    const flvjs = flvLibRef.current;
    if (!flvjs || !flvjs.isSupported || !flvjs.isSupported()) {
      console.error('FLV.js 未就绪或当前浏览器不支持 FLV');
      setUnsupportedType('flv');
      setIsVideoLoading(false);
      return;
    }

    if (video.flv) {
      try {
        if (video.flv.unload) {
          video.flv.unload();
        }
        if (video.flv.detachMediaElement) {
          video.flv.detachMediaElement();
        }
        video.flv.destroy();
      } catch (error) {
        console.warn('重建 FLV 播放器前清理失败:', error);
      } finally {
        video.flv = null;
      }
    }

    const flvPlayer = flvjs.createPlayer(
      {
        type: 'flv',
        url,
        isLive: true,
      },
      {
        enableWorker: true,
        enableStashBuffer: false,
        stashInitialSize: 128,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 30,
        autoCleanupMinBackwardDuration: 10,
        lazyLoad: false,
      },
    );

    flvPlayer.attachMediaElement(video);
    if (flvjs.Events?.ERROR) {
      flvPlayer.on(flvjs.Events.ERROR, (...args: any[]) => {
        console.error('FLV 播放错误:', args);
        void attemptAutoFailover('FLV错误');
      });
    } else {
      flvPlayer.on('error', (...args: any[]) => {
        console.error('FLV 播放错误:', args);
        void attemptAutoFailover('FLV错误');
      });
    }
    flvPlayer.load();
    flvPlayer.play().catch(() => {});
    video.flv = flvPlayer;
  }

  // 播放器初始化
  useEffect(() => {
    let cancelled = false;

    const preload = async () => {
      if (
        !Artplayer ||
        !Hls ||
        !videoUrl ||
        !artRef.current ||
        !currentChannel
      ) {
        return;
      }

      console.log('视频URL:', videoUrl);

      // 销毁之前的播放器实例并创建新的
      if (artPlayerRef.current) {
        cleanupPlayer();
      }

      // precheck type
      let type: LiveStreamType = detectTypeFromUrl(videoUrl);
      const sourceKey =
        currentSource?.key || currentSourceRef.current?.key || '';
      const encodedVideoUrl = encodeURIComponent(videoUrl);
      const precheckUrl = `/api/live/precheck?url=${encodedVideoUrl}&decotv-source=${sourceKey}`;
      let precheckLatencyMs: number | undefined;
      let precheckReachable = true;

      try {
        const precheckResponse = await fetch(precheckUrl, {
          cache: 'no-store',
        });
        if (precheckResponse.ok) {
          const precheckResult = await precheckResponse.json();
          if (typeof precheckResult?.latencyMs === 'number') {
            precheckLatencyMs = precheckResult.latencyMs;
          }
          if (precheckResult.success) {
            const precheckedType = normalizeStreamType(precheckResult.type);
            if (precheckedType !== 'unknown') {
              type = precheckedType;
            }
          } else {
            precheckReachable = false;
          }
        } else {
          console.warn('预检查失败:', precheckResponse.statusText);
          precheckReachable = false;
        }
      } catch (error) {
        console.warn('预检查异常，回退到 URL 类型推断:', error);
        precheckReachable = false;
      }

      if (type === 'unknown') {
        type = 'm3u8';
      }

      const currentHealthInfo: ChannelHealthInfo = {
        type,
        status: deriveHealthStatus(precheckReachable, precheckLatencyMs),
        latencyMs: precheckLatencyMs,
        checkedAt: Date.now(),
        message: precheckReachable ? undefined : '预检查失败',
      };
      setChannelHealth(currentChannel.id, currentHealthInfo);
      if (sourceKey) {
        healthByUrlCacheRef.current[`${sourceKey}:${videoUrl}`] =
          currentHealthInfo;
      }

      if (type === 'flv') {
        try {
          const flvjs = await ensureFlvLibrary();
          if (!flvjs?.isSupported?.()) {
            setUnsupportedType(type);
            setIsVideoLoading(false);
            return;
          }
        } catch (error) {
          console.error('加载 FLV 库失败:', error);
          setUnsupportedType(type);
          setIsVideoLoading(false);
          return;
        }
      }

      if (cancelled) {
        return;
      }

      // 重置不支持的类型
      setUnsupportedType(null);

      const customType = {
        m3u8: m3u8Loader,
        mp4: mp4Loader,
        flv: flvLoader,
      };

      const targetUrl =
        type === 'm3u8'
          ? `/api/proxy/m3u8?url=${encodedVideoUrl}&decotv-source=${sourceKey}`
          : type === 'flv'
            ? `/api/proxy/stream?url=${encodedVideoUrl}&decotv-source=${sourceKey}`
            : isDirectConnect
              ? videoUrl
              : `/api/proxy/stream?url=${encodedVideoUrl}&decotv-source=${sourceKey}`;

      if (type === 'flv' && isDirectConnect) {
        setAutoFailoverMessage('FLV 直播为保证稳定性已自动走代理播放');
        setTimeout(() => setAutoFailoverMessage(null), 4000);
      }

      try {
        // 创建新的播放器实例
        Artplayer.USE_RAF = true;

        artPlayerRef.current = new Artplayer({
          container: artRef.current,
          url: targetUrl,
          poster: currentChannel.logo,
          volume: 0.7,
          isLive: true, // 设置为直播模式
          muted: false,
          autoplay: true,
          pip: true,
          autoSize: false,
          autoMini: false,
          screenshot: false,
          setting: false,
          loop: false,
          flip: false,
          playbackRate: false,
          aspectRatio: false,
          fullscreen: true,
          fullscreenWeb: true,
          subtitleOffset: false,
          miniProgressBar: false,
          mutex: true,
          playsInline: true,
          autoPlayback: false,
          airplay: true,
          theme: '#22c55e',
          lang: 'zh-cn',
          hotkey: false,
          fastForward: false, // 直播不需要快进
          autoOrientation: true,
          lock: true,
          moreVideoAttr: {
            crossOrigin: 'anonymous',
            preload: 'metadata',
          },
          type: type,
          customType: customType,
          icons: {
            loading:
              '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
          },
        });

        const startPlaybackWatchdog = () => {
          clearPlaybackWatchdog();
          playbackWatchdogRef.current = setTimeout(() => {
            void attemptAutoFailover('加载超时');
          }, PLAYBACK_TIMEOUT_MS);
        };

        const stopPlaybackWatchdog = () => {
          clearPlaybackWatchdog();
        };

        // 监听播放器事件
        artPlayerRef.current.on('ready', () => {
          setError(null);
          setIsVideoLoading(false);
          stopPlaybackWatchdog();
        });

        artPlayerRef.current.on('loadstart', () => {
          setIsVideoLoading(true);
          startPlaybackWatchdog();
        });

        artPlayerRef.current.on('loadeddata', () => {
          setIsVideoLoading(false);
          stopPlaybackWatchdog();
        });

        artPlayerRef.current.on('canplay', () => {
          setIsVideoLoading(false);
          stopPlaybackWatchdog();
        });

        artPlayerRef.current.on('waiting', () => {
          setIsVideoLoading(true);
          if (!playbackWatchdogRef.current) {
            startPlaybackWatchdog();
          }
        });

        artPlayerRef.current.on('error', (err: any) => {
          console.error('播放器错误:', err);
          stopPlaybackWatchdog();
          void attemptAutoFailover('播放器报错');
        });

        if (artPlayerRef.current?.video && type !== 'flv') {
          ensureVideoSource(
            artPlayerRef.current.video as HTMLVideoElement,
            targetUrl,
          );
        }
      } catch (err) {
        console.error('创建播放器失败:', err);
        setIsVideoLoading(false);
        void attemptAutoFailover('播放器初始化失败');
      }
    };
    preload();

    return () => {
      cancelled = true;
      clearPlaybackWatchdog();
    };
  }, [Artplayer, Hls, videoUrl, currentChannel, loading, isDirectConnect]);

  // 清理播放器资源
  useEffect(() => {
    return () => {
      cleanupPlayer();
    };
  }, []);

  // 页面卸载时的额外清理
  useEffect(() => {
    const handleBeforeUnload = () => {
      cleanupPlayer();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      cleanupPlayer();
    };
  }, []);

  // 全局快捷键处理
  useEffect(() => {
    const handleKeyboardShortcuts = (e: KeyboardEvent) => {
      // 忽略输入框中的按键事件
      if (
        (e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'TEXTAREA'
      )
        return;

      // 上箭头 = 音量+
      if (e.key === 'ArrowUp') {
        if (artPlayerRef.current && artPlayerRef.current.volume < 1) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume + 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100,
          )}`;
          e.preventDefault();
        }
      }

      // 下箭头 = 音量-
      if (e.key === 'ArrowDown') {
        if (artPlayerRef.current && artPlayerRef.current.volume > 0) {
          artPlayerRef.current.volume =
            Math.round((artPlayerRef.current.volume - 0.1) * 10) / 10;
          artPlayerRef.current.notice.show = `音量: ${Math.round(
            artPlayerRef.current.volume * 100,
          )}`;
          e.preventDefault();
        }
      }

      // 空格 = 播放/暂停
      if (e.key === ' ') {
        if (artPlayerRef.current) {
          artPlayerRef.current.toggle();
          e.preventDefault();
        }
      }

      // f 键 = 切换全屏
      if (e.key === 'f' || e.key === 'F') {
        if (artPlayerRef.current) {
          artPlayerRef.current.fullscreen = !artPlayerRef.current.fullscreen;
          e.preventDefault();
        }
      }
    };

    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  const renderGroupRow = (groupItem: GroupSummary) => {
    const isSelected = selectedGroup === groupItem.name;
    const isPinned = pinnedGroupSet.has(groupItem.name);

    return (
      <div
        key={groupItem.name}
        className={`group rounded-xl border transition-all duration-200 ${
          isSelected
            ? 'border-green-400 bg-green-50 dark:bg-green-900/20 dark:border-green-700'
            : 'border-gray-200 dark:border-gray-700 hover:border-green-300 dark:hover:border-green-700 bg-white/60 dark:bg-gray-800/40'
        }`}
      >
        <div className='flex items-center'>
          <button
            onClick={() => handleSelectGroupFromPanel(groupItem.name)}
            className='flex-1 px-4 py-3 text-left'
          >
            <div className='flex items-center justify-between gap-3'>
              <div className='min-w-0'>
                <div className='font-medium text-gray-900 dark:text-gray-100 truncate'>
                  {groupItem.name}
                </div>
                <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  {groupItem.count} 个频道
                </div>
              </div>
              {isSelected && (
                <span className='shrink-0 px-2 py-1 text-xs rounded-full bg-green-600 text-white'>
                  当前
                </span>
              )}
            </div>
          </button>

          <button
            onClick={(event) => {
              event.stopPropagation();
              handlePinnedGroupToggle(groupItem.name);
            }}
            className='mx-2 p-2 rounded-lg text-gray-400 hover:text-green-600 dark:hover:text-green-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors'
            title={isPinned ? '取消置顶分类' : '置顶分类'}
          >
            {isPinned ? (
              <PinOff className='w-4 h-4' />
            ) : (
              <Pin className='w-4 h-4' />
            )}
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画直播图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>📺</div>
                {/* 旋转光环 */}
                <div className='absolute -inset-2 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
              </div>

              {/* 浮动粒子效果 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-green-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-lime-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
              </div>
            </div>

            {/* 进度指示器 */}
            <div className='mb-6 w-80 mx-auto'>
              <div className='flex justify-center space-x-2 mb-4'>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'loading'
                      ? 'bg-green-500 scale-125'
                      : 'bg-green-500'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : 'bg-green-500'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'ready'
                      ? 'bg-green-500 scale-125'
                      : 'bg-gray-300'
                  }`}
                ></div>
              </div>

              {/* 进度条 */}
              <div className='w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden'>
                <div
                  className='h-full bg-linear-to-r from-green-500 to-emerald-600 rounded-full transition-all duration-1000 ease-out'
                  style={{
                    width:
                      loadingStage === 'loading'
                        ? '33%'
                        : loadingStage === 'fetching'
                          ? '66%'
                          : '100%',
                  }}
                ></div>
              </div>
            </div>

            {/* 加载消息 */}
            <div className='space-y-2'>
              <p className='text-xl font-semibold text-gray-800 dark:text-gray-200 animate-pulse'>
                {loadingMessage}
              </p>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/live'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 bg-linear-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>
            </div>

            {/* 错误信息 */}
            <div className='space-y-4 mb-8'>
              <h2 className='text-2xl font-bold text-gray-800 dark:text-gray-200'>
                哎呀，出现了一些问题
              </h2>
              <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4'>
                <p className='text-red-600 dark:text-red-400 font-medium'>
                  {error}
                </p>
              </div>
              <p className='text-sm text-gray-500 dark:text-gray-400'>
                请检查网络连接或尝试刷新页面
              </p>
            </div>

            {/* 操作按钮 */}
            <div className='space-y-3'>
              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-linear-to-r from-blue-500 to-cyan-600 text-white rounded-xl font-medium hover:from-blue-600 hover:to-cyan-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                🔄 重新尝试
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/live'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-12 2xl:px-20'>
        {/* 第一行：页面标题和直连开关 */}
        <div className='py-1 flex items-center justify-between'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2 max-w-[60%] lg:max-w-[80%]'>
            <Radio className='w-5 h-5 text-blue-500 shrink-0' />
            <div className='min-w-0 flex-1'>
              <div className='truncate'>
                {currentSource?.name}
                {currentSource && currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${currentChannel.name}`}
                  </span>
                )}
                {currentSource && !currentChannel && (
                  <span className='text-gray-500 dark:text-gray-400'>
                    {` > ${currentSource.name}`}
                  </span>
                )}
              </div>
            </div>
          </h1>

          {/* 直连模式开关 */}
          <div className='flex items-center gap-2'>
            <button
              onClick={() => handleDirectConnectToggle(!isDirectConnect)}
              className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-200 ${
                isDirectConnect
                  ? 'bg-green-500/10 border-green-500/50 text-green-600 dark:text-green-400 hover:bg-green-500/20'
                  : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              title={
                isDirectConnect
                  ? '直连模式已开启（减少延迟）'
                  : '代理模式（兼容性更好）'
              }
            >
              <Zap
                className={`w-4 h-4 ${isDirectConnect ? 'fill-green-500' : ''}`}
              />
              <span className='text-xs font-medium hidden sm:inline'>
                {isDirectConnect ? '直连' : '代理'}
              </span>
              {/* 状态指示点 */}
              <div
                className={`w-2 h-2 rounded-full ${
                  isDirectConnect ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                }`}
              ></div>
            </button>

            {/* 帮助图标 */}
            <button
              onClick={() => setShowDirectConnectTip(!showDirectConnectTip)}
              className='p-1.5 rounded-full text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
              title='关于直连模式'
            >
              <Info className='w-4 h-4' />
            </button>
          </div>
        </div>

        {/* 直连模式提示 */}
        {showDirectConnectTip && (
          <div
            className={`relative p-3 rounded-xl border transition-all duration-300 ${
              isDirectConnect
                ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
            }`}
          >
            <button
              onClick={() => setShowDirectConnectTip(false)}
              className='absolute top-2 right-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
            >
              ✕
            </button>
            <div className='flex items-start gap-3'>
              <div
                className={`p-2 rounded-lg ${
                  isDirectConnect
                    ? 'bg-green-100 dark:bg-green-800/30'
                    : 'bg-blue-100 dark:bg-blue-800/30'
                }`}
              >
                <Zap
                  className={`w-5 h-5 ${
                    isDirectConnect
                      ? 'text-green-600 dark:text-green-400'
                      : 'text-blue-600 dark:text-blue-400'
                  }`}
                />
              </div>
              <div className='flex-1'>
                <h4
                  className={`text-sm font-medium ${
                    isDirectConnect
                      ? 'text-green-800 dark:text-green-300'
                      : 'text-blue-800 dark:text-blue-300'
                  }`}
                >
                  {isDirectConnect ? '🚀 直连模式已开启' : '🛡️ 代理模式'}
                </h4>
                <p className='text-xs text-gray-600 dark:text-gray-400 mt-1'>
                  {isDirectConnect
                    ? '视频将直接从源服务器加载，减少延迟。如遇跨域问题，请安装 "Allow CORS" 浏览器插件，或切换回代理模式。'
                    : '视频通过服务器代理加载，兼容性最好。如遇卡顿，可尝试开启直连模式提升流畅度。'}
                </p>
              </div>
            </div>
          </div>
        )}

        <div className='flex flex-wrap items-center gap-2'>
          <button
            onClick={() => handleAutoFailoverToggle(!autoFailoverEnabled)}
            className={`group relative flex items-center gap-1.5 px-3 py-1.5 rounded-full border transition-all duration-200 ${
              autoFailoverEnabled
                ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
            title={
              autoFailoverEnabled ? '自动失败切换已开启' : '自动失败切换已关闭'
            }
          >
            <span className='text-xs font-medium'>自动切线</span>
            <div
              className={`w-2 h-2 rounded-full ${
                autoFailoverEnabled
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
          </button>

          {autoFailoverMessage && (
            <div className='px-3 py-1.5 rounded-full text-xs border border-emerald-200 dark:border-emerald-800 bg-emerald-50/80 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300'>
              {autoFailoverMessage}
            </div>
          )}
        </div>

        {/* 第二行：播放器和频道列表 */}
        <div className='space-y-2'>
          {/* 折叠控制 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-end'>
            <button
              onClick={() => setIsChannelListCollapsed(!isChannelListCollapsed)}
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/90 hover:bg-white dark:bg-gray-800/90 dark:hover:bg-gray-800 border border-gray-200/60 dark:border-gray-700/60 shadow-sm hover:shadow-md transition-all duration-200'
              title={isChannelListCollapsed ? '显示频道列表' : '隐藏频道列表'}
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isChannelListCollapsed ? 'rotate-180' : 'rotate-0'
                }`}
                fill='none'
                stroke='currentColor'
                viewBox='0 0 24 24'
              >
                <path
                  strokeLinecap='round'
                  strokeLinejoin='round'
                  strokeWidth='2'
                  d='M9 5l7 7-7 7'
                />
              </svg>
              <span className='text-xs font-medium text-gray-600 dark:text-gray-300'>
                {isChannelListCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isChannelListCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-125 xl:h-162.5 2xl:h-187.5 transition-all duration-300 ease-in-out ${
              isChannelListCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out ${
                isChannelListCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-75 lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30'
                ></div>

                {/* 不支持的直播类型提示 */}
                {unsupportedType && (
                  <div className='absolute inset-0 bg-black/92 rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-600 transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-orange-500 to-red-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>⚠️</div>
                          <div className='absolute -inset-2 bg-linear-to-r from-orange-500 to-red-600 rounded-2xl opacity-20 animate-pulse'></div>
                        </div>
                      </div>
                      <div className='space-y-4'>
                        <h3 className='text-xl font-semibold text-white'>
                          暂不支持的直播流类型
                        </h3>
                        <div className='bg-orange-500/20 border border-orange-500/30 rounded-lg p-4'>
                          <p className='text-orange-300 font-medium'>
                            当前频道直播流类型：
                            <span className='text-white font-bold'>
                              {unsupportedType.toUpperCase()}
                            </span>
                          </p>
                          <p className='text-sm text-orange-200 mt-2'>
                            当前支持 M3U8、MP4、FLV 直播流，请切换线路或分组重试
                          </p>
                        </div>
                        <p className='text-sm text-gray-300'>请尝试其他频道</p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 视频加载蒙层 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 bg-black/90 rounded-xl overflow-hidden shadow-lg border border-white/0 dark:border-white/30 flex items-center justify-center z-500 transition-all duration-300'>
                    <div className='text-center max-w-md mx-auto px-6'>
                      <div className='relative mb-8'>
                        <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                          <div className='text-white text-4xl'>📺</div>
                          <div className='absolute -inset-2 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl opacity-20 animate-spin'></div>
                        </div>
                      </div>
                      <div className='space-y-2'>
                        <p className='text-xl font-semibold text-white animate-pulse'>
                          🔄 IPTV 加载中...
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 频道列表 */}
            <div
              className={`h-75 lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isChannelListCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <div className='md:ml-2 px-4 py-0 h-full rounded-xl bg-black/10 dark:bg-white/5 flex flex-col border border-white/0 dark:border-white/30 overflow-hidden'>
                {/* 主要的 Tab 切换 */}
                <div className='flex mb-1 -mx-6 shrink-0'>
                  <div
                    onClick={() => setActiveTab('channels')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${
                        activeTab === 'channels'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                      }
                    `.trim()}
                  >
                    频道
                  </div>
                  <div
                    onClick={() => setActiveTab('sources')}
                    className={`flex-1 py-3 px-6 text-center cursor-pointer transition-all duration-200 font-medium
                      ${
                        activeTab === 'sources'
                          ? 'text-green-600 dark:text-green-400'
                          : 'text-gray-700 hover:text-green-600 bg-black/5 dark:bg-white/5 dark:text-gray-300 dark:hover:text-green-400 hover:bg-black/3 dark:hover:bg-white/3'
                      }
                    `.trim()}
                  >
                    直播源
                  </div>
                </div>

                {/* 频道 Tab 内容 */}
                {activeTab === 'channels' && (
                  <>
                    {/* 搜索框 */}
                    <div className='mb-3 shrink-0 px-1'>
                      <div className='relative'>
                        <input
                          type='text'
                          placeholder='搜索频道...'
                          value={channelSearchQuery}
                          onChange={(e) =>
                            setChannelSearchQuery(e.target.value)
                          }
                          className='w-full px-3 py-2 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:focus:ring-green-400 text-sm'
                        />
                        {channelSearchQuery && (
                          <button
                            onClick={() => setChannelSearchQuery('')}
                            className='absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
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
                                d='M6 18L18 6M6 6l12 12'
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 分组标签 - 横向滚动 */}
                    {!hasChannelSearch && (
                      <CategoryBar
                        groupedChannels={groupedChannels}
                        selectedGroup={selectedGroup}
                        onGroupChange={handleGroupChange}
                        onOpenSelector={() => setIsGroupSelectorOpen(true)}
                        disabled={isSwitchingSource}
                        disabledMessage='切换直播源中...'
                      />
                    )}

                    {/* 频道列表 */}
                    <div
                      ref={channelListRef}
                      className='flex-1 overflow-y-auto space-y-2 pb-4'
                    >
                      {displayChannels.length > 0 ? (
                        displayChannels.map((channel) => {
                          const isActive = channel.id === currentChannel?.id;
                          const isSearchResult = hasChannelSearch;
                          const healthInfo = channelHealthMap[channel.id];
                          const streamType =
                            healthInfo?.type || detectTypeFromUrl(channel.url);
                          const healthStatus = healthInfo?.status || 'unknown';
                          const healthLabel =
                            healthStatus === 'healthy'
                              ? '可用'
                              : healthStatus === 'slow'
                                ? '较慢'
                                : healthStatus === 'unreachable'
                                  ? '异常'
                                  : healthStatus === 'checking'
                                    ? '检测中'
                                    : '未检测';
                          const latencyText =
                            typeof healthInfo?.latencyMs === 'number'
                              ? `${healthInfo.latencyMs}ms`
                              : '';

                          return (
                            <button
                              key={channel.id}
                              data-channel-id={channel.id}
                              onClick={() => {
                                handleChannelChange(channel);
                                if (
                                  isSearchResult &&
                                  channel.group !== selectedGroup
                                ) {
                                  setTimeout(() => {
                                    handleGroupChange(channel.group, {
                                      preserveSearch: true,
                                    });
                                  }, 100);
                                }
                              }}
                              disabled={isSwitchingSource}
                              className={`w-full p-3 rounded-lg text-left transition-all duration-200 ${
                                isSwitchingSource
                                  ? 'opacity-50 cursor-not-allowed'
                                  : isActive
                                    ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700'
                                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                              }`}
                            >
                              <div className='flex items-center gap-3'>
                                <div className='w-10 h-10 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center shrink-0 overflow-hidden'>
                                  {channel.logo ? (
                                    <img
                                      src={`/api/proxy/logo?url=${encodeURIComponent(
                                        channel.logo,
                                      )}&source=${currentSource?.key || ''}`}
                                      alt={channel.name}
                                      className='w-full h-full rounded object-contain'
                                      loading='lazy'
                                      decoding='async'
                                    />
                                  ) : (
                                    <Tv className='w-5 h-5 text-gray-500' />
                                  )}
                                </div>
                                <div className='flex-1 min-w-0'>
                                  <div className='flex items-center gap-2'>
                                    <div
                                      className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'
                                      title={channel.name}
                                    >
                                      {channel.name}
                                    </div>
                                    {isSearchResult && (
                                      <span className='shrink-0 px-2 py-0.5 text-xs rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'>
                                        {channel.group}
                                      </span>
                                    )}
                                  </div>
                                  <div className='mt-1 flex items-center gap-1.5 flex-wrap'>
                                    {!isSearchResult && (
                                      <span
                                        className='text-xs text-gray-500 dark:text-gray-400'
                                        title={channel.group}
                                      >
                                        {channel.group}
                                      </span>
                                    )}
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-full border ${getTypeBadgeStyle(
                                        streamType,
                                      )}`}
                                    >
                                      {streamType.toUpperCase()}
                                    </span>
                                    <span
                                      className={`shrink-0 px-1.5 py-0.5 text-[10px] rounded-full border ${getHealthBadgeStyle(
                                        healthStatus,
                                      )}`}
                                      title={healthInfo?.message || healthLabel}
                                    >
                                      {healthLabel}
                                      {latencyText ? ` ${latencyText}` : ''}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            <Tv className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>
                            {hasChannelSearch
                              ? '未找到匹配的频道'
                              : '暂无可用频道'}
                          </p>
                          <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                            {hasChannelSearch
                              ? '请尝试其他搜索关键词'
                              : '请选择其他直播源或稍后再试'}
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 直播源 Tab 内容 */}
                {activeTab === 'sources' && (
                  <div className='flex flex-col h-full mt-4'>
                    {/* 搜索框 */}
                    <div className='mb-3 shrink-0 px-1'>
                      <div className='relative'>
                        <input
                          type='text'
                          placeholder='搜索直播源...'
                          value={sourceSearchQuery}
                          onChange={(e) => setSourceSearchQuery(e.target.value)}
                          className='w-full px-3 py-2 pr-8 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:focus:ring-green-400 text-sm'
                        />
                        {sourceSearchQuery && (
                          <button
                            onClick={() => setSourceSearchQuery('')}
                            className='absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
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
                                d='M6 18L18 6M6 6l12 12'
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>

                    <div className='flex-1 overflow-y-auto space-y-2 pb-20'>
                      {displaySources.length > 0 ? (
                        displaySources.map((source) => {
                          const isCurrentSource =
                            source.key === currentSource?.key;
                          return (
                            <div
                              key={source.key}
                              onClick={() =>
                                !isCurrentSource && handleSourceChange(source)
                              }
                              className={`flex items-start gap-3 px-2 py-3 rounded-lg transition-all select-none duration-200 relative
                                ${
                                  isCurrentSource
                                    ? 'bg-green-500/10 dark:bg-green-500/20 border-green-500/30 border'
                                    : 'hover:bg-gray-200/50 dark:hover:bg-white/10 hover:scale-[1.02] cursor-pointer'
                                }`.trim()}
                            >
                              <div className='w-12 h-12 bg-gray-200 dark:bg-gray-600 rounded-lg flex items-center justify-center shrink-0'>
                                <Radio className='w-6 h-6 text-gray-500' />
                              </div>

                              <div className='flex-1 min-w-0'>
                                <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                                  {source.name}
                                </div>
                                <div className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                                  {!source.channelNumber ||
                                  source.channelNumber === 0
                                    ? '-'
                                    : `${source.channelNumber} 个频道`}
                                </div>
                              </div>

                              {isCurrentSource && (
                                <div className='absolute top-2 right-2 w-2 h-2 bg-green-500 rounded-full'></div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className='flex flex-col items-center justify-center py-12 text-center'>
                          <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
                            <Radio className='w-8 h-8 text-gray-400 dark:text-gray-600' />
                          </div>
                          <p className='text-gray-500 dark:text-gray-400 font-medium'>
                            {normalizedSourceSearchQuery
                              ? '未找到匹配的直播源'
                              : '暂无可用直播源'}
                          </p>
                          <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                            {normalizedSourceSearchQuery
                              ? '请尝试其他搜索关键词'
                              : '请检查网络连接或联系管理员添加直播源'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 当前频道信息 */}
        {currentChannel && (
          <div className='pt-4'>
            {(() => {
              const healthInfo = channelHealthMap[currentChannel.id];
              const streamType =
                healthInfo?.type || detectTypeFromUrl(currentChannel.url);
              const healthStatus = healthInfo?.status || 'unknown';
              const healthLabel =
                healthStatus === 'healthy'
                  ? '可用'
                  : healthStatus === 'slow'
                    ? '较慢'
                    : healthStatus === 'unreachable'
                      ? '异常'
                      : healthStatus === 'checking'
                        ? '检测中'
                        : '未检测';
              const latencyText =
                typeof healthInfo?.latencyMs === 'number'
                  ? `${healthInfo.latencyMs}ms`
                  : '';

              return (
                <div className='mb-3 flex items-center gap-2 flex-wrap'>
                  <span
                    className={`px-2 py-1 text-xs rounded-full border ${getTypeBadgeStyle(
                      streamType,
                    )}`}
                  >
                    {streamType.toUpperCase()}
                  </span>
                  <span
                    className={`px-2 py-1 text-xs rounded-full border ${getHealthBadgeStyle(
                      healthStatus,
                    )}`}
                    title={healthInfo?.message || healthLabel}
                  >
                    健康状态: {healthLabel}
                    {latencyText ? ` (${latencyText})` : ''}
                  </span>
                </div>
              );
            })()}
            <div className='flex flex-col lg:flex-row gap-4'>
              {/* 频道图标+名称 - 在小屏幕上占100%，大屏幕占20% */}
              <div className='w-full shrink-0'>
                <div className='flex items-center gap-4'>
                  <div className='w-20 h-20 bg-gray-300 dark:bg-gray-700 rounded-lg flex items-center justify-center shrink-0 overflow-hidden'>
                    {currentChannel.logo ? (
                      <img
                        src={`/api/proxy/logo?url=${encodeURIComponent(
                          currentChannel.logo,
                        )}&source=${currentSource?.key || ''}`}
                        alt={currentChannel.name}
                        className='w-full h-full rounded object-contain'
                        loading='lazy'
                        decoding='async'
                      />
                    ) : (
                      <Tv className='w-10 h-10 text-gray-500' />
                    )}
                  </div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-3'>
                      <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 truncate'>
                        {currentChannel.name}
                      </h3>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavorite();
                        }}
                        className='shrink-0 hover:opacity-80 transition-opacity'
                        title={favorited ? '取消收藏' : '收藏'}
                      >
                        <FavoriteIcon filled={favorited} />
                      </button>
                    </div>
                    <p className='text-sm text-gray-500 dark:text-gray-400 truncate'>
                      {currentSource?.name} {' > '} {currentChannel.group}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* EPG节目单 */}
            <EpgScrollableRow
              programs={epgData?.programs || []}
              currentTime={new Date()}
              isLoading={isEpgLoading}
            />
          </div>
        )}

        {/* 分类选择弹窗 */}
        {isGroupSelectorOpen && (
          <div
            className='fixed inset-0 z-1000 flex items-center justify-center bg-black/65'
            onClick={() => setIsGroupSelectorOpen(false)}
          >
            <div
              className='bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[85vh] flex flex-col'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700'>
                <div>
                  <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    分类管理面板
                  </h3>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                    支持置顶、最近访问与排序管理
                  </p>
                </div>
                <button
                  onClick={() => setIsGroupSelectorOpen(false)}
                  className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                >
                  <svg
                    className='w-6 h-6'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth='2'
                      d='M6 18L18 6M6 6l12 12'
                    />
                  </svg>
                </button>
              </div>

              <div className='grid grid-cols-1 md:grid-cols-3 gap-3 px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40'>
                <div className='rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 p-3'>
                  <div className='flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                    <LayoutGrid className='w-3.5 h-3.5' />
                    分类总数
                  </div>
                  <div className='text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1'>
                    {groups.length}
                  </div>
                </div>
                <div className='rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 p-3'>
                  <div className='flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                    <Tv className='w-3.5 h-3.5' />
                    频道总数
                  </div>
                  <div className='text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1'>
                    {totalChannelCount}
                  </div>
                </div>
                <div className='rounded-xl border border-gray-200 dark:border-gray-700 bg-white/80 dark:bg-gray-900/60 p-3'>
                  <div className='flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400'>
                    <Radio className='w-3.5 h-3.5' />
                    当前分类频道
                  </div>
                  <div className='text-xl font-semibold text-gray-900 dark:text-gray-100 mt-1'>
                    {currentGroupChannelCount}
                  </div>
                </div>
              </div>

              <div className='px-6 py-3 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row gap-3'>
                <div className='relative flex-1'>
                  <input
                    type='text'
                    placeholder='搜索分类...'
                    value={groupSearchQuery}
                    onChange={(e) => setGroupSearchQuery(e.target.value)}
                    className='w-full px-4 py-2 pr-10 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-green-500 dark:focus:ring-green-400'
                  />
                  {groupSearchQuery && (
                    <button
                      onClick={() => setGroupSearchQuery('')}
                      className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
                    >
                      <svg
                        className='w-5 h-5'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M6 18L18 6M6 6l12 12'
                        />
                      </svg>
                    </button>
                  )}
                </div>

                <div className='flex items-center gap-2'>
                  <button
                    onClick={() => setGroupSortMode('default')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      groupSortMode === 'default'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title='按默认顺序'
                  >
                    默认
                  </button>
                  <button
                    onClick={() => setGroupSortMode('count')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                      groupSortMode === 'count'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title='按频道数排序'
                  >
                    <ArrowDownWideNarrow className='w-3.5 h-3.5' />
                    频道数
                  </button>
                  <button
                    onClick={() => setGroupSortMode('name')}
                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 ${
                      groupSortMode === 'name'
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
                    }`}
                    title='按名称排序'
                  >
                    <ArrowDownAZ className='w-3.5 h-3.5' />
                    名称
                  </button>
                </div>
              </div>

              <div className='flex-1 overflow-y-auto px-6 py-4 space-y-4'>
                {searchedGroupSummaries.length > 0 ? (
                  <>
                    {!normalizedGroupSearchQuery &&
                      pinnedGroupSummaries.length > 0 && (
                        <section>
                          <div className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                            <Pin className='w-4 h-4 text-green-600 dark:text-green-400' />
                            置顶分类
                          </div>
                          <div className='space-y-2'>
                            {pinnedGroupSummaries.map(renderGroupRow)}
                          </div>
                        </section>
                      )}

                    {!normalizedGroupSearchQuery &&
                      recentGroupSummaries.length > 0 && (
                        <section>
                          <div className='flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                            <Clock3 className='w-4 h-4 text-blue-600 dark:text-blue-400' />
                            最近访问
                          </div>
                          <div className='space-y-2'>
                            {recentGroupSummaries.map(renderGroupRow)}
                          </div>
                        </section>
                      )}

                    <section>
                      <div className='flex items-center justify-between gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                        <div className='flex items-center gap-2'>
                          <LayoutGrid className='w-4 h-4 text-gray-500 dark:text-gray-400' />
                          {normalizedGroupSearchQuery ? '搜索结果' : '全部分类'}
                        </div>
                        {normalizedGroupSearchQuery && (
                          <span className='text-xs text-gray-500 dark:text-gray-400'>
                            {searchedGroupSummaries.length} 项
                          </span>
                        )}
                      </div>
                      <div className='space-y-2'>
                        {(normalizedGroupSearchQuery
                          ? searchedGroupSummaries
                          : panelGroupSummaries
                        ).map(renderGroupRow)}
                      </div>
                    </section>
                  </>
                ) : (
                  <div className='flex flex-col items-center justify-center py-12 text-center'>
                    <div className='w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4'>
                      <LayoutGrid className='w-8 h-8 text-gray-400 dark:text-gray-500' />
                    </div>
                    <p className='text-gray-500 dark:text-gray-400 font-medium'>
                      未找到匹配的分类
                    </p>
                    <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
                      请尝试其他搜索关键词
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}

// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-6 w-6'
        viewBox='0 0 24 24'
        xmlns='http://www.w3.org/2000/svg'
      >
        <path
          d='M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z'
          fill='#ef4444' /* Tailwind red-500 */
          stroke='#ef4444'
          strokeWidth='2'
          strokeLinecap='round'
          strokeLinejoin='round'
        />
      </svg>
    );
  }
  return (
    <Heart className='h-6 w-6 stroke-1 text-gray-600 dark:text-gray-300' />
  );
};

export default function LivePage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LivePageClient />
    </Suspense>
  );
}
