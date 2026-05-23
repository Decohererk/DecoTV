export interface DanmuCustomNode {
  id: string;
  name: string;
  url: string;
  token: string;
  createdAt: number;
  updatedAt: number;
}

export interface PanSouNode {
  id: string;
  name: string;
  serverUrl: string;
  token: string;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
}

export interface PrivateLibraryConnector {
  id: string;
  name: string;
  displayName?: string;
  type: 'openlist' | 'emby' | 'jellyfin' | 'xiaoya';
  enabled: boolean;
  serverUrl: string;
  token: string;
  alistToken?: string;
  username?: string;
  password?: string;
  rootPath?: string;
  userId?: string;
  libraryFilter?: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PrivateLibraryConfig {
  connectors: PrivateLibraryConnector[];
}

export type SearchResultLoadMode = 'infinite' | 'pagination';

export interface AdminConfig {
  ConfigSubscribtion: {
    URL: string;
    AutoUpdate: boolean;
    LastCheck: string;
  };
  ConfigFile: string;
  SiteConfig: {
    SiteName: string;
    Announcement: string;
    SearchDownstreamMaxPage: number;
    SiteInterfaceCacheTime: number;
    DoubanProxyType: string;
    DoubanProxy: string;
    DoubanImageProxyType: string;
    DoubanImageProxy: string;
    TmdbProxyType?: 'direct' | 'forward' | 'reverse';
    TmdbProxy?: string;
    TmdbReverseProxy?: string;
    DisableYellowFilter: boolean;
    FluidSearch: boolean;
    SearchResultLoadMode: SearchResultLoadMode;
    LoginBackground?: string;
  };
  UserConfig: {
    Users: {
      username: string;
      role: 'user' | 'admin' | 'owner';
      banned?: boolean;
      enabledApis?: string[];
      tags?: string[];
    }[];
    Tags?: {
      name: string;
      enabledApis: string[];
    }[];
  };
  SourceConfig: {
    key: string;
    name: string;
    api: string;
    detail?: string;
    from: 'config' | 'custom';
    disabled?: boolean;
    is_adult?: boolean;
    disable_ad_filter?: boolean;
    proxyStrategy?: 'auto' | 'direct' | 'proxy' | 'manifest-only';
    ua?: string;
    referer?: string;
    origin?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    priority?: number;
    regionHint?: string;
    adult?: boolean;
    disabledReason?: string;
  }[];
  CustomCategories: {
    name?: string;
    type: 'movie' | 'tv';
    query: string;
    from: 'config' | 'custom';
    disabled?: boolean;
  }[];
  LiveConfig?: {
    key: string;
    name: string;
    url: string;
    ua?: string;
    epg?: string;
    from: 'config' | 'custom';
    channelNumber?: number;
    disabled?: boolean;
  }[];
  DanmuConfig?: {
    enabled: boolean;
    serverUrl: string;
    token: string;
    platform: string;
    sourceOrder: string;
    mergeSourcePairs: string;
    bilibiliCookie: string;
    convertTopBottomToScroll: boolean;
    convertColor: 'default' | 'white' | 'color';
    danmuLimit: number;
    blockedWords: string;
    danmuOutputFormat: 'json' | 'xml';
    simplifiedTraditional: 'default' | 'simplified' | 'traditional';
    customNodes?: DanmuCustomNode[];
  };
  PanSouConfig?: {
    activeNodeId: string;
    nodes: PanSouNode[];
  };
  TMDBConfig?: {
    ApiKey: string;
    ProxyType: 'direct' | 'forward' | 'reverse';
    Proxy: string;
    ReverseProxy: string;
  };
  PrivateLibraryConfig?: PrivateLibraryConfig;
  AdFilterConfig?: {
    enabled: boolean;
  };
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
