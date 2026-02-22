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
    DisableYellowFilter: boolean;
    FluidSearch: boolean;
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
}

export interface AdminConfigResult {
  Role: 'owner' | 'admin';
  Config: AdminConfig;
}
