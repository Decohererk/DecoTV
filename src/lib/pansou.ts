export const DEFAULT_PANSOU_SERVER_URL = 'https://pansou.katelya.eu.org/';
export const DEFAULT_PANSOU_NODE_NAME = '演示节点';
export const MAX_PANSOU_NODE_COUNT = 32;

export const PANSOU_PLUGIN_SOURCES = ['qqpd', 'gying', 'weibo'] as const;
export type PanSouPluginSource = (typeof PANSOU_PLUGIN_SOURCES)[number];

export interface PanSouNodeConfig {
  id: string;
  name: string;
  serverUrl: string;
  token: string;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
}

export interface PanSouConfigValue {
  activeNodeId: string;
  nodes: PanSouNodeConfig[];
}

export interface PanSouRuntimeConfig {
  nodeId: string;
  nodeName: string;
  serverUrl: string;
  token: string;
  username: string;
  password: string;
}

function createNodeId(seed = ''): string {
  const suffix = Math.random().toString(16).slice(2, 10);
  if (seed) {
    return `${seed}_${suffix}`;
  }
  return `node_${Date.now()}_${suffix}`;
}

export function normalizePanSouServerUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().replace(/\/+$/, '');
}

export function normalizePanSouToken(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function normalizePanSouUsername(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\r\n]/g, '').trim();
}

export function normalizePanSouPassword(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.replace(/[\r\n]/g, '').trim();
}

export function getDefaultPanSouNode(): PanSouNodeConfig {
  const now = Date.now();
  return {
    id: 'pansou_default_node',
    name: DEFAULT_PANSOU_NODE_NAME,
    serverUrl: normalizePanSouServerUrl(DEFAULT_PANSOU_SERVER_URL),
    token: '',
    username: '',
    password: '',
    createdAt: now,
    updatedAt: now,
  };
}

export function getDefaultPanSouConfig(): PanSouConfigValue {
  const defaultNode = getDefaultPanSouNode();
  return {
    activeNodeId: defaultNode.id,
    nodes: [defaultNode],
  };
}

export function normalizePanSouNode(
  value: unknown,
  index = 0,
): PanSouNodeConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<PanSouNodeConfig> & {
    url?: string;
  };
  const now = Date.now();

  const serverUrl = normalizePanSouServerUrl(raw.serverUrl || raw.url);
  if (!serverUrl) {
    return null;
  }

  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : createNodeId(`pansou_${index}`);
  const name =
    typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim()
      : `节点 ${index + 1}`;

  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : now;
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : now;

  return {
    id,
    name,
    serverUrl,
    token: normalizePanSouToken(raw.token),
    username: normalizePanSouUsername(raw.username),
    password: normalizePanSouPassword(raw.password),
    createdAt,
    updatedAt,
  };
}

export function normalizePanSouNodes(value: unknown): PanSouNodeConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const dedup = new Map<string, PanSouNodeConfig>();

  for (let i = 0; i < value.length; i += 1) {
    const node = normalizePanSouNode(value[i], i);
    if (!node) {
      continue;
    }

    if (dedup.has(node.id)) {
      node.id = createNodeId(`pansou_${i}`);
    }

    dedup.set(node.id, node);

    if (dedup.size >= MAX_PANSOU_NODE_COUNT) {
      break;
    }
  }

  return Array.from(dedup.values());
}

function normalizeLegacyPanSouConfig(
  value: Record<string, unknown>,
): PanSouConfigValue {
  const defaultNode = getDefaultPanSouNode();

  const serverUrl =
    normalizePanSouServerUrl(value.serverUrl) || defaultNode.serverUrl;
  const token = normalizePanSouToken(value.token);
  const username = normalizePanSouUsername(value.username);
  const password = normalizePanSouPassword(value.password);

  const node: PanSouNodeConfig = {
    ...defaultNode,
    id: 'pansou_legacy_node',
    name: '默认节点',
    serverUrl,
    token,
    username,
    password,
    updatedAt: Date.now(),
  };

  return {
    activeNodeId: node.id,
    nodes: [node],
  };
}

export function normalizePanSouConfig(value: unknown): PanSouConfigValue {
  const fallback = getDefaultPanSouConfig();

  if (!value || typeof value !== 'object') {
    return fallback;
  }

  const raw = value as Record<string, unknown>;

  if (Array.isArray(raw.nodes)) {
    const nodes = normalizePanSouNodes(raw.nodes);
    if (nodes.length === 0) {
      return fallback;
    }

    const activeNodeId =
      typeof raw.activeNodeId === 'string' && raw.activeNodeId.trim()
        ? raw.activeNodeId.trim()
        : nodes[0].id;

    const activeExists = nodes.some((item) => item.id === activeNodeId);

    return {
      activeNodeId: activeExists ? activeNodeId : nodes[0].id,
      nodes,
    };
  }

  // 向后兼容旧版单节点结构
  if (raw.serverUrl || raw.token || raw.username || raw.password) {
    return normalizeLegacyPanSouConfig(raw);
  }

  return fallback;
}

export function resolveActivePanSouNode(
  config: PanSouConfigValue,
): PanSouNodeConfig {
  return (
    config.nodes.find((item) => item.id === config.activeNodeId) ||
    config.nodes[0] ||
    getDefaultPanSouNode()
  );
}

export function resolvePanSouSearchUrl(serverUrl: string): string {
  const normalized = normalizePanSouServerUrl(serverUrl);
  if (/\/api\/search$/i.test(normalized)) {
    return normalized;
  }
  return `${normalized}/api/search`;
}

export function resolvePanSouHealthUrl(serverUrl: string): string {
  const normalized = normalizePanSouServerUrl(serverUrl);
  if (/\/api\/search$/i.test(normalized)) {
    return normalized.replace(/\/api\/search$/i, '/api/health');
  }
  if (/\/api$/i.test(normalized)) {
    return `${normalized}/health`;
  }
  return `${normalized}/api/health`;
}

export function buildPanSouAuthorizationHeader(args: {
  username?: string;
  password?: string;
  token?: string;
  fallbackAuthorization?: string | null;
}): string {
  const username = normalizePanSouUsername(args.username);
  const password = normalizePanSouPassword(args.password);

  if (username && password) {
    const encoded = Buffer.from(`${username}:${password}`, 'utf8')
      .toString('base64')
      .replace(/\s+/g, '');
    return `Basic ${encoded}`;
  }

  const token = normalizePanSouToken(args.token);
  if (token) {
    return `Bearer ${token}`;
  }

  if (typeof args.fallbackAuthorization !== 'string') {
    return '';
  }
  return args.fallbackAuthorization.replace(/[\r\n]/g, '').trim();
}

export function parsePluginNames(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function normalizePluginSources(plugins: string[]): string[] {
  const all = plugins.map((item) => item.toLowerCase()).filter(Boolean);
  const dedup = new Set(all);
  return Array.from(dedup);
}

export function isPluginSource(value: string): value is PanSouPluginSource {
  return (PANSOU_PLUGIN_SOURCES as readonly string[]).includes(value);
}
