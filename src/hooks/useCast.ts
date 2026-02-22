/* eslint-disable no-console, no-undef */

/**
 * useCast Hook
 * 封装 Google Cast (Chromecast) 投屏功能
 *
 * NOTE: 投屏功能依赖视频源服务器配置了允许 Google Cast 来源的 CORS 头
 * NOTE: Cast SDK 仅在 HTTPS 或 localhost 环境下可用
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// Cast SDK 脚本 URL
const CAST_SDK_URL =
  'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';

// Google Default Media Receiver 应用 ID
const DEFAULT_RECEIVER_APP_ID = 'CC1AD845';

/**
 * HLS 流的 Content-Type
 * 用于告知 Cast Receiver 如何解析媒体
 */
const HLS_CONTENT_TYPE = 'application/x-mpegurl';

/**
 * useCast Hook 返回值类型
 */
export interface UseCastReturn {
  /** Cast API 是否可用（需要 Chromium 内核浏览器且有可用的 Cast 设备） */
  isAvailable: boolean;
  /** 是否已连接到 Cast 设备 */
  isConnected: boolean;
  /** 连接的设备名称 */
  deviceName: string | null;
  /** SDK 是否正在加载中 */
  isLoading: boolean;
  /** 请求投屏连接 */
  requestSession: () => Promise<void>;
  /** 加载媒体到 Cast 设备 */
  loadMedia: (url: string, title?: string, poster?: string) => Promise<void>;
  /** 断开投屏连接 */
  endSession: () => void;
}

/**
 * 检测当前是否为 iOS 设备
 * iOS 上所有浏览器都被强制使用 WebKit 引擎，无法支持 Cast SDK
 */
export function isIOSPlatform(): boolean {
  if (typeof window === 'undefined') return false;

  const userAgent = navigator.userAgent.toLowerCase();
  // 检测 iOS 设备：iPhone、iPad、iPod
  // 也检测在桌面模式下的 iPad（会显示为 Macintosh 但支持 touch）
  const isIOS =
    /iphone|ipad|ipod/.test(userAgent) ||
    (userAgent.includes('macintosh') && 'ontouchend' in document);

  return isIOS;
}

/**
 * 检测当前是否为 Chromium 内核浏览器
 * Cast SDK 仅在桌面版 Chrome/Edge 等 Chromium 浏览器中可用
 * NOTE: iOS 上的 Chrome/Edge 使用 WebKit 引擎，不支持 Cast SDK
 */
function isChromiumBrowser(): boolean {
  if (typeof window === 'undefined') return false;

  // iOS 设备上的所有浏览器都使用 WebKit，不支持 Cast SDK
  if (isIOSPlatform()) {
    return false;
  }

  // 检测 window.chrome 对象是否存在
  // Safari 和 Firefox 没有这个对象
  const hasChrome =
    typeof window.chrome !== 'undefined' && window.chrome !== null;

  // 排除 Opera，因为它虽然基于 Chromium 但 Cast 支持不稳定
  const userAgent = navigator.userAgent.toLowerCase();
  const isOpera = userAgent.includes('opr') || userAgent.includes('opera');

  return hasChrome && !isOpera;
}

/**
 * 检测是否为安全环境（HTTPS 或 localhost）
 * Cast SDK 需要安全环境才能工作
 */
function isSecureContext(): boolean {
  if (typeof window === 'undefined') return false;

  const { protocol, hostname } = window.location;
  return (
    protocol === 'https:' ||
    hostname === 'localhost' ||
    hostname === '127.0.0.1'
  );
}

/**
 * 根据视频 URL 判断 Content-Type
 */
function getContentType(url: string): string {
  const lowerUrl = url.toLowerCase();
  if (lowerUrl.includes('.m3u8') || lowerUrl.includes('m3u8')) {
    return HLS_CONTENT_TYPE;
  }
  if (lowerUrl.includes('.mp4')) {
    return 'video/mp4';
  }
  if (lowerUrl.includes('.webm')) {
    return 'video/webm';
  }
  // 默认假设为 HLS 流（IPTV 常见格式）
  return HLS_CONTENT_TYPE;
}

/**
 * Google Cast 投屏 Hook
 */
export function useCast(): UseCastReturn {
  // 状态
  const [isAvailable, setIsAvailable] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 引用
  const sessionRef = useRef<chrome.cast.Session | null>(null);
  const initializingRef = useRef(false);
  const sdkLoadedRef = useRef(false);

  /**
   * 初始化 Cast API
   */
  const initializeCastApi = useCallback(() => {
    if (initializingRef.current || !window.chrome?.cast) {
      return;
    }

    initializingRef.current = true;

    try {
      const sessionRequest = new chrome.cast.SessionRequest(
        DEFAULT_RECEIVER_APP_ID,
      );

      const apiConfig = new chrome.cast.ApiConfig(
        sessionRequest,
        // Session Listener - 当有活跃会话时调用
        (session: chrome.cast.Session) => {
          console.log('[Cast] Session received:', session.displayName);
          sessionRef.current = session;
          setIsConnected(true);
          setDeviceName(session.receiver.friendlyName);

          // 监听会话状态变化
          session.addUpdateListener((isAlive: boolean) => {
            if (!isAlive) {
              console.log('[Cast] Session ended');
              sessionRef.current = null;
              setIsConnected(false);
              setDeviceName(null);
            }
          });
        },
        // Receiver Listener - 当接收设备可用性变化时调用
        (availability: chrome.cast.ReceiverAvailability) => {
          console.log('[Cast] Receiver availability:', availability);
          const available =
            availability === chrome.cast.ReceiverAvailability.AVAILABLE;
          setIsAvailable(available);
          setIsLoading(false);
        },
      );

      chrome.cast.initialize(
        apiConfig,
        () => {
          console.log('[Cast] API initialized successfully');
          setIsLoading(false);
        },
        (error: chrome.cast.CastError) => {
          console.error('[Cast] Initialization failed:', error);
          setIsAvailable(false);
          setIsLoading(false);
          initializingRef.current = false;
        },
      );
    } catch (err) {
      console.error('[Cast] Error during initialization:', err);
      setIsAvailable(false);
      setIsLoading(false);
      initializingRef.current = false;
    }
  }, []);

  /**
   * 加载 Cast SDK 脚本
   */
  const loadCastSdk = useCallback(() => {
    // 检查是否已加载
    if (sdkLoadedRef.current) {
      return;
    }

    // 检查是否已经有脚本标签
    const existingScript = document.querySelector(
      `script[src*="cast_sender.js"]`,
    );
    if (existingScript) {
      sdkLoadedRef.current = true;
      return;
    }

    // 设置 SDK 加载回调
    window.__onGCastApiAvailable = (castAvailable: boolean) => {
      console.log('[Cast] SDK loaded, available:', castAvailable);
      if (castAvailable) {
        initializeCastApi();
      } else {
        setIsAvailable(false);
        setIsLoading(false);
      }
    };

    // 动态加载 SDK 脚本
    const script = document.createElement('script');
    script.src = CAST_SDK_URL;
    script.async = true;
    script.onerror = () => {
      console.error('[Cast] Failed to load SDK');
      setIsAvailable(false);
      setIsLoading(false);
    };

    document.head.appendChild(script);
    sdkLoadedRef.current = true;
  }, [initializeCastApi]);

  /**
   * 初始化 Hook
   */
  useEffect(() => {
    // 早期退出：非 Chromium 浏览器
    if (!isChromiumBrowser()) {
      console.log('[Cast] Not a Chromium browser, Cast unavailable');
      setIsAvailable(false);
      setIsLoading(false);
      return;
    }

    // 早期退出：非安全环境
    if (!isSecureContext()) {
      console.log('[Cast] Not a secure context, Cast unavailable');
      setIsAvailable(false);
      setIsLoading(false);
      return;
    }

    // 检查 SDK 是否已加载
    if (window.chrome?.cast) {
      console.log('[Cast] SDK already loaded');
      initializeCastApi();
    } else {
      loadCastSdk();
    }

    // 清理函数
    return () => {
      // 不需要特别清理，因为 Cast SDK 是全局的
    };
  }, [initializeCastApi, loadCastSdk]);

  /**
   * 请求创建投屏会话
   */
  const requestSession = useCallback(async (): Promise<void> => {
    if (!window.chrome?.cast) {
      console.error('[Cast] Cast API not available');
      return;
    }

    return new Promise((resolve, reject) => {
      chrome.cast.requestSession(
        (session: chrome.cast.Session) => {
          console.log('[Cast] Session started:', session.displayName);
          sessionRef.current = session;
          setIsConnected(true);
          setDeviceName(session.receiver.friendlyName);

          // 监听会话状态变化
          session.addUpdateListener((isAlive: boolean) => {
            if (!isAlive) {
              console.log('[Cast] Session ended');
              sessionRef.current = null;
              setIsConnected(false);
              setDeviceName(null);
            }
          });

          resolve();
        },
        (error: chrome.cast.CastError) => {
          // 用户取消不算错误
          if (error.code === chrome.cast.ErrorCode.CANCEL) {
            console.log('[Cast] User cancelled session request');
            resolve();
          } else {
            console.error('[Cast] Session request failed:', error);
            reject(error);
          }
        },
      );
    });
  }, []);

  /**
   * 加载媒体到 Cast 设备
   */
  const loadMedia = useCallback(
    async (url: string, title?: string, poster?: string): Promise<void> => {
      const session = sessionRef.current;
      if (!session) {
        console.error('[Cast] No active session');
        return;
      }

      const contentType = getContentType(url);
      console.log('[Cast] Loading media:', { url, contentType, title });

      const mediaInfo = new chrome.cast.media.MediaInfo(url, contentType);
      mediaInfo.streamType = chrome.cast.media.StreamType.BUFFERED;

      // 设置元数据
      const metadata = new chrome.cast.media.GenericMediaMetadata();
      metadata.title = title || '投屏视频';
      if (poster) {
        metadata.images = [new chrome.cast.Image(poster)];
      }
      mediaInfo.metadata = metadata;

      const loadRequest = new chrome.cast.media.LoadRequest(mediaInfo);
      loadRequest.autoplay = true;

      return new Promise((resolve, reject) => {
        session.loadMedia(
          loadRequest,
          (_media: chrome.cast.media.Media) => {
            console.log('[Cast] Media loaded successfully');
            resolve();
          },
          (error: chrome.cast.CastError) => {
            console.error('[Cast] Failed to load media:', error);
            reject(error);
          },
        );
      });
    },
    [],
  );

  /**
   * 结束投屏会话
   */
  const endSession = useCallback((): void => {
    const session = sessionRef.current;
    if (!session) {
      console.log('[Cast] No active session to end');
      return;
    }

    session.stop(
      () => {
        console.log('[Cast] Session stopped');
        sessionRef.current = null;
        setIsConnected(false);
        setDeviceName(null);
      },
      (error: chrome.cast.CastError) => {
        console.error('[Cast] Failed to stop session:', error);
        // 即使出错也清理本地状态
        sessionRef.current = null;
        setIsConnected(false);
        setDeviceName(null);
      },
    );
  }, []);

  return {
    isAvailable,
    isConnected,
    deviceName,
    isLoading,
    requestSession,
    loadMedia,
    endSession,
  };
}

export default useCast;
