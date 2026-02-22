/**
 * Google Cast SDK 类型声明
 * 用于支持 Chromecast 投屏功能
 */

declare namespace chrome.cast {
  /**
   * Cast SDK 初始化状态
   */
  enum SessionStatus {
    CONNECTED = 'connected',
    DISCONNECTED = 'disconnected',
    STOPPED = 'stopped',
  }

  /**
   * 接收端可用性状态
   */
  enum ReceiverAvailability {
    AVAILABLE = 'available',
    UNAVAILABLE = 'unavailable',
  }

  /**
   * 错误代码
   */
  enum ErrorCode {
    CANCEL = 'cancel',
    TIMEOUT = 'timeout',
    API_NOT_INITIALIZED = 'api_not_initialized',
    INVALID_PARAMETER = 'invalid_parameter',
    EXTENSION_NOT_COMPATIBLE = 'extension_not_compatible',
    EXTENSION_MISSING = 'extension_missing',
    RECEIVER_UNAVAILABLE = 'receiver_unavailable',
    SESSION_ERROR = 'session_error',
    CHANNEL_ERROR = 'channel_error',
    LOAD_MEDIA_FAILED = 'load_media_failed',
  }

  /**
   * 自动加入策略
   */
  enum AutoJoinPolicy {
    TAB_AND_ORIGIN_SCOPED = 'tab_and_origin_scoped',
    ORIGIN_SCOPED = 'origin_scoped',
    PAGE_SCOPED = 'page_scoped',
  }

  /**
   * 默认动作策略
   */
  enum DefaultActionPolicy {
    CREATE_SESSION = 'create_session',
    CAST_THIS_TAB = 'cast_this_tab',
  }

  /**
   * Cast 错误对象
   */
  interface CastError {
    code: ErrorCode;
    description: string;
    details: Record<string, unknown>;
  }

  /**
   * 会话请求配置
   */
  class SessionRequest {
    constructor(appId: string);
    appId: string;
    capabilities: string[];
    requestSessionTimeout: number;
    language: string | null;
  }

  /**
   * API 配置
   */
  class ApiConfig {
    constructor(
      sessionRequest: SessionRequest,
      sessionListener: (session: Session) => void,
      receiverListener: (availability: ReceiverAvailability) => void,
      autoJoinPolicy?: AutoJoinPolicy,
      defaultActionPolicy?: DefaultActionPolicy,
    );
    sessionRequest: SessionRequest;
    sessionListener: (session: Session) => void;
    receiverListener: (availability: ReceiverAvailability) => void;
    autoJoinPolicy: AutoJoinPolicy;
    defaultActionPolicy: DefaultActionPolicy;
  }

  /**
   * 接收端设备信息
   */
  interface Receiver {
    label: string;
    friendlyName: string;
    capabilities: string[];
    volume: Volume | null;
    receiverType: string;
    isActiveInput: boolean | null;
    displayStatus: DisplayStatus | null;
  }

  /**
   * 音量信息
   */
  interface Volume {
    level: number | null;
    muted: boolean | null;
  }

  /**
   * 显示状态
   */
  interface DisplayStatus {
    showStop: boolean;
    statusText: string;
    appImages: Image[];
  }

  /**
   * 图片信息
   */
  class Image {
    constructor(url: string);
    url: string;
    height: number | null;
    width: number | null;
  }

  /**
   * Cast 会话
   */
  interface Session {
    sessionId: string;
    appId: string;
    displayName: string;
    appImages: Image[];
    receiver: Receiver;
    senderApps: SenderApplication[];
    namespaces: Array<{ name: string }>;
    media: media.Media[];
    status: SessionStatus;
    statusText: string;
    transportId: string;
    loadMedia(
      loadRequest: media.LoadRequest,
      successCallback: (media: media.Media) => void,
      errorCallback: (error: CastError) => void,
    ): void;
    stop(
      successCallback: () => void,
      errorCallback: (error: CastError) => void,
    ): void;
    addUpdateListener(listener: (isAlive: boolean) => void): void;
    removeUpdateListener(listener: (isAlive: boolean) => void): void;
    addMediaListener(listener: (media: media.Media) => void): void;
    removeMediaListener(listener: (media: media.Media) => void): void;
    addMessageListener(
      namespace: string,
      listener: (namespace: string, message: string) => void,
    ): void;
    removeMessageListener(
      namespace: string,
      listener: (namespace: string, message: string) => void,
    ): void;
    sendMessage(
      namespace: string,
      message: string | Record<string, unknown>,
      successCallback: () => void,
      errorCallback: (error: CastError) => void,
    ): void;
    setReceiverVolumeLevel(
      newLevel: number,
      successCallback: () => void,
      errorCallback: (error: CastError) => void,
    ): void;
    setReceiverMuted(
      muted: boolean,
      successCallback: () => void,
      errorCallback: (error: CastError) => void,
    ): void;
  }

  /**
   * 发送端应用信息
   */
  interface SenderApplication {
    platform: string;
    url: string;
    packageId: string | null;
  }

  /**
   * 媒体相关类型
   */
  namespace media {
    /**
     * 媒体流类型
     */
    enum StreamType {
      BUFFERED = 'BUFFERED',
      LIVE = 'LIVE',
      OTHER = 'OTHER',
    }

    /**
     * 媒体元数据类型
     */
    enum MetadataType {
      GENERIC = 0,
      MOVIE = 1,
      TV_SHOW = 2,
      MUSIC_TRACK = 3,
      PHOTO = 4,
    }

    /**
     * 播放器状态
     */
    enum PlayerState {
      IDLE = 'IDLE',
      PLAYING = 'PLAYING',
      PAUSED = 'PAUSED',
      BUFFERING = 'BUFFERING',
    }

    /**
     * 空闲原因
     */
    enum IdleReason {
      CANCELLED = 'CANCELLED',
      INTERRUPTED = 'INTERRUPTED',
      FINISHED = 'FINISHED',
      ERROR = 'ERROR',
    }

    /**
     * 媒体信息
     */
    class MediaInfo {
      constructor(contentId: string, contentType: string);
      contentId: string;
      contentType: string;
      streamType: StreamType;
      duration: number | null;
      metadata:
        | GenericMediaMetadata
        | MovieMediaMetadata
        | TvShowMediaMetadata
        | null;
      customData: Record<string, unknown> | null;
      textTrackStyle: TextTrackStyle | null;
      tracks: Track[] | null;
    }

    /**
     * 通用媒体元数据
     */
    class GenericMediaMetadata {
      constructor();
      metadataType: MetadataType;
      title: string | null;
      subtitle: string | null;
      images: Image[];
      releaseDate: string | null;
    }

    /**
     * 电影媒体元数据
     */
    class MovieMediaMetadata {
      constructor();
      metadataType: MetadataType;
      title: string | null;
      subtitle: string | null;
      studio: string | null;
      images: Image[];
      releaseDate: string | null;
    }

    /**
     * 电视节目媒体元数据
     */
    class TvShowMediaMetadata {
      constructor();
      metadataType: MetadataType;
      seriesTitle: string | null;
      title: string | null;
      season: number | null;
      episode: number | null;
      images: Image[];
      originalAirDate: string | null;
    }

    /**
     * 文本轨道样式
     */
    interface TextTrackStyle {
      backgroundColor: string | null;
      customData: Record<string, unknown> | null;
      edgeColor: string | null;
      edgeType: string | null;
      fontFamily: string | null;
      fontGenericFamily: string | null;
      fontScale: number | null;
      fontStyle: string | null;
      foregroundColor: string | null;
      windowColor: string | null;
      windowRoundedCornerRadius: number | null;
      windowType: string | null;
    }

    /**
     * 轨道信息
     */
    interface Track {
      trackId: number;
      trackContentId: string | null;
      trackContentType: string | null;
      type: string;
      name: string | null;
      language: string | null;
      customData: Record<string, unknown> | null;
    }

    /**
     * 加载请求
     */
    class LoadRequest {
      constructor(mediaInfo: MediaInfo);
      mediaInfo: MediaInfo;
      autoplay: boolean;
      currentTime: number;
      customData: Record<string, unknown> | null;
      activeTrackIds: number[] | null;
    }

    /**
     * 媒体对象
     */
    interface Media {
      mediaSessionId: number;
      media: MediaInfo;
      playbackRate: number;
      playerState: PlayerState;
      supportedMediaCommands: number;
      volume: Volume;
      idleReason: IdleReason | null;
      currentTime: number;
      customData: Record<string, unknown> | null;
      play(
        playRequest: PlayRequest | null,
        successCallback: () => void,
        errorCallback: (error: CastError) => void,
      ): void;
      pause(
        pauseRequest: PauseRequest | null,
        successCallback: () => void,
        errorCallback: (error: CastError) => void,
      ): void;
      seek(
        seekRequest: SeekRequest,
        successCallback: () => void,
        errorCallback: (error: CastError) => void,
      ): void;
      stop(
        stopRequest: StopRequest | null,
        successCallback: () => void,
        errorCallback: (error: CastError) => void,
      ): void;
      setVolume(
        volumeRequest: VolumeRequest,
        successCallback: () => void,
        errorCallback: (error: CastError) => void,
      ): void;
      addUpdateListener(listener: (isAlive: boolean) => void): void;
      removeUpdateListener(listener: (isAlive: boolean) => void): void;
      getEstimatedTime(): number;
    }

    /**
     * 播放请求
     */
    interface PlayRequest {
      customData: Record<string, unknown> | null;
    }

    /**
     * 暂停请求
     */
    interface PauseRequest {
      customData: Record<string, unknown> | null;
    }

    /**
     * 跳转请求
     */
    class SeekRequest {
      constructor();
      currentTime: number;
      resumeState: string | null;
      customData: Record<string, unknown> | null;
    }

    /**
     * 停止请求
     */
    interface StopRequest {
      customData: Record<string, unknown> | null;
    }

    /**
     * 音量请求
     */
    class VolumeRequest {
      constructor(volume: Volume);
      volume: Volume;
      customData: Record<string, unknown> | null;
    }
  }

  /**
   * 初始化 Cast API
   */
  function initialize(
    apiConfig: ApiConfig,
    successCallback: () => void,
    errorCallback: (error: CastError) => void,
  ): void;

  /**
   * 请求创建会话
   */
  function requestSession(
    successCallback: (session: Session) => void,
    errorCallback: (error: CastError) => void,
    sessionRequest?: SessionRequest,
  ): void;

  /**
   * 检查 API 是否已初始化
   */
  const isAvailable: boolean;

  /**
   * Cast SDK 版本
   */
  const VERSION: number[];

  /**
   * 默认媒体接收端应用 ID
   */
  const DEFAULT_MEDIA_RECEIVER_APP_ID: string;
}

/**
 * 扩展 Window 接口以支持 Cast SDK 回调
 */
interface Window {
  /**
   * Google Cast SDK 加载完成回调
   * SDK 加载完成后会调用此函数
   */
  __onGCastApiAvailable?: (isAvailable: boolean) => void;

  /**
   * Chrome 浏览器扩展对象
   * 用于检测是否为 Chromium 内核浏览器
   */
  chrome?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cast?: any;
    // Chrome 浏览器的其他属性
    [key: string]: unknown;
  };
}
