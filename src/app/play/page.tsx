/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

// NOTE: 这些重型库通过页面级代码分割自动懒加载（play 页面独立 chunk）
import Artplayer from 'artplayer';
import artplayerPluginDanmuku from 'artplayer-plugin-danmuku';
import Hls from 'hls.js';
import { Download, Heart } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { generateCacheKey, globalCache } from '@/lib/unified-cache';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';
import { isIOSPlatform, useCast } from '@/hooks/useCast';
import { type DanmuItem, useDanmu } from '@/hooks/useDanmu';
import { useDoubanInfo } from '@/hooks/useDoubanInfo';

import type {
  DanmuManualMatchModalProps,
  DanmuManualSelection,
} from '@/components/DanmuManualMatchModal';
import EpisodeSelector from '@/components/EpisodeSelector';
import ExternalImage from '@/components/ExternalImage';
import { MovieMetaInfo } from '@/components/MovieMetaInfo';
import { MovieRecommends } from '@/components/MovieRecommends';
import { MovieReviews } from '@/components/MovieReviews';
import PageLayout from '@/components/PageLayout';
import type { SkipConfigPanelProps } from '@/components/SkipConfigPanel';
import Toast from '@/components/Toast';

import { useDownloadManager } from '@/contexts/DownloadManagerContext';

const DanmuManualMatchModal = dynamic<DanmuManualMatchModalProps>(
  () =>
    import('../../components/DanmuManualMatchModal').then((mod) => mod.default),
  { ssr: false },
);
const SkipConfigPanel = dynamic<SkipConfigPanelProps>(
  () => import('../../components/SkipConfigPanel').then((mod) => mod.default),
  { ssr: false },
);

// 扩展 HTMLVideoElement 类型以支持 hls 属性
declare global {
  interface HTMLVideoElement {
    hls?: any;
  }
}

// Wake Lock API 类型声明
interface WakeLockSentinel {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
  removeEventListener(type: 'release', listener: () => void): void;
}

// 弹幕播放器偏好设置持久化
const DANMUKU_SETTINGS_KEY = 'decotv_danmuku_settings';
type DanmukuMode = 0 | 1 | 2;
type DanmukuMarginValue = number | `${number}%`;

interface DanmukuSettings {
  speed: number;
  opacity: number;
  fontSize: number;
  margin: [DanmukuMarginValue, DanmukuMarginValue];
  modes: DanmukuMode[];
  antiOverlap: boolean;
  visible: boolean;
}

const DEFAULT_DANMUKU_SETTINGS: DanmukuSettings = {
  speed: 5,
  opacity: 1,
  fontSize: 25,
  margin: [10, '25%'],
  modes: [0, 1, 2],
  antiOverlap: true,
  visible: true,
};

function sanitizeDanmukuMode(value: unknown): DanmukuMode[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_DANMUKU_SETTINGS.modes];
  }

  const dedup = new Set<DanmukuMode>();
  for (const item of value) {
    if (item === 0 || item === 1 || item === 2) {
      dedup.add(item);
    }
  }

  return dedup.size > 0
    ? Array.from(dedup)
    : [...DEFAULT_DANMUKU_SETTINGS.modes];
}

function sanitizeDanmukuMarginValue(
  value: unknown,
  fallback: DanmukuMarginValue,
): DanmukuMarginValue {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^-?\d+(\.\d+)?%$/.test(trimmed)) {
      return trimmed as `${number}%`;
    }
  }

  return fallback;
}

function sanitizeDanmukuSettings(raw: unknown): DanmukuSettings {
  const payload =
    raw && typeof raw === 'object' ? (raw as Partial<DanmukuSettings>) : {};

  const marginTop = sanitizeDanmukuMarginValue(
    payload.margin?.[0],
    DEFAULT_DANMUKU_SETTINGS.margin[0],
  );
  const marginBottom = sanitizeDanmukuMarginValue(
    payload.margin?.[1],
    DEFAULT_DANMUKU_SETTINGS.margin[1],
  );

  return {
    speed:
      typeof payload.speed === 'number' && Number.isFinite(payload.speed)
        ? payload.speed
        : DEFAULT_DANMUKU_SETTINGS.speed,
    opacity:
      typeof payload.opacity === 'number' && Number.isFinite(payload.opacity)
        ? payload.opacity
        : DEFAULT_DANMUKU_SETTINGS.opacity,
    fontSize:
      typeof payload.fontSize === 'number' && Number.isFinite(payload.fontSize)
        ? payload.fontSize
        : DEFAULT_DANMUKU_SETTINGS.fontSize,
    margin: [marginTop, marginBottom],
    modes: sanitizeDanmukuMode(payload.modes),
    antiOverlap:
      typeof payload.antiOverlap === 'boolean'
        ? payload.antiOverlap
        : DEFAULT_DANMUKU_SETTINGS.antiOverlap,
    visible:
      typeof payload.visible === 'boolean'
        ? payload.visible
        : DEFAULT_DANMUKU_SETTINGS.visible,
  };
}

/**
 * 从 localStorage 读取弹幕播放器偏好
 * @returns 合并默认值后的弹幕设置
 */
function loadDanmukuSettings(): DanmukuSettings {
  try {
    const saved = localStorage.getItem(DANMUKU_SETTINGS_KEY);
    if (saved) {
      return sanitizeDanmukuSettings(JSON.parse(saved));
    }
  } catch {
    // NOTE: SSR 或 localStorage 不可用时静默回退
  }
  return { ...DEFAULT_DANMUKU_SETTINGS };
}

/**
 * 将弹幕播放器偏好写入 localStorage
 * @param settings 要持久化的设置（可部分更新）
 */
function saveDanmukuSettings(settings: Partial<DanmukuSettings>) {
  try {
    const current = loadDanmukuSettings();
    localStorage.setItem(
      DANMUKU_SETTINGS_KEY,
      JSON.stringify(sanitizeDanmukuSettings({ ...current, ...settings })),
    );
  } catch {
    // NOTE: localStorage 不可用时静默忽略
  }
}

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { enqueueDownload, openManager } = useDownloadManager();

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'preferring' | 'fetching' | 'ready'
  >('searching');
  const [loadingMessage, setLoadingMessage] = useState('正在搜索播放源...');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<{
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [
    skipConfig,
    skipConfig.enable,
    skipConfig.intro_time,
    skipConfig.outro_time,
  ]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });
  const blockAdEnabledRef = useRef(blockAdEnabled);
  useEffect(() => {
    blockAdEnabledRef.current = blockAdEnabled;
  }, [blockAdEnabled]);

  // 获取 HLS 缓冲配置（根据用户设置的模式）
  const getHlsBufferConfig = () => {
    const mode =
      typeof window !== 'undefined'
        ? localStorage.getItem('playerBufferMode') || 'standard'
        : 'standard';

    switch (mode) {
      case 'enhanced':
        // 增强模式：1.5 倍缓冲
        return {
          maxBufferLength: 45, // 45s（默认30s × 1.5）
          backBufferLength: 45,
          maxBufferSize: 90 * 1000 * 1000, // 90MB
        };
      case 'max':
        // 强力模式：3 倍缓冲
        return {
          maxBufferLength: 90, // 90s（默认30s × 3）
          backBufferLength: 60,
          maxBufferSize: 180 * 1000 * 1000, // 180MB
        };
      case 'standard':
      default:
        // 默认模式
        return {
          maxBufferLength: 30,
          backBufferLength: 30,
          maxBufferSize: 60 * 1000 * 1000, // 60MB
        };
    }
  };

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || '',
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 是否需要优选
  const [needPrefer, setNeedPrefer] = useState(
    searchParams.get('prefer') === 'true',
  );
  const needPreferRef = useRef(needPrefer);
  useEffect(() => {
    needPreferRef.current = needPrefer;
  }, [needPrefer]);
  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址
  const [videoUrl, setVideoUrl] = useState('');

  // 总集数
  const totalEpisodes = detail?.episodes?.length || 0;

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);
  // 上次使用的音量，默认 0.7
  const lastVolumeRef = useRef<number>(0.7);
  // 上次使用的播放速率，默认 1.0
  const lastPlaybackRateRef = useRef<number>(1.0);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null,
  );

  // 优选和测速开关
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

  // 保存优选时的测速结果，避免EpisodeSelector重复测速
  const [precomputedVideoInfo, setPrecomputedVideoInfo] = useState<
    Map<string, { quality: string; loadSpeed: string; pingTime: number }>
  >(new Map());

  // 折叠状态（仅在 lg 及以上屏幕有效）
  const [isEpisodeSelectorCollapsed, setIsEpisodeSelectorCollapsed] =
    useState(false);

  // 跳过片头片尾设置面板状态
  const [isSkipConfigPanelOpen, setIsSkipConfigPanelOpen] = useState(false);

  // 弹幕刷新状态
  const isDanmuReloadingRef = useRef(false);
  const [isDanmuReloading, setIsDanmuReloading] = useState(false);

  // Toast 通知状态
  const [toast, setToast] = useState<{
    show: boolean;
    message: string;
    type: 'success' | 'error' | 'info';
  }>({
    show: false,
    message: '',
    type: 'info',
  });

  // 显示 Toast 通知
  const showToast = (
    message: string,
    type: 'success' | 'error' | 'info' = 'info',
  ) => {
    setToast({ show: true, message, type });
  };

  // 换源加载状态
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [videoLoadingStage, setVideoLoadingStage] = useState<
    'initing' | 'sourceChanging'
  >('initing');

  // 播放进度保存相关
  const saveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSaveTimeRef = useRef<number>(0);

  const artPlayerRef = useRef<any>(null);
  const artRef = useRef<HTMLDivElement | null>(null);

  // Wake Lock 相关
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const [isDanmuManualModalOpen, setIsDanmuManualModalOpen] = useState(false);
  const [manualDanmuOverrides, setManualDanmuOverrides] = useState<
    Record<string, DanmuManualSelection>
  >({});
  const danmuScopeKey = `${videoDoubanId || videoTitle}_${videoYear || ''}_${currentEpisodeIndex + 1}`;
  const activeManualDanmuOverride = manualDanmuOverrides[danmuScopeKey] || null;

  // 弹幕 Hook
  const {
    danmuList,
    loading: danmuLoading,
    matchInfo,
    loadMeta,
    reload: reloadDanmu,
  } = useDanmu({
    doubanId: videoDoubanId || undefined,
    title: videoTitle,
    year: videoYear,
    episode: currentEpisodeIndex + 1,
    manualOverride: activeManualDanmuOverride,
  });
  const danmuCount = danmuList.length;
  const isDanmuBusy = isDanmuReloading || danmuLoading;
  const isDanmuEmpty = !danmuLoading && danmuCount === 0;
  const isDanmuManualOverridden = !!activeManualDanmuOverride;
  const shownEmptyDanmuHintRef = useRef('');
  const [showDanmuMeta, setShowDanmuMeta] = useState(false);
  const danmuMetaWrapRef = useRef<HTMLDivElement | null>(null);
  const danmuMetaToggleRef = useRef<HTMLButtonElement | null>(null);
  const autoRetryDanmuScopeRef = useRef('');
  const danmuSourceLabel = matchInfo
    ? `${matchInfo.animeTitle} · ${matchInfo.episodeTitle}`
    : activeManualDanmuOverride
      ? `${activeManualDanmuOverride.animeTitle || '手动匹配'} · ${
          activeManualDanmuOverride.episodeTitle ||
          `episodeId:${activeManualDanmuOverride.episodeId}`
        }`
      : '未匹配到来源';
  const danmuMatchLevelLabel = (() => {
    if (!matchInfo?.matchLevel) return null;
    const level = matchInfo.matchLevel.toLowerCase();
    if (level.includes('manual')) {
      return '手动覆盖';
    }
    if (level.includes('exact') || level.includes('perfect')) {
      return '精确匹配';
    }
    if (
      level.includes('fuzzy') ||
      level.includes('fallback') ||
      level.includes('variant') ||
      level.includes('partial')
    ) {
      return '模糊匹配';
    }
    return matchInfo.matchLevel;
  })();
  const danmuLoadedAtText = loadMeta.loadedAt
    ? new Date(loadMeta.loadedAt).toLocaleString('zh-CN', { hour12: false })
    : '尚未加载';
  const danmuLoadSourceText = (() => {
    switch (loadMeta.source) {
      case 'cache':
        return '会话缓存';
      case 'network':
        return '网络请求';
      case 'network-retry':
        return '网络重试';
      case 'empty':
        return '空结果';
      case 'error':
        return '请求失败';
      default:
        return '初始化';
    }
  })();
  const danmuMatchModeText = isDanmuManualOverridden ? '手动覆盖' : '自动匹配';

  // 投屏 Hook
  const {
    isAvailable: castAvailable,
    isConnected: castConnected,
    deviceName: castDeviceName,
    requestSession: castRequestSession,
    loadMedia: castLoadMedia,
    endSession: castEndSession,
  } = useCast();

  // 投屏状态 refs（用于在 ArtPlayer 配置中访问最新值）
  const castAvailableRef = useRef(castAvailable);
  const castConnectedRef = useRef(castConnected);
  const castDeviceNameRef = useRef(castDeviceName);
  useEffect(() => {
    castAvailableRef.current = castAvailable;
    castConnectedRef.current = castConnected;
    castDeviceNameRef.current = castDeviceName;
  }, [castAvailable, castConnected, castDeviceName]);

  // 投屏处理函数
  const handleCastClick = async () => {
    // 检测浏览器是否支持 Cast
    if (!castAvailableRef.current) {
      // 检测是否为 iOS 设备
      if (isIOSPlatform()) {
        // iOS 设备上的所有浏览器都使用 WebKit 引擎，无法支持投屏
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show =
            '📱 iOS 设备不支持 Chromecast 投屏';
        }
        showToast(
          'iOS 设备不支持 Chromecast 投屏，请使用电脑端 Chrome/Edge 浏览器',
          'info',
        );
        return;
      }

      // 检测是否为 Chromium 浏览器
      const isChrome =
        typeof window !== 'undefined' &&
        typeof window.chrome !== 'undefined' &&
        window.chrome !== null;

      if (!isChrome) {
        // 非 Chromium 浏览器
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show =
            '📱 请使用 Chrome 或 Edge 浏览器投屏';
        }
        showToast('投屏功能仅支持电脑端 Chrome/Edge 浏览器', 'info');
      } else {
        // Chromium 浏览器但未检测到设备
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '📺 未发现可用的投屏设备';
        }
        showToast('请确保 Chromecast 设备在同一网络', 'info');
      }
      return;
    }

    if (castConnectedRef.current) {
      // 已连接，断开投屏
      castEndSession();
      if (artPlayerRef.current) {
        artPlayerRef.current.notice.show = '✅ 已断开投屏';
      }
      showToast('已断开投屏', 'success');
    } else {
      // 未连接，请求投屏
      try {
        await castRequestSession();
        // 连接成功后加载当前视频
        if (videoUrl && castConnectedRef.current) {
          await castLoadMedia(videoUrl, videoTitle, videoCover);
          // 暂停本地播放器
          if (artPlayerRef.current) {
            artPlayerRef.current.pause();
            artPlayerRef.current.notice.show = `📺 正在投屏到 ${castDeviceNameRef.current || '设备'}`;
          }
          showToast(
            `正在投屏到 ${castDeviceNameRef.current || '设备'}`,
            'success',
          );
        }
      } catch (err) {
        console.error('[Cast] 投屏失败:', err);
        if (artPlayerRef.current) {
          artPlayerRef.current.notice.show = '❌ 投屏失败，请重试';
        }
        showToast('投屏失败，请重试', 'error');
      }
    }
  };

  const loadDanmuToPlayer = (list: DanmuItem[]) => {
    if (!artPlayerRef.current) return;
    const danmuku = artPlayerRef.current.plugins?.artplayerPluginDanmuku;
    if (!danmuku) return;

    try {
      const payload = list.map((item: DanmuItem) => ({
        text: item.text,
        time: item.time,
        color: item.color || '#FFFFFF',
        mode: item.mode === 1 || item.mode === 2 ? item.mode : 0,
      }));

      danmuku.load(payload);
      console.log('[Danmu] Loaded danmu:', payload.length);
    } catch (err) {
      console.error('[Danmu] Failed to load danmuku data:', err);
    }
  };

  const runReloadDanmu = async (options?: {
    manualOverride?: DanmuManualSelection | null;
    successMessage?: string | ((count: number) => string);
    emptyMessage?: string;
    errorMessage?: string;
  }) => {
    if (isDanmuReloadingRef.current) return;

    isDanmuReloadingRef.current = true;
    setIsDanmuReloading(true);
    try {
      const count = await reloadDanmu({
        manualOverride: options?.manualOverride,
      });
      if (count > 0) {
        const successMessage =
          typeof options?.successMessage === 'function'
            ? options.successMessage(count)
            : options?.successMessage;
        showToast(successMessage || `弹幕已刷新，共 ${count} 条`, 'success');
      } else {
        showToast(options?.emptyMessage || '当前影片暂无弹幕（0 条）', 'info');
      }
    } catch (err) {
      console.error('[Danmu] Reload failed:', err);
      showToast(options?.errorMessage || '刷新弹幕失败', 'error');
    } finally {
      isDanmuReloadingRef.current = false;
      setIsDanmuReloading(false);
    }
  };

  const handleReloadDanmu = async () => {
    await runReloadDanmu();
  };

  const handleApplyManualDanmuSelection = async (
    selection: DanmuManualSelection,
  ) => {
    setManualDanmuOverrides((prev) => ({
      ...prev,
      [danmuScopeKey]: selection,
    }));
    setIsDanmuManualModalOpen(false);

    await runReloadDanmu({
      manualOverride: selection,
      successMessage: (count) =>
        `已手动匹配为 ${selection.animeTitle} · ${selection.episodeTitle}（${count} 条）`,
      emptyMessage: '手动匹配完成，但该集暂无弹幕',
      errorMessage: '手动匹配弹幕失败',
    });
  };

  const handleClearManualDanmuOverride = async () => {
    if (!activeManualDanmuOverride) {
      showToast('当前未启用手动匹配', 'info');
      return;
    }

    setManualDanmuOverrides((prev) => {
      const next = { ...prev };
      delete next[danmuScopeKey];
      return next;
    });

    await runReloadDanmu({
      manualOverride: null,
      successMessage: '已恢复自动匹配并刷新弹幕',
      emptyMessage: '已恢复自动匹配，本集暂无弹幕',
      errorMessage: '恢复自动匹配失败',
    });
  };

  useEffect(() => {
    setShowDanmuMeta(false);
    autoRetryDanmuScopeRef.current = `pending:${danmuScopeKey}`;
  }, [danmuScopeKey]);

  useEffect(() => {
    if (!showDanmuMeta) return;

    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (danmuMetaWrapRef.current?.contains(target)) return;
      if (danmuMetaToggleRef.current?.contains(target)) return;
      setShowDanmuMeta(false);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDanmuMeta(false);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showDanmuMeta]);

  useEffect(() => {
    if (danmuLoading) return;
    if (!videoDoubanId && !videoTitle) return;
    if (danmuCount > 0) return;

    if (autoRetryDanmuScopeRef.current !== `pending:${danmuScopeKey}`) return;

    autoRetryDanmuScopeRef.current = `running:${danmuScopeKey}`;
    const timer = setTimeout(async () => {
      if (isDanmuReloadingRef.current) {
        autoRetryDanmuScopeRef.current = `done:${danmuScopeKey}`;
        return;
      }
      try {
        const count = await reloadDanmu();
        if (count > 0) {
          showToast(`已自动重试并加载 ${count} 条弹幕`, 'success');
        } else if (shownEmptyDanmuHintRef.current !== danmuScopeKey) {
          shownEmptyDanmuHintRef.current = danmuScopeKey;
          showToast('本集暂未加载到弹幕，可点击右上角刷新或手动匹配', 'info');
        }
      } catch {
        // ignore auto retry errors
      } finally {
        autoRetryDanmuScopeRef.current = `done:${danmuScopeKey}`;
      }
    }, 900);

    return () => clearTimeout(timer);
  }, [
    currentEpisodeIndex,
    danmuCount,
    danmuLoading,
    danmuScopeKey,
    reloadDanmu,
  ]);

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[],
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    // 将播放源均分为两批，并发测速各批，避免一次性过多请求
    const batchSize = Math.ceil(sources.length / 2);
    const allResults: Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    } | null> = [];

    for (let start = 0; start < sources.length; start += batchSize) {
      const batchSources = sources.slice(start, start + batchSize);
      const batchResults = await Promise.all(
        batchSources.map(async (source) => {
          try {
            // 检查是否有第一集的播放地址
            if (!source.episodes || source.episodes.length === 0) {
              console.warn(`播放源 ${source.source_name} 没有可用的播放地址`);
              return null;
            }

            const episodeUrl =
              source.episodes.length > 1
                ? source.episodes[1]
                : source.episodes[0];
            const testResult = await getVideoResolutionFromM3u8(episodeUrl);

            return {
              source,
              testResult,
            };
          } catch {
            return null;
          }
        }),
      );
      allResults.push(...batchResults);
    }

    // 等待所有测速完成，包含成功和失败的结果
    // 保存所有测速结果到 precomputedVideoInfo，供 EpisodeSelector 使用（包含错误结果）
    const newVideoInfoMap = new Map<
      string,
      {
        quality: string;
        loadSpeed: string;
        pingTime: number;
        hasError?: boolean;
      }
    >();
    allResults.forEach((result, index) => {
      const source = sources[index];
      const sourceKey = `${source.source}-${source.id}`;

      if (result) {
        // 成功的结果
        newVideoInfoMap.set(sourceKey, result.testResult);
      }
    });

    // 过滤出成功的结果用于优选计算
    const successfulResults = allResults.filter(Boolean) as Array<{
      source: SearchResult;
      testResult: { quality: string; loadSpeed: string; pingTime: number };
    }>;

    setPrecomputedVideoInfo(newVideoInfoMap);

    if (successfulResults.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      return sources[0];
    }

    // 找出所有有效速度的最大值，用于线性映射
    const validSpeeds = successfulResults
      .map((result) => {
        const speedStr = result.testResult.loadSpeed;
        if (speedStr === '未知' || speedStr === '测量中...') return 0;

        const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
        if (!match) return 0;

        const value = parseFloat(match[1]);
        const unit = match[2];
        return unit === 'MB/s' ? value * 1024 : value; // 统一转换为 KB/s
      })
      .filter((speed) => speed > 0);

    const maxSpeed = validSpeeds.length > 0 ? Math.max(...validSpeeds) : 1024; // 默认1MB/s作为基准

    // 找出所有有效延迟的最小值和最大值，用于线性映射
    const validPings = successfulResults
      .map((result) => result.testResult.pingTime)
      .filter((ping) => ping > 0);

    const minPing = validPings.length > 0 ? Math.min(...validPings) : 50;
    const maxPing = validPings.length > 0 ? Math.max(...validPings) : 1000;

    // 计算每个结果的评分
    const resultsWithScore = successfulResults.map((result) => ({
      ...result,
      score: calculateSourceScore(
        result.testResult,
        maxSpeed,
        minPing,
        maxPing,
      ),
    }));

    // 按综合评分排序，选择最佳播放源
    resultsWithScore.sort((a, b) => b.score - a.score);

    console.log('播放源评分排序结果:');
    resultsWithScore.forEach((result, index) => {
      console.log(
        `${index + 1}. ${
          result.source.source_name
        } - 评分: ${result.score.toFixed(2)} (${result.testResult.quality}, ${
          result.testResult.loadSpeed
        }, ${result.testResult.pingTime}ms)`,
      );
    });

    return resultsWithScore[0].source;
  };

  // 计算播放源综合评分
  const calculateSourceScore = (
    testResult: {
      quality: string;
      loadSpeed: string;
      pingTime: number;
    },
    maxSpeed: number,
    minPing: number,
    maxPing: number,
  ): number => {
    let score = 0;

    // 分辨率评分 (40% 权重)
    const qualityScore = (() => {
      switch (testResult.quality) {
        case '4K':
          return 100;
        case '2K':
          return 85;
        case '1080p':
          return 75;
        case '720p':
          return 60;
        case '480p':
          return 40;
        case 'SD':
          return 20;
        default:
          return 0;
      }
    })();
    score += qualityScore * 0.4;

    // 下载速度评分 (40% 权重) - 基于最大速度线性映射
    const speedScore = (() => {
      const speedStr = testResult.loadSpeed;
      if (speedStr === '未知' || speedStr === '测量中...') return 30;

      // 解析速度值
      const match = speedStr.match(/^([\d.]+)\s*(KB\/s|MB\/s)$/);
      if (!match) return 30;

      const value = parseFloat(match[1]);
      const unit = match[2];
      const speedKBps = unit === 'MB/s' ? value * 1024 : value;

      // 基于最大速度线性映射，最高100分
      const speedRatio = speedKBps / maxSpeed;
      return Math.min(100, Math.max(0, speedRatio * 100));
    })();
    score += speedScore * 0.4;

    // 网络延迟评分 (20% 权重) - 基于延迟范围线性映射
    const pingScore = (() => {
      const ping = testResult.pingTime;
      if (ping <= 0) return 0; // 无效延迟给默认分

      // 如果所有延迟都相同，给满分
      if (maxPing === minPing) return 100;

      // 线性映射：最低延迟=100分，最高延迟=0分
      const pingRatio = (maxPing - ping) / (maxPing - minPing);
      return Math.min(100, Math.max(0, pingRatio * 100));
    })();
    score += pingScore * 0.2;

    return Math.round(score * 100) / 100; // 保留两位小数
  };

  // 更新视频地址
  const updateVideoUrl = (
    detailData: SearchResult | null,
    episodeIndex: number,
  ) => {
    if (
      !detailData ||
      !detailData.episodes ||
      episodeIndex >= detailData.episodes.length
    ) {
      setVideoUrl('');
      return;
    }
    const newUrl = detailData?.episodes[episodeIndex] || '';
    if (newUrl !== videoUrl) {
      setVideoUrl(newUrl);
    }
  };

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

  // Wake Lock 相关函数
  const requestWakeLock = async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await (navigator as any).wakeLock.request(
          'screen',
        );
        console.log('Wake Lock 已启用');
      }
    } catch (err) {
      console.warn('Wake Lock 请求失败:', err);
    }
  };

  const releaseWakeLock = async () => {
    try {
      if (wakeLockRef.current) {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        console.log('Wake Lock 已释放');
      }
    } catch (err) {
      console.warn('Wake Lock 释放失败:', err);
    }
  };

  // 清理播放器资源的统一函数
  const cleanupPlayer = () => {
    if (artPlayerRef.current) {
      try {
        // 销毁 HLS 实例
        if (artPlayerRef.current.video && artPlayerRef.current.video.hls) {
          artPlayerRef.current.video.hls.destroy();
        }

        // 销毁 ArtPlayer 实例
        artPlayerRef.current.destroy();
        artPlayerRef.current = null;

        console.log('播放器资源已清理');
      } catch (err) {
        console.warn('清理播放器资源时出错:', err);
        artPlayerRef.current = null;
      }
    }
  };

  // 去广告相关函数
  function filterAdsFromM3U8(m3u8Content: string): string {
    if (!m3u8Content) return '';

    // 按行分割M3U8内容
    const lines = m3u8Content.split('\n');
    const filteredLines = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // 只过滤#EXT-X-DISCONTINUITY标识
      if (!line.includes('#EXT-X-DISCONTINUITY')) {
        filteredLines.push(line);
      }
    }

    return filteredLines.join('\n');
  }

  // 跳过片头片尾配置相关函数
  const handleSkipConfigChange = async (newConfig: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;

    try {
      setSkipConfig(newConfig);

      // 保存到 localStorage 用于持久化
      const storageKey = `skip_config_${currentSourceRef.current}_${currentIdRef.current}`;
      localStorage.setItem(storageKey, JSON.stringify(newConfig));

      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
        localStorage.removeItem(storageKey);
        showToast('已清除跳过设置', 'info');
        artPlayerRef.current.setting.update({
          name: '跳过片头片尾',
          html: '跳过片头片尾',
          switch: skipConfigRef.current.enable,
          onSwitch: function (item: any) {
            const newConfig = {
              ...skipConfigRef.current,
              enable: !item.switch,
            };
            handleSkipConfigChange(newConfig);
            return !item.switch;
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片头',
          html: '设置片头',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
          tooltip:
            skipConfigRef.current.intro_time === 0
              ? '设置片头时间'
              : `${formatTime(skipConfigRef.current.intro_time)}`,
          onClick: function () {
            const currentTime = artPlayerRef.current?.currentTime || 0;
            if (currentTime > 0) {
              const newConfig = {
                ...skipConfigRef.current,
                intro_time: currentTime,
              };
              handleSkipConfigChange(newConfig);
              return `${formatTime(currentTime)}`;
            }
          },
        });
        artPlayerRef.current.setting.update({
          name: '设置片尾',
          html: '设置片尾',
          icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
          tooltip:
            skipConfigRef.current.outro_time >= 0
              ? '设置片尾时间'
              : `-${formatTime(-skipConfigRef.current.outro_time)}`,
          onClick: function () {
            const outroTime =
              -(
                artPlayerRef.current?.duration -
                artPlayerRef.current?.currentTime
              ) || 0;
            if (outroTime < 0) {
              const newConfig = {
                ...skipConfigRef.current,
                outro_time: outroTime,
              };
              handleSkipConfigChange(newConfig);
              return `-${formatTime(-outroTime)}`;
            }
          },
        });
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig,
        );

        // 显示 Toast 通知
        const introText =
          newConfig.intro_time > 0
            ? `片头: ${formatTime(newConfig.intro_time)}`
            : '';
        const outroText =
          newConfig.outro_time < 0
            ? `片尾: 提前 ${formatTime(Math.abs(newConfig.outro_time))}`
            : '';
        const separator = introText && outroText ? '\n' : '';
        const message = newConfig.enable
          ? `跳过设置已保存\n${introText}${separator}${outroText}`
          : '跳过功能已关闭';

        showToast(message, 'success');
      }
      console.log('跳过片头片尾配置已保存:', newConfig);
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
      showToast('保存失败，请重试', 'error');
    }
  };

  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.round(seconds % 60);

    if (hours === 0) {
      // 不到一小时，格式为 00:00
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      // 超过一小时，格式为 00:00:00
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  class CustomHlsJsLoader extends Hls.DefaultConfig.loader {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = function (context: any, config: any, callbacks: any) {
        // 拦截manifest和level请求
        if (
          (context as any).type === 'manifest' ||
          (context as any).type === 'level'
        ) {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = function (
            response: any,
            stats: any,
            context: any,
          ) {
            // 如果是m3u8文件，处理内容以移除广告分段
            if (response.data && typeof response.data === 'string') {
              // 过滤掉广告段 - 实现更精确的广告过滤逻辑
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, context, null);
          };
        }
        // 执行原始load方法
        load(context, config, callbacks);
      };
    }
  }

  // 当集数索引变化时自动更新视频地址
  useEffect(() => {
    updateVideoUrl(detail, currentEpisodeIndex);
  }, [detail, currentEpisodeIndex]);

  // 进入页面时直接获取全部源信息
  useEffect(() => {
    const fetchSourceDetail = async (
      source: string,
      id: string,
    ): Promise<SearchResult[]> => {
      try {
        const detailResponse = await fetch(
          `/api/detail?source=${source}&id=${id}`,
        );
        if (!detailResponse.ok) {
          throw new Error('获取视频详情失败');
        }
        const detailData = (await detailResponse.json()) as SearchResult;
        setAvailableSources([detailData]);
        return [detailData];
      } catch (err) {
        console.error('获取视频详情失败:', err);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };
    const fetchSourcesData = async (query: string): Promise<SearchResult[]> => {
      // 根据搜索词获取全部源信息
      try {
        const response = await fetch(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
        );
        if (!response.ok) {
          throw new Error('搜索失败');
        }
        const data = await response.json();

        // 处理搜索结果，根据规则过滤
        const results = data.results.filter(
          (result: SearchResult) =>
            result.title.replaceAll(' ', '').toLowerCase() ===
              videoTitleRef.current.replaceAll(' ', '').toLowerCase() &&
            (videoYearRef.current
              ? result.year.toLowerCase() === videoYearRef.current.toLowerCase()
              : true) &&
            (searchType
              ? (searchType === 'tv' && result.episodes.length > 1) ||
                (searchType === 'movie' && result.episodes.length === 1)
              : true),
        );
        setAvailableSources(results);
        return results;
      } catch (err) {
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      } finally {
        setSourceSearchLoading(false);
      }
    };

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError('缺少必要参数');
        setLoading(false);
        return;
      }
      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');
      setLoadingMessage(
        currentSource && currentId
          ? '🎬 正在获取视频详情...'
          : '🔍 正在搜索播放源...',
      );

      let sourcesInfo = await fetchSourcesData(searchTitle || videoTitle);
      if (
        currentSource &&
        currentId &&
        !sourcesInfo.some(
          (source) =>
            source.source === currentSource && source.id === currentId,
        )
      ) {
        sourcesInfo = await fetchSourceDetail(currentSource, currentId);
      }
      if (sourcesInfo.length === 0) {
        setError('未找到匹配结果');
        setLoading(false);
        return;
      }

      let detailData: SearchResult = sourcesInfo[0];
      // 指定源和id且无需优选
      if (currentSource && currentId && !needPreferRef.current) {
        const target = sourcesInfo.find(
          (source) =>
            source.source === currentSource && source.id === currentId,
        );
        if (target) {
          detailData = target;
        } else {
          setError('未找到匹配结果');
          setLoading(false);
          return;
        }
      }

      // 未指定源和 id 或需要优选，且开启优选开关
      if (
        (!currentSource || !currentId || needPreferRef.current) &&
        optimizationEnabled
      ) {
        setLoadingStage('preferring');
        setLoadingMessage('⚡ 正在优选最佳播放源...');

        detailData = await preferBestSource(sourcesInfo);
      }

      console.log(detailData.source, detailData.id);

      setNeedPrefer(false);
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);
      if (currentEpisodeIndex >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范URL参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setLoadingMessage('✨ 准备就绪，即将开始播放...');

      // 短暂延迟让用户看到完成状态
      setTimeout(() => {
        setLoading(false);
      }, 1000);
    };

    initAll();
  }, []);

  // 播放记录处理
  useEffect(() => {
    // 仅在初次挂载时检查播放记录
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;

      try {
        const allRecords = await getAllPlayRecords();
        const key = generateStorageKey(currentSource, currentId);
        const record = allRecords[key];

        if (record) {
          const targetIndex = record.index - 1;
          const targetTime = record.play_time;

          // 更新当前选集索引
          if (targetIndex !== currentEpisodeIndex) {
            setCurrentEpisodeIndex(targetIndex);
          }

          // 保存待恢复的播放进度，待播放器就绪后跳转
          resumeTimeRef.current = targetTime;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };

    initFromHistory();
  }, []);

  // 跳过片头片尾配置处理
  useEffect(() => {
    // 仅在初次挂载时检查跳过片头片尾配置
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;

      try {
        // 首先从 localStorage 读取
        const storageKey = `skip_config_${currentSource}_${currentId}`;
        const localConfig = localStorage.getItem(storageKey);

        if (localConfig) {
          const config = JSON.parse(localConfig);
          setSkipConfig(config);
          console.log('从 localStorage 恢复跳过配置:', config);
        } else {
          // 如果 localStorage 没有，再尝试从数据库读取
          const config = await getSkipConfig(currentSource, currentId);
          if (config) {
            setSkipConfig(config);
            // 同步到 localStorage
            localStorage.setItem(storageKey, JSON.stringify(config));
          }
        }
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };

    initSkipConfig();
  }, [currentSource, currentId]);

  // 处理换源
  const handleSourceChange = async (
    newSource: string,
    newId: string,
    newTitle: string,
  ) => {
    try {
      // 显示换源加载状态
      setVideoLoadingStage('sourceChanging');
      setIsVideoLoading(true);

      // 记录当前播放进度（仅在同一集数切换时恢复）
      const currentPlayTime = artPlayerRef.current?.currentTime || 0;
      console.log('换源前当前播放时间:', currentPlayTime);

      // 清除前一个历史记录
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current,
          );
          console.log('已清除前一个播放记录');
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
      }

      // 清除并设置下一个跳过片头片尾配置
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current,
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      const newDetail = availableSources.find(
        (source) => source.source === newSource && source.id === newId,
      );
      if (!newDetail) {
        setError('未找到匹配结果');
        return;
      }

      // 尝试跳转到当前正在播放的集数
      let targetIndex = currentEpisodeIndex;

      // 如果当前集数超出新源的范围，则跳转到第一集
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 如果仍然是同一集数且播放进度有效，则在播放器就绪后恢复到原始进度
      if (targetIndex !== currentEpisodeIndex) {
        resumeTimeRef.current = 0;
      } else if (
        (!resumeTimeRef.current || resumeTimeRef.current === 0) &&
        currentPlayTime > 1
      ) {
        resumeTimeRef.current = currentPlayTime;
      }

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setVideoTitle(newDetail.title || newTitle);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      // 隐藏换源加载状态
      setIsVideoLoading(false);
      setError(err instanceof Error ? err.message : '换源失败');
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyboardShortcuts);
    return () => {
      document.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 集数切换
  // ---------------------------------------------------------------------------
  // 处理集数切换
  const handleEpisodeChange = (episodeNumber: number) => {
    if (episodeNumber >= 0 && episodeNumber < totalEpisodes) {
      // 在更换集数前保存当前播放进度
      if (artPlayerRef.current && artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(episodeNumber);
    }
  };

  const handlePreviousEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx > 0) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx - 1);
    }
  };

  const handleNextEpisode = () => {
    const d = detailRef.current;
    const idx = currentEpisodeIndexRef.current;
    if (d && d.episodes && idx < d.episodes.length - 1) {
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        saveCurrentPlayProgress();
      }
      setCurrentEpisodeIndex(idx + 1);
    }
  };

  // ---------------------------------------------------------------------------
  // 键盘快捷键
  // ---------------------------------------------------------------------------
  // 处理全局快捷键
  const handleKeyboardShortcuts = (e: KeyboardEvent) => {
    // 忽略输入框中的按键事件
    if (
      (e.target as HTMLElement).tagName === 'INPUT' ||
      (e.target as HTMLElement).tagName === 'TEXTAREA'
    )
      return;

    // Alt + 左箭头 = 上一集
    if (e.altKey && e.key === 'ArrowLeft') {
      if (detailRef.current && currentEpisodeIndexRef.current > 0) {
        handlePreviousEpisode();
        e.preventDefault();
      }
    }

    // Alt + 右箭头 = 下一集
    if (e.altKey && e.key === 'ArrowRight') {
      const d = detailRef.current;
      const idx = currentEpisodeIndexRef.current;
      if (d && idx < d.episodes.length - 1) {
        handleNextEpisode();
        e.preventDefault();
      }
    }

    // 左箭头 = 快退
    if (!e.altKey && e.key === 'ArrowLeft') {
      if (artPlayerRef.current && artPlayerRef.current.currentTime > 5) {
        artPlayerRef.current.currentTime -= 10;
        e.preventDefault();
      }
    }

    // 右箭头 = 快进
    if (!e.altKey && e.key === 'ArrowRight') {
      if (
        artPlayerRef.current &&
        artPlayerRef.current.currentTime < artPlayerRef.current.duration - 5
      ) {
        artPlayerRef.current.currentTime += 10;
        e.preventDefault();
      }
    }

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

  // ---------------------------------------------------------------------------
  // 播放记录相关
  // ---------------------------------------------------------------------------
  // 保存播放进度
  const saveCurrentPlayProgress = async () => {
    if (
      !artPlayerRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const player = artPlayerRef.current;
    const currentTime = player.currentTime || 0;
    const duration = player.duration || 0;

    // 如果播放时间太短（少于5秒）或者视频时长无效，不保存
    if (currentTime < 1 || !duration) {
      return;
    }

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });

      lastSaveTimeRef.current = Date.now();
      console.log('播放进度已保存:', {
        title: videoTitleRef.current,
        episode: currentEpisodeIndexRef.current + 1,
        year: detailRef.current?.year,
        progress: `${Math.floor(currentTime)}/${Math.floor(duration)}`,
      });
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  useEffect(() => {
    // 页面即将卸载时保存播放进度和清理资源
    const handleBeforeUnload = () => {
      saveCurrentPlayProgress();
      releaseWakeLock();
      cleanupPlayer();
    };

    // 页面可见性变化时保存播放进度和释放 Wake Lock
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveCurrentPlayProgress();
        releaseWakeLock();
      } else if (document.visibilityState === 'visible') {
        // 页面重新可见时，如果正在播放则重新请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      }
    };

    // 添加事件监听器
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      // 清理事件监听器
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [currentEpisodeIndex, detail, artPlayerRef.current]);

  // 清理定时器
  useEffect(() => {
    return () => {
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 收藏相关
  // ---------------------------------------------------------------------------
  // 每当 source 或 id 变化时检查收藏状态
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        const fav = await isFavorited(currentSource, currentId);
        setFavorited(fav);
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  // 监听收藏数据更新事件
  useEffect(() => {
    if (!currentSource || !currentId) return;

    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        const key = generateStorageKey(currentSource, currentId);
        const isFav = !!favorites[key];
        setFavorited(isFav);
      },
    );

    return unsubscribe;
  }, [currentSource, currentId]);

  // 切换收藏
  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;

    try {
      if (favorited) {
        // 如果已收藏，删除收藏
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        // 如果未收藏，添加收藏
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  const enqueueEpisodeDownload = async (channel: 'browser' | 'ffmpeg') => {
    if (!videoUrl) {
      showToast('当前播放地址不可下载', 'error');
      return;
    }

    const episodeLabel =
      detail?.episodes_titles?.[currentEpisodeIndex] ||
      `第${currentEpisodeIndex + 1}集`;

    let normalizedSourceUrl = videoUrl;
    let referer: string | undefined;
    let origin: string | undefined;
    try {
      const parsedUrl = new URL(videoUrl, window.location.href);
      normalizedSourceUrl = parsedUrl.toString();
      referer = parsedUrl.toString();
      origin = parsedUrl.origin;
    } catch {
      // 使用原始地址继续下载
    }

    try {
      await enqueueDownload({
        title: `${videoTitle || detail?.title || '视频'} ${episodeLabel}`,
        sourceUrl: normalizedSourceUrl,
        channel,
        referer,
        origin,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
      });
      showToast('已加入下载队列', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : '加入下载任务失败',
        'error',
      );
    }
  };

  const handleDownloadCurrentEpisode = async () => {
    await enqueueEpisodeDownload('browser');
  };

  const handleFfmpegDownloadCurrentEpisode = async () => {
    await enqueueEpisodeDownload('ffmpeg');
  };

  useEffect(() => {
    if (
      !Artplayer ||
      !Hls ||
      !videoUrl ||
      loading ||
      currentEpisodeIndex === null ||
      !artRef.current
    ) {
      return;
    }

    // 确保选集索引有效
    if (
      !detail ||
      !detail.episodes ||
      currentEpisodeIndex >= detail.episodes.length ||
      currentEpisodeIndex < 0
    ) {
      setError(`选集索引无效，当前共 ${totalEpisodes} 集`);
      return;
    }

    if (!videoUrl) {
      setError('视频地址无效');
      return;
    }
    console.log(videoUrl);

    // 检测是否为WebKit浏览器
    const isWebkit =
      typeof window !== 'undefined' &&
      typeof (window as any).webkitConvertPointFromNodeToPage === 'function';

    // 非WebKit浏览器且播放器已存在，使用switch方法切换
    if (!isWebkit && artPlayerRef.current) {
      artPlayerRef.current.switch = videoUrl;
      artPlayerRef.current.title = `${videoTitle} - 第${
        currentEpisodeIndex + 1
      }集`;
      artPlayerRef.current.poster = videoCover;
      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl,
        );
      }
      return;
    }

    // WebKit浏览器或首次创建：销毁之前的播放器实例并创建新的
    if (artPlayerRef.current) {
      cleanupPlayer();
    }

    try {
      // 创建新的播放器实例
      Artplayer.PLAYBACK_RATE = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
      Artplayer.USE_RAF = true;

      artPlayerRef.current = new Artplayer({
        container: artRef.current,
        url: videoUrl,
        poster: videoCover,
        volume: 0.7,
        isLive: false,
        muted: false,
        autoplay: true,
        pip: true,
        autoSize: false,
        autoMini: false,
        screenshot: false,
        setting: true,
        loop: false,
        flip: false,
        playbackRate: true,
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
        fastForward: true,
        autoOrientation: true,
        lock: true,
        moreVideoAttr: {
          crossOrigin: 'anonymous',
        },
        // HLS 支持配置
        customType: {
          m3u8: function (video: HTMLVideoElement, url: string) {
            if (!Hls) {
              console.error('HLS.js 未加载');
              return;
            }

            if (video.hls) {
              video.hls.destroy();
            }

            // 获取用户的缓冲模式配置
            const bufferConfig = getHlsBufferConfig();

            const hls = new Hls({
              debug: false, // 关闭日志
              enableWorker: true, // WebWorker 解码，降低主线程压力
              lowLatencyMode: true, // 开启低延迟 LL-HLS

              /* 缓冲/内存相关 - 根据用户设置动态配置 */
              maxBufferLength: bufferConfig.maxBufferLength,
              backBufferLength: bufferConfig.backBufferLength,
              maxBufferSize: bufferConfig.maxBufferSize,

              /* 自定义loader */
              loader: blockAdEnabledRef.current
                ? CustomHlsJsLoader
                : Hls.DefaultConfig.loader,
            });

            hls.loadSource(url);
            hls.attachMedia(video);
            video.hls = hls;

            ensureVideoSource(video, url);

            hls.on(Hls.Events.ERROR, function (event: any, data: any) {
              console.error('HLS Error:', event, data);
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    console.log('网络错误，尝试恢复...');
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    console.log('媒体错误，尝试恢复...');
                    hls.recoverMediaError();
                    break;
                  default:
                    console.log('无法恢复的错误');
                    hls.destroy();
                    break;
                }
              }
            });
          },
        },
        icons: {
          loading:
            '<img src="data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI1MCIgaGVpZ2h0PSI1MCIgdmlld0JveD0iMCAwIDUwIDUwIj48cGF0aCBkPSJNMjUuMjUxIDYuNDYxYy0xMC4zMTggMC0xOC42ODMgOC4zNjUtMTguNjgzIDE4LjY4M2g0LjA2OGMwLTguMDcgNi41NDUtMTQuNjE1IDE0LjYxNS0xNC42MTVWNi40NjF6IiBmaWxsPSIjMDA5Njg4Ij48YW5pbWF0ZVRyYW5zZm9ybSBhdHRyaWJ1dGVOYW1lPSJ0cmFuc2Zvcm0iIGF0dHJpYnV0ZVR5cGU9IlhNTCIgZHVyPSIxcyIgZnJvbT0iMCAyNSAyNSIgcmVwZWF0Q291bnQ9ImluZGVmaW5pdGUiIHRvPSIzNjAgMjUgMjUiIHR5cGU9InJvdGF0ZSIvPjwvcGF0aD48L3N2Zz4=">',
        },
        settings: [
          {
            html: '去广告',
            icon: '<text x="50%" y="50%" font-size="20" font-weight="bold" text-anchor="middle" dominant-baseline="middle" fill="#ffffff">AD</text>',
            tooltip: blockAdEnabled ? '已开启' : '已关闭',
            onClick() {
              const newVal = !blockAdEnabled;
              try {
                localStorage.setItem('enable_blockad', String(newVal));
                if (artPlayerRef.current) {
                  resumeTimeRef.current = artPlayerRef.current.currentTime;
                  if (
                    artPlayerRef.current.video &&
                    artPlayerRef.current.video.hls
                  ) {
                    artPlayerRef.current.video.hls.destroy();
                  }
                  artPlayerRef.current.destroy();
                  artPlayerRef.current = null;
                }
                setBlockAdEnabled(newVal);
              } catch {
                // ignore
              }
              return newVal ? '当前开启' : '当前关闭';
            },
          },
          {
            name: '跳过片头片尾',
            html: '跳过片头片尾',
            switch: skipConfigRef.current.enable,
            onSwitch: function (item) {
              const newConfig = {
                ...skipConfigRef.current,
                enable: !item.switch,
              };
              handleSkipConfigChange(newConfig);
              return !item.switch;
            },
          },
          {
            html: '删除跳过配置',
            onClick: function () {
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              });
              return '';
            },
          },
          {
            name: '设置片头',
            html: '设置片头',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="12" r="2" fill="#ffffff"/><path d="M9 12L17 12" stroke="#ffffff" stroke-width="2"/><path d="M17 6L17 18" stroke="#ffffff" stroke-width="2"/></svg>',
            tooltip:
              skipConfigRef.current.intro_time === 0
                ? '设置片头时间'
                : `${formatTime(skipConfigRef.current.intro_time)}`,
            onClick: function () {
              const currentTime = artPlayerRef.current?.currentTime || 0;
              if (currentTime > 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  intro_time: currentTime,
                };
                handleSkipConfigChange(newConfig);
                return `${formatTime(currentTime)}`;
              }
            },
          },
          {
            name: '设置片尾',
            html: '设置片尾',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 6L7 18" stroke="#ffffff" stroke-width="2"/><path d="M7 12L15 12" stroke="#ffffff" stroke-width="2"/><circle cx="19" cy="12" r="2" fill="#ffffff"/></svg>',
            tooltip:
              skipConfigRef.current.outro_time >= 0
                ? '设置片尾时间'
                : `-${formatTime(-skipConfigRef.current.outro_time)}`,
            onClick: function () {
              const outroTime =
                -(
                  artPlayerRef.current?.duration -
                  artPlayerRef.current?.currentTime
                ) || 0;
              if (outroTime < 0) {
                const newConfig = {
                  ...skipConfigRef.current,
                  outro_time: outroTime,
                };
                handleSkipConfigChange(newConfig);
                return `-${formatTime(-outroTime)}`;
              }
            },
          },
        ],
        // 控制栏配置
        controls: [
          {
            position: 'left',
            index: 13,
            html: '<i class="art-icon flex"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" fill="currentColor"/></svg></i>',
            tooltip: '播放下一集',
            click: function () {
              handleNextEpisode();
            },
          },
          // 投屏按钮 - 始终显示，美观的 UI 设计
          {
            position: 'right',
            index: 5,
            html: (() => {
              const isConnected = castConnectedRef.current;
              const isAvailable = castAvailableRef.current;
              // 根据状态设置不同的样式
              let iconStyle = '';
              if (isConnected) {
                // 已连接：绿色高亮 + 轻微光晕效果
                iconStyle =
                  'color: #22c55e; filter: drop-shadow(0 0 4px rgba(34, 197, 94, 0.6));';
              } else if (isAvailable) {
                // 有设备可用：正常颜色
                iconStyle = 'color: inherit;';
              } else {
                // 无设备/不支持：较淡的颜色
                iconStyle = 'color: inherit; opacity: 0.6;';
              }
              return `<i class="art-icon flex art-cast-btn" style="padding: 0 6px; transition: all 0.2s ease; ${iconStyle}">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 18v3h3c0-1.66-1.34-3-3-3z" fill="currentColor"/>
                  <path d="M1 14v2a5 5 0 0 1 5 5h2c0-3.87-3.13-7-7-7z" fill="currentColor"/>
                  <path d="M1 10v2a9 9 0 0 1 9 9h2c0-6.08-4.93-11-11-11z" fill="currentColor"/>
                  <path d="M21 3H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" fill="currentColor"/>
                  ${isConnected ? '<circle cx="19" cy="19" r="3" fill="#22c55e" stroke="white" stroke-width="1"/>' : ''}
                </svg>
              </i>`;
            })(),
            tooltip: (() => {
              if (castConnectedRef.current) {
                return `📺 正在投屏到 ${castDeviceNameRef.current || '设备'}
🔔 点击断开`;
              } else if (castAvailableRef.current) {
                return '📺 投屏到电视';
              } else {
                return '📺 投屏 (Chromecast)';
              }
            })(),
            click: function () {
              handleCastClick();
            },
          },
        ],
        // 弹幕插件 - 只保留原生蓝色设置与发弹幕 UI
        plugins: [
          // NOTE: 从 localStorage 读取用户上次的弹幕偏好设置
          artplayerPluginDanmuku(
            (() => {
              const savedSettings = loadDanmukuSettings();
              return {
                danmuku: [], // 初始为空，后续通过 load() 加载
                speed: savedSettings.speed,
                opacity: savedSettings.opacity,
                fontSize: savedSettings.fontSize,
                color: '#FFFFFF',
                mode: 0,
                margin: savedSettings.margin,
                modes: savedSettings.modes,
                antiOverlap: savedSettings.antiOverlap,
                synchronousPlayback: false,
                lockTime: 5,
                maxLength: 200,
                theme: 'dark',
                heatmap: false,
                visible: savedSettings.visible,
                emitter: true,
              };
            })(),
          ),
        ],
      });

      // 监听弹幕设置变更事件，将用户偏好持久化到 localStorage
      artPlayerRef.current.on(
        'artplayerPluginDanmuku:config' as any,
        (nextOption: Partial<DanmukuSettings> | null | undefined) => {
          if (!nextOption || typeof nextOption !== 'object') return;
          saveDanmukuSettings({
            speed: nextOption.speed,
            opacity: nextOption.opacity,
            fontSize: nextOption.fontSize,
            margin: nextOption.margin,
            modes: nextOption.modes,
            antiOverlap: nextOption.antiOverlap,
            visible: nextOption.visible,
          });
        },
      );
      artPlayerRef.current.on('artplayerPluginDanmuku:show' as any, () => {
        saveDanmukuSettings({ visible: true });
      });
      artPlayerRef.current.on('artplayerPluginDanmuku:hide' as any, () => {
        saveDanmukuSettings({ visible: false });
      });

      // 播放器创建完成后，尝试立即注入当前已获取的弹幕
      if (danmuList.length > 0) {
        loadDanmuToPlayer(danmuList);
      }

      // 监听播放器事件
      artPlayerRef.current.on('ready', () => {
        setError(null);

        // 播放器就绪后，如果正在播放则请求 Wake Lock
        if (artPlayerRef.current && !artPlayerRef.current.paused) {
          requestWakeLock();
        }
      });

      // 监听播放状态变化，控制 Wake Lock
      artPlayerRef.current.on('play', () => {
        requestWakeLock();
      });

      artPlayerRef.current.on('pause', () => {
        releaseWakeLock();
        saveCurrentPlayProgress();
      });

      artPlayerRef.current.on('video:ended', () => {
        releaseWakeLock();
      });

      // 如果播放器初始化时已经在播放状态，则请求 Wake Lock
      if (artPlayerRef.current && !artPlayerRef.current.paused) {
        requestWakeLock();
      }

      artPlayerRef.current.on('video:volumechange', () => {
        lastVolumeRef.current = artPlayerRef.current.volume;
      });
      artPlayerRef.current.on('video:ratechange', () => {
        lastPlaybackRateRef.current = artPlayerRef.current.playbackRate;
      });

      // 监听视频可播放事件，这时恢复播放进度更可靠
      artPlayerRef.current.on('video:canplay', () => {
        // 若存在需要恢复的播放进度，则跳转
        if (resumeTimeRef.current && resumeTimeRef.current > 0) {
          try {
            const duration = artPlayerRef.current.duration || 0;
            let target = resumeTimeRef.current;
            if (duration && target >= duration - 2) {
              target = Math.max(0, duration - 5);
            }
            artPlayerRef.current.currentTime = target;
            console.log('成功恢复播放进度到:', resumeTimeRef.current);
          } catch (err) {
            console.warn('恢复播放进度失败:', err);
          }
        }
        resumeTimeRef.current = null;

        setTimeout(() => {
          if (
            Math.abs(artPlayerRef.current.volume - lastVolumeRef.current) > 0.01
          ) {
            artPlayerRef.current.volume = lastVolumeRef.current;
          }
          if (
            Math.abs(
              artPlayerRef.current.playbackRate - lastPlaybackRateRef.current,
            ) > 0.01 &&
            isWebkit
          ) {
            artPlayerRef.current.playbackRate = lastPlaybackRateRef.current;
          }
          artPlayerRef.current.notice.show = '';
        }, 0);

        // 隐藏换源加载状态
        setIsVideoLoading(false);
      });

      // 监听视频时间更新事件，实现跳过片头片尾
      artPlayerRef.current.on('video:timeupdate', () => {
        if (!skipConfigRef.current.enable) return;

        const currentTime = artPlayerRef.current.currentTime || 0;
        const duration = artPlayerRef.current.duration || 0;
        const now = Date.now();

        // 限制跳过检查频率为1.5秒一次
        if (now - lastSkipCheckRef.current < 1500) return;
        lastSkipCheckRef.current = now;

        // 跳过片头
        if (
          skipConfigRef.current.intro_time > 0 &&
          currentTime < skipConfigRef.current.intro_time &&
          currentTime > 0.5 // 避免刚开始播放就触发
        ) {
          console.log(
            '跳过片头: 从',
            currentTime,
            '跳到',
            skipConfigRef.current.intro_time,
          );
          artPlayerRef.current.currentTime = skipConfigRef.current.intro_time;
          artPlayerRef.current.notice.show = `✨ 已跳过片头，跳到 ${formatTime(
            skipConfigRef.current.intro_time,
          )}`;
        }

        // 跳过片尾
        if (
          skipConfigRef.current.outro_time < 0 &&
          duration > 0 &&
          currentTime >= duration + skipConfigRef.current.outro_time &&
          currentTime < duration - 1 // 避免在最后一秒重复触发
        ) {
          console.log('跳过片尾: 在', currentTime, '触发跳转');
          if (
            currentEpisodeIndexRef.current <
            (detailRef.current?.episodes?.length || 1) - 1
          ) {
            artPlayerRef.current.notice.show = `⏭️ 已跳过片尾，自动播放下一集`;
            setTimeout(() => {
              handleNextEpisode();
            }, 500);
          } else {
            artPlayerRef.current.notice.show = `✅ 已跳过片尾（已是最后一集）`;
            artPlayerRef.current.pause();
          }
        }
      });

      artPlayerRef.current.on('error', (err: any) => {
        console.error('播放器错误:', err);
        if (artPlayerRef.current.currentTime > 0) {
          return;
        }
      });

      // 监听视频播放结束事件，自动播放下一集
      artPlayerRef.current.on('video:ended', () => {
        const d = detailRef.current;
        const idx = currentEpisodeIndexRef.current;
        if (d && d.episodes && idx < d.episodes.length - 1) {
          setTimeout(() => {
            setCurrentEpisodeIndex(idx + 1);
          }, 1000);
        }
      });

      artPlayerRef.current.on('video:timeupdate', () => {
        const now = Date.now();
        let interval = 5000;
        if (process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash') {
          interval = 20000;
        }
        if (now - lastSaveTimeRef.current > interval) {
          saveCurrentPlayProgress();
          lastSaveTimeRef.current = now;
        }
      });

      artPlayerRef.current.on('pause', () => {
        saveCurrentPlayProgress();
      });

      if (artPlayerRef.current?.video) {
        ensureVideoSource(
          artPlayerRef.current.video as HTMLVideoElement,
          videoUrl,
        );
      }
    } catch (err) {
      console.error('创建播放器失败:', err);
      setError('播放器初始化失败');
    }
  }, [Artplayer, Hls, videoUrl, loading, blockAdEnabled]);

  useEffect(() => {
    loadDanmuToPlayer(danmuList);
  }, [danmuList, videoUrl]);

  // 当组件卸载时清理定时器、Wake Lock 和播放器资源
  useEffect(() => {
    return () => {
      // 清理定时器
      if (saveIntervalRef.current) {
        clearInterval(saveIntervalRef.current);
      }

      // 释放 Wake Lock
      releaseWakeLock();

      // 销毁播放器实例
      cleanupPlayer();
    };
  }, []);

  if (loading) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 动画影院图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-green-500 to-emerald-600 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>
                  {loadingStage === 'searching' && '🔍'}
                  {loadingStage === 'preferring' && '⚡'}
                  {loadingStage === 'fetching' && '🎬'}
                  {loadingStage === 'ready' && '✨'}
                </div>
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
                    loadingStage === 'searching' || loadingStage === 'fetching'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'preferring' ||
                          loadingStage === 'ready'
                        ? 'bg-green-500'
                        : 'bg-gray-300'
                  }`}
                ></div>
                <div
                  className={`w-3 h-3 rounded-full transition-all duration-500 ${
                    loadingStage === 'preferring'
                      ? 'bg-green-500 scale-125'
                      : loadingStage === 'ready'
                        ? 'bg-green-500'
                        : 'bg-gray-300'
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
                      loadingStage === 'searching' ||
                      loadingStage === 'fetching'
                        ? '33%'
                        : loadingStage === 'preferring'
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
      <PageLayout activePath='/play'>
        <div className='flex items-center justify-center min-h-screen bg-transparent'>
          <div className='text-center max-w-md mx-auto px-6'>
            {/* 错误图标 */}
            <div className='relative mb-8'>
              <div className='relative mx-auto w-24 h-24 bg-linear-to-r from-red-500 to-orange-500 rounded-2xl shadow-2xl flex items-center justify-center transform hover:scale-105 transition-transform duration-300'>
                <div className='text-white text-4xl'>😵</div>
                {/* 脉冲效果 */}
                <div className='absolute -inset-2 bg-linear-to-r from-red-500 to-orange-500 rounded-2xl opacity-20 animate-pulse'></div>
              </div>

              {/* 浮动错误粒子 */}
              <div className='absolute top-0 left-0 w-full h-full pointer-events-none'>
                <div className='absolute top-2 left-2 w-2 h-2 bg-red-400 rounded-full animate-bounce'></div>
                <div
                  className='absolute top-4 right-4 w-1.5 h-1.5 bg-orange-400 rounded-full animate-bounce'
                  style={{ animationDelay: '0.5s' }}
                ></div>
                <div
                  className='absolute bottom-3 left-6 w-1 h-1 bg-yellow-400 rounded-full animate-bounce'
                  style={{ animationDelay: '1s' }}
                ></div>
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
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='w-full px-6 py-3 bg-linear-to-r from-green-500 to-emerald-600 text-white rounded-xl font-medium hover:from-green-600 hover:to-emerald-700 transform hover:scale-105 transition-all duration-200 shadow-lg hover:shadow-xl'
              >
                {videoTitle ? '🔍 返回搜索' : '← 返回上页'}
              </button>

              <button
                onClick={() => window.location.reload()}
                className='w-full px-6 py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors duration-200'
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
    <PageLayout activePath='/play'>
      <div className='flex flex-col gap-3 py-4 px-5 lg:px-12 2xl:px-20'>
        {/* 第一行：影片标题 */}
        <div className='py-1 flex justify-between items-center gap-2'>
          <h1 className='text-xl font-semibold text-gray-900 dark:text-gray-100 truncate'>
            {videoTitle || '影片标题'}
            {totalEpisodes > 1 && (
              <span className='text-gray-500 dark:text-gray-400 ml-2 text-base font-normal'>
                {`> ${
                  detail?.episodes_titles?.[currentEpisodeIndex] ||
                  `第 ${currentEpisodeIndex + 1} 集`
                }`}
              </span>
            )}
          </h1>

          {/* 移动端跳过设置按钮 */}
          <button
            onClick={() => setIsSkipConfigPanelOpen(true)}
            className={`lg:hidden shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
              skipConfig.enable
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ring-1 ring-purple-500/20'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400 ring-1 ring-gray-500/10'
            }`}
          >
            <svg
              className='w-3.5 h-3.5'
              fill='none'
              stroke='currentColor'
              viewBox='0 0 24 24'
            >
              <path
                strokeLinecap='round'
                strokeLinejoin='round'
                strokeWidth={2}
                d='M13 5l7 7-7 7M5 5l7 7-7 7'
              />
            </svg>
            <span>{skipConfig.enable ? '已跳过' : '跳过'}</span>
          </button>
        </div>
        {/* 第二行：播放器和选集 */}
        <div className='space-y-2'>
          {/* 折叠控制和跳过设置 - 仅在 lg 及以上屏幕显示 */}
          <div className='hidden lg:flex justify-between items-center'>
            {/* 跳过片头片尾设置按钮 */}
            <button
              onClick={() => setIsSkipConfigPanelOpen(true)}
              className={`group relative flex items-center space-x-2 px-4 py-2 rounded-xl bg-linear-to-r transition-all duration-200 shadow-md hover:shadow-lg transform hover:scale-105 ${
                skipConfig.enable
                  ? 'from-purple-600 via-pink-500 to-indigo-600 text-white'
                  : 'from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 text-gray-700 dark:text-gray-300'
              }`}
              title='设置跳过片头片尾'
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
                  strokeWidth={2}
                  d='M13 5l7 7-7 7M5 5l7 7-7 7'
                />
              </svg>
              <span className='text-sm font-medium'>
                {skipConfig.enable ? '✨ 跳过已启用' : '⚙️ 跳过设置'}
              </span>
              {skipConfig.enable && (
                <div className='absolute -top-1 -right-1 w-3 h-3 bg-green-400 rounded-full animate-pulse'></div>
              )}
            </button>

            <button
              onClick={() =>
                setIsEpisodeSelectorCollapsed(!isEpisodeSelectorCollapsed)
              }
              className='group relative flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-white/90 hover:bg-white dark:bg-gray-800/90 dark:hover:bg-gray-800 border border-gray-200/60 dark:border-gray-700/60 shadow-sm hover:shadow-md transition-all duration-200'
              title={
                isEpisodeSelectorCollapsed ? '显示选集面板' : '隐藏选集面板'
              }
            >
              <svg
                className={`w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${
                  isEpisodeSelectorCollapsed ? 'rotate-180' : 'rotate-0'
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
                {isEpisodeSelectorCollapsed ? '显示' : '隐藏'}
              </span>

              {/* 精致的状态指示点 */}
              <div
                className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full transition-all duration-200 ${
                  isEpisodeSelectorCollapsed
                    ? 'bg-orange-400 animate-pulse'
                    : 'bg-green-400'
                }`}
              ></div>
            </button>
          </div>

          <div
            className={`grid gap-4 lg:h-125 xl:h-162.5 2xl:h-187.5 transition-all duration-300 ease-in-out ${
              isEpisodeSelectorCollapsed
                ? 'grid-cols-1'
                : 'grid-cols-1 md:grid-cols-4'
            }`}
          >
            {/* 播放器 */}
            <div
              className={`h-full transition-all duration-300 ease-in-out rounded-xl border border-white/0 dark:border-white/30 ${
                isEpisodeSelectorCollapsed ? 'col-span-1' : 'md:col-span-3'
              }`}
            >
              <div className='relative w-full h-75 lg:h-full'>
                <div
                  ref={artRef}
                  className='bg-black w-full h-full rounded-xl overflow-hidden shadow-lg'
                ></div>

                <div
                  ref={danmuMetaWrapRef}
                  className='absolute top-3 right-3 z-40 flex items-end gap-2'
                >
                  <div className='flex max-w-[80vw] items-center gap-2 rounded-full border border-white/20 bg-black/75 px-3 py-1.5 text-white shadow-lg md:max-w-90'>
                    <div className='min-w-0'>
                      <button
                        ref={danmuMetaToggleRef}
                        type='button'
                        onClick={() => setShowDanmuMeta((prev) => !prev)}
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          isDanmuEmpty ? 'text-amber-200' : 'text-white/90'
                        } transition-colors hover:text-white`}
                        title='查看弹幕加载详情'
                      >
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            isDanmuEmpty
                              ? 'bg-amber-300 animate-pulse'
                              : 'bg-cyan-400'
                          }`}
                        />
                        {danmuLoading && danmuCount === 0
                          ? '弹幕加载中...'
                          : `弹幕 ${danmuCount} 条`}
                      </button>
                      {!danmuLoading &&
                        (matchInfo || activeManualDanmuOverride) && (
                          <p
                            className='mt-0.5 truncate text-[11px] text-white/70'
                            title={`匹配：${danmuSourceLabel}`}
                          >
                            匹配：{danmuSourceLabel}
                            {danmuMatchLevelLabel && (
                              <span className='ml-1 rounded bg-white/15 px-1.5 py-0.5 text-[10px] text-white/85'>
                                {danmuMatchLevelLabel}
                              </span>
                            )}
                          </p>
                        )}
                    </div>
                    <button
                      type='button'
                      onClick={handleReloadDanmu}
                      disabled={isDanmuBusy}
                      className='inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-50'
                      title='刷新弹幕'
                      aria-label='刷新弹幕'
                    >
                      {isDanmuBusy ? (
                        <svg
                          className='h-4 w-4 animate-spin'
                          viewBox='0 0 24 24'
                          fill='none'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <circle
                            cx='12'
                            cy='12'
                            r='9'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeOpacity='0.35'
                          />
                          <path
                            d='M21 12a9 9 0 0 0-9-9'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                          />
                        </svg>
                      ) : (
                        <svg
                          className='h-4 w-4'
                          viewBox='0 0 24 24'
                          fill='none'
                          xmlns='http://www.w3.org/2000/svg'
                        >
                          <path
                            d='M20 11a8 8 0 1 0 2.3 5.7'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                          />
                          <path
                            d='M20 4v7h-7'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          />
                        </svg>
                      )}
                    </button>
                    <button
                      type='button'
                      onClick={() => setIsDanmuManualModalOpen(true)}
                      className='inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90 transition-colors hover:bg-white/20'
                      title='手动匹配弹幕'
                      aria-label='手动匹配弹幕'
                    >
                      <svg
                        className='h-3.5 w-3.5'
                        viewBox='0 0 24 24'
                        fill='none'
                        xmlns='http://www.w3.org/2000/svg'
                      >
                        <path
                          d='M10.5 18.5A8 8 0 1 1 16 16l4.5 4.5'
                          stroke='currentColor'
                          strokeWidth='2'
                          strokeLinecap='round'
                          strokeLinejoin='round'
                        />
                      </svg>
                      手动
                    </button>
                    {isDanmuManualOverridden && (
                      <button
                        type='button'
                        onClick={handleClearManualDanmuOverride}
                        className='inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-[11px] font-medium text-amber-100 transition-colors hover:bg-amber-400/30'
                        title='恢复自动匹配'
                        aria-label='恢复自动匹配'
                      >
                        恢复自动
                      </button>
                    )}
                  </div>

                  {showDanmuMeta && (
                    <div className='w-[min(80vw,320px)] rounded-xl border border-white/20 bg-black/85 p-3 text-white shadow-lg'>
                      <div className='mb-2 flex items-center justify-between gap-2'>
                        <p className='text-xs font-medium text-white/90'>
                          弹幕加载详情
                        </p>
                        <button
                          type='button'
                          onClick={() => setShowDanmuMeta(false)}
                          className='inline-flex h-5 w-5 items-center justify-center rounded bg-white/10 text-[11px] text-white/80 transition-colors hover:bg-white/20 hover:text-white'
                          aria-label='关闭弹幕详情'
                          title='关闭'
                        >
                          ×
                        </button>
                      </div>
                      <div className='space-y-1.5 text-[11px] text-white/80'>
                        <p className='flex items-center justify-between gap-3'>
                          <span className='text-white/55'>总条数</span>
                          <span className='font-medium text-white/95'>
                            {danmuCount}
                          </span>
                        </p>
                        <p className='flex items-start justify-between gap-3'>
                          <span className='pt-0.5 text-white/55'>来源</span>
                          <span
                            className='max-w-45 truncate text-right text-white/90'
                            title={danmuSourceLabel}
                          >
                            {danmuSourceLabel}
                          </span>
                        </p>
                        <p className='flex items-center justify-between gap-3'>
                          <span className='text-white/55'>匹配模式</span>
                          <span className='text-white/90'>
                            {danmuMatchModeText}
                          </span>
                        </p>
                        <p className='flex items-center justify-between gap-3'>
                          <span className='text-white/55'>匹配级别</span>
                          <span className='text-white/90'>
                            {danmuMatchLevelLabel || '未标注'}
                          </span>
                        </p>
                        <p className='flex items-center justify-between gap-3'>
                          <span className='text-white/55'>数据来源</span>
                          <span className='text-right text-white/90'>
                            {danmuLoadSourceText}
                          </span>
                        </p>
                        <p className='flex items-center justify-between gap-3'>
                          <span className='text-white/55'>最近加载</span>
                          <span className='text-right text-white/90'>
                            {danmuLoadedAtText}
                          </span>
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* 换源加载提示 - 使用播放器自带的加载动画 */}
                {isVideoLoading && (
                  <div className='absolute inset-0 z-50 flex items-center justify-center bg-black/70 rounded-xl'>
                    <div className='flex flex-col items-center gap-3'>
                      <div className='w-10 h-10 border-4 border-green-500 border-t-transparent rounded-full animate-spin' />
                      <span className='text-white/80 text-sm'>
                        {videoLoadingStage === 'sourceChanging'
                          ? '切换播放源...'
                          : '视频加载中...'}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 选集和换源 - 在移动端始终显示，在 lg 及以上可折叠 */}
            <div
              className={`h-75 lg:h-full md:overflow-hidden transition-all duration-300 ease-in-out ${
                isEpisodeSelectorCollapsed
                  ? 'md:col-span-1 lg:hidden lg:opacity-0 lg:scale-95'
                  : 'md:col-span-1 lg:opacity-100 lg:scale-100'
              }`}
            >
              <EpisodeSelector
                totalEpisodes={totalEpisodes}
                episodes_titles={detail?.episodes_titles || []}
                value={currentEpisodeIndex + 1}
                onChange={handleEpisodeChange}
                onSourceChange={handleSourceChange}
                currentSource={currentSource}
                currentId={currentId}
                videoTitle={searchTitle || videoTitle}
                availableSources={availableSources}
                sourceSearchLoading={sourceSearchLoading}
                sourceSearchError={sourceSearchError}
                precomputedVideoInfo={precomputedVideoInfo}
              />
            </div>
          </div>
        </div>

        {/* 详情展示 */}
        <div className='grid grid-cols-1 md:grid-cols-4 gap-4'>
          {/* 文字区 */}
          <div className='md:col-span-3'>
            <div className='p-6 flex flex-col min-h-0'>
              {/* 标题 */}
              <h1 className='text-3xl font-bold mb-2 tracking-wide flex items-center shrink-0 text-center md:text-left w-full text-slate-900 dark:text-gray-100'>
                {videoTitle || '影片标题'}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleFavorite();
                  }}
                  className='ml-3 shrink-0 hover:opacity-80 transition-opacity'
                >
                  <FavoriteIcon filled={favorited} />
                </button>
              </h1>

              {/* 关键信息行 */}
              <div className='flex flex-wrap items-center gap-3 text-base mb-4 shrink-0 text-slate-700 dark:text-gray-300'>
                {detail?.class && (
                  <span className='text-green-600 dark:text-green-400 font-semibold'>
                    {detail.class}
                  </span>
                )}
                {(detail?.year || videoYear) && (
                  <span className='text-gray-600 dark:text-gray-400'>
                    {detail?.year || videoYear}
                  </span>
                )}
                {detail?.source_name && (
                  <span className='border border-gray-400 dark:border-gray-500 px-2 py-px rounded text-gray-700 dark:text-gray-300'>
                    {detail.source_name}
                  </span>
                )}
                {detail?.type_name && (
                  <span className='text-gray-600 dark:text-gray-400'>
                    {detail.type_name}
                  </span>
                )}
              </div>
              <div className='mb-4 flex flex-wrap items-center gap-2'>
                <button
                  type='button'
                  onClick={handleDownloadCurrentEpisode}
                  className='inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm text-emerald-600 transition hover:bg-emerald-500/20 dark:text-emerald-300'
                >
                  <Download className='h-4 w-4' />
                  下载当前集
                </button>
                <button
                  type='button'
                  onClick={handleFfmpegDownloadCurrentEpisode}
                  className='inline-flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-600 transition hover:bg-amber-500/20 dark:text-amber-300'
                >
                  <Download className='h-4 w-4' />
                  FFmpeg 转存下载
                </button>
                <button
                  type='button'
                  onClick={openManager}
                  className='inline-flex items-center gap-1.5 rounded-lg border border-gray-300/70 bg-white/40 px-3 py-1.5 text-sm text-slate-700 transition hover:bg-white/70 dark:border-gray-600 dark:bg-gray-800/40 dark:text-gray-200 dark:hover:bg-gray-700/60'
                >
                  打开下载管理
                </button>
              </div>
              {/* 剧情简介 */}
              {detail?.desc && (
                <div
                  className='mt-0 text-base leading-relaxed text-slate-700 dark:text-gray-300 overflow-y-auto pr-2 flex-1 min-h-0 scrollbar-hide'
                  style={{ whiteSpace: 'pre-line' }}
                >
                  {detail.desc}
                </div>
              )}
            </div>
          </div>

          {/* 封面展示 */}
          <div className='hidden md:block md:col-span-1 md:order-first'>
            <div className='pl-0 py-4 pr-6'>
              <div className='relative bg-gray-300 dark:bg-gray-700 aspect-2/3 flex items-center justify-center rounded-xl overflow-hidden'>
                {videoCover ? (
                  <>
                    <ExternalImage
                      src={videoCover}
                      alt={videoTitle}
                      fill
                      className='object-cover'
                      sizes='(max-width: 768px) 100vw, 280px'
                    />

                    {/* 豆瓣链接按钮 */}
                    {videoDoubanId !== 0 && (
                      <a
                        href={`https://movie.douban.com/subject/${videoDoubanId.toString()}`}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='absolute top-3 left-3'
                      >
                        <div className='bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out'>
                          <svg
                            width='16'
                            height='16'
                            viewBox='0 0 24 24'
                            fill='none'
                            stroke='currentColor'
                            strokeWidth='2'
                            strokeLinecap='round'
                            strokeLinejoin='round'
                          >
                            <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
                            <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
                          </svg>
                        </div>
                      </a>
                    )}
                  </>
                ) : (
                  <span className='text-gray-600 dark:text-gray-400'>
                    封面图片
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 豆瓣富媒体信息区域 */}
        <DoubanInfoSection
          doubanId={videoDoubanId}
          title={videoTitle}
          year={videoYear}
        />

        {isDanmuManualModalOpen && (
          <DanmuManualMatchModal
            isOpen={isDanmuManualModalOpen}
            defaultKeyword={videoTitle}
            currentEpisode={currentEpisodeIndex + 1}
            onClose={() => setIsDanmuManualModalOpen(false)}
            onApply={handleApplyManualDanmuSelection}
          />
        )}
      </div>

      {/* 跳过片头片尾设置面板 */}
      {isSkipConfigPanelOpen && (
        <SkipConfigPanel
          isOpen={isSkipConfigPanelOpen}
          onClose={() => setIsSkipConfigPanelOpen(false)}
          config={skipConfig}
          onChange={handleSkipConfigChange}
          videoDuration={artPlayerRef.current?.duration || 0}
          currentTime={artPlayerRef.current?.currentTime || 0}
        />
      )}

      {/* Toast 通知 */}
      {toast.show && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={3000}
          onClose={() => setToast({ show: false, message: '', type: 'info' })}
        />
      )}
    </PageLayout>
  );
}

// 豆瓣富媒体信息区域组件
const DoubanInfoSection = ({
  doubanId: initialDoubanId,
  title,
  year,
}: {
  doubanId: number;
  title: string;
  year: string;
}) => {
  const [resolvedDoubanId, setResolvedDoubanId] = useState(initialDoubanId);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const normalizedTitle = title.toLowerCase().trim();
    const doubanIdCacheKey = generateCacheKey('douban-resolved-id', {
      title: normalizedTitle,
      year: year || '',
    });

    if (initialDoubanId > 0 || !title) {
      setResolvedDoubanId(initialDoubanId);
      if (initialDoubanId > 0 && normalizedTitle) {
        globalCache.set(doubanIdCacheKey, initialDoubanId, 7 * 24 * 60 * 60);
      }
      return;
    }

    const cachedDoubanId = globalCache.get<number>(doubanIdCacheKey);
    if (cachedDoubanId && cachedDoubanId > 0) {
      console.log('[DoubanInfoSection] 命中豆瓣 ID 本地缓存:', cachedDoubanId);
      setResolvedDoubanId(cachedDoubanId);
      return;
    }

    const searchDoubanId = async () => {
      setIsSearching(true);
      try {
        const searchQuery = encodeURIComponent(title);
        const response = await fetch(
          `/api/douban/proxy?path=movie/search&q=${searchQuery}&count=5`,
        );

        if (!response.ok) {
          console.warn('[DoubanInfoSection] 豆瓣搜索失败:', response.status);
          return;
        }

        const data = await response.json();
        if (data.subjects && data.subjects.length > 0) {
          const matchedSubject =
            data.subjects.find(
              (subject: { title: string; year?: string; id?: string }) => {
                const subjectTitle = subject.title?.toLowerCase().trim();
                const titleMatch =
                  subjectTitle === normalizedTitle ||
                  subjectTitle?.includes(normalizedTitle) ||
                  normalizedTitle.includes(subjectTitle || '');
                const yearMatch = !year || subject.year === year;
                return titleMatch && yearMatch;
              },
            ) || data.subjects[0];

          if (matchedSubject?.id) {
            const foundId = parseInt(matchedSubject.id, 10);
            console.log(
              '[DoubanInfoSection] 搜索找到豆瓣 ID:',
              foundId,
              '标题:',
              matchedSubject.title,
            );
            setResolvedDoubanId(foundId);
            globalCache.set(doubanIdCacheKey, foundId, 7 * 24 * 60 * 60);
          }
        } else {
          console.warn('[DoubanInfoSection] 豆瓣搜索无结果:', title);
        }
      } catch (error) {
        console.error('[DoubanInfoSection] 豆瓣搜索出错:', error);
      } finally {
        setIsSearching(false);
      }
    };

    searchDoubanId();
  }, [initialDoubanId, title, year]);

  const {
    detail: doubanDetail,
    comments,
    recommends,
    detailLoading,
    commentsLoading,
    recommendsLoading,
    commentsTotal,
  } = useDoubanInfo(resolvedDoubanId > 0 ? resolvedDoubanId : null);

  if ((!resolvedDoubanId || resolvedDoubanId === 0) && !isSearching) {
    if (!title) return null;
    return null;
  }

  return (
    <div className='mt-8 space-y-8 pb-8'>
      <MovieMetaInfo
        detail={doubanDetail}
        loading={detailLoading}
        showCast={true}
        showSummary={true}
        showTags={true}
      />

      <MovieRecommends
        recommends={recommends}
        loading={recommendsLoading}
        maxDisplay={10}
      />

      <MovieReviews
        comments={comments}
        loading={commentsLoading}
        total={commentsTotal}
        doubanId={resolvedDoubanId}
        maxDisplay={6}
      />
    </div>
  );
};
// FavoriteIcon 组件
const FavoriteIcon = ({ filled }: { filled: boolean }) => {
  if (filled) {
    return (
      <svg
        className='h-7 w-7'
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
    <Heart className='h-7 w-7 stroke-1 text-gray-600 dark:text-gray-300' />
  );
};

export default function PlayPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PlayPageClient />
    </Suspense>
  );
}
