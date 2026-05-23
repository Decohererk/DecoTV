import type {
  PrivateLibraryConfig,
  PrivateLibraryConnector,
} from './admin.types';

export type PrivateLibraryConnectorType =
  | 'openlist'
  | 'emby'
  | 'jellyfin'
  | 'xiaoya';

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function sanitizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => sanitizeString(item))
    .filter(Boolean)
    .slice(0, 100);
}

function createConnectorId(type: PrivateLibraryConnectorType): string {
  return `${type}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function getDefaultConnectorName(type: PrivateLibraryConnectorType): string {
  switch (type) {
    case 'xiaoya':
      return '我的小雅';
    case 'openlist':
      return '我的 OpenList';
    case 'emby':
      return '我的 Emby';
    case 'jellyfin':
      return '我的 Jellyfin';
    default:
      return '我的影库';
  }
}

function getDefaultRootPath(type: PrivateLibraryConnectorType): string {
  return type === 'xiaoya' ? '/' : '/Media';
}

export function normalizePrivateLibraryConfig(
  value: unknown,
): PrivateLibraryConfig {
  if (!value || typeof value !== 'object') {
    return { connectors: [] };
  }

  const raw = value as Partial<PrivateLibraryConfig>;
  if (!Array.isArray(raw.connectors)) {
    return { connectors: [] };
  }

  const now = Date.now();
  const connectors = raw.connectors
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }

      const c = item as Partial<PrivateLibraryConnector>;
      const type = c.type;
      if (
        type !== 'openlist' &&
        type !== 'emby' &&
        type !== 'jellyfin' &&
        type !== 'xiaoya'
      ) {
        return null;
      }

      const serverUrl = normalizeUrl(sanitizeString(c.serverUrl));
      if (!serverUrl) {
        return null;
      }

      return {
        id: sanitizeString(c.id) || createConnectorId(type),
        name: sanitizeString(c.name) || getDefaultConnectorName(type),
        displayName: sanitizeString(c.displayName),
        type,
        enabled: c.enabled !== false,
        serverUrl,
        token: sanitizeString(c.token),
        alistToken: '',
        username: sanitizeString(c.username),
        password: sanitizeString(c.password),
        rootPath: sanitizeString(c.rootPath) || getDefaultRootPath(type),
        userId: sanitizeString(c.userId),
        libraryFilter: sanitizeStringArray(c.libraryFilter),
        createdAt:
          typeof c.createdAt === 'number' && Number.isFinite(c.createdAt)
            ? c.createdAt
            : now,
        updatedAt:
          typeof c.updatedAt === 'number' && Number.isFinite(c.updatedAt)
            ? c.updatedAt
            : now,
      } as PrivateLibraryConnector;
    })
    .filter((item): item is PrivateLibraryConnector => Boolean(item));

  return { connectors };
}
