/**
 * 版本检测和管理工具
 * 版本号格式: YYYYMMDDHHMMSS (年月日时分秒)
 */

// 版本常量
const CURRENT_SEMANTIC_VERSION = '1.4.0';
export const CURRENT_VERSION = CURRENT_SEMANTIC_VERSION;

// 硬编码的构建时间戳(每次发布时更新)
// 这是最后的回退值,确保即使所有文件读取都失败也能有一个基准
export const BUILD_TIMESTAMP = '20260326205408';

const DEFAULT_UPDATE_REPO = 'Decohererk/DecoTV';
const UPDATE_REPO = process.env.NEXT_PUBLIC_UPDATE_REPO || DEFAULT_UPDATE_REPO;
const UPDATE_REF = process.env.NEXT_PUBLIC_UPDATE_REF || 'main';
const VERSION_TIMESTAMP_REGEX = /^\d{14}$/;
const REMOTE_FETCH_TIMEOUT = 5000;

export const VERSION_SOURCE_URLS = [
  `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_REF}/VERSION.txt`,
  `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@${UPDATE_REF}/VERSION.txt`,
  `https://fastly.jsdelivr.net/gh/${UPDATE_REPO}@${UPDATE_REF}/VERSION.txt`,
  `https://ghproxy.net/https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_REF}/VERSION.txt`,
];

const PACKAGE_SOURCE_URLS = [
  `https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_REF}/package.json`,
  `https://cdn.jsdelivr.net/gh/${UPDATE_REPO}@${UPDATE_REF}/package.json`,
  `https://fastly.jsdelivr.net/gh/${UPDATE_REPO}@${UPDATE_REF}/package.json`,
  `https://ghproxy.net/https://raw.githubusercontent.com/${UPDATE_REPO}/${UPDATE_REF}/package.json`,
];

export interface VersionInfo {
  version: string; // package.json 版本 (如 "0.2.0")
  timestamp: string; // 时间戳版本 (如 "20251005140531")
  buildTime: Date; // 构建时间
  isLatest: boolean; // 是否为最新版本
  updateAvailable: boolean; // 是否有更新可用
  displayVersion: string; // 显示版本 (如 "v0.2.0")
}

export interface RemoteVersionInfo {
  version: string;
  timestamp: string;
  releaseNotes?: string[];
  downloadUrl?: string;
}

function appendCacheBuster(url: string): string {
  const cacheBuster = `_ts=${Date.now()}`;
  return url.includes('?') ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;
}

export async function fetchPlainTextWithTimeout(
  url: string,
  accept = 'text/plain',
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT);

  try {
    const response = await fetch(appendCacheBuster(url), {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        Accept: accept,
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.text()).trim();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 解析时间戳版本号
 */
export function parseVersionTimestamp(timestamp: string): Date | null {
  if (!/^\d{14}$/.test(timestamp)) {
    return null;
  }

  const year = parseInt(timestamp.slice(0, 4));
  const month = parseInt(timestamp.slice(4, 6)) - 1; // JS 月份从0开始
  const day = parseInt(timestamp.slice(6, 8));
  const hour = parseInt(timestamp.slice(8, 10));
  const minute = parseInt(timestamp.slice(10, 12));
  const second = parseInt(timestamp.slice(12, 14));

  const date = new Date(year, month, day, hour, minute, second);

  // 验证日期是否有效
  if (isNaN(date.getTime())) {
    return null;
  }

  return date;
}

/**
 * 比较两个版本时间戳
 * @param current 当前版本时间戳
 * @param remote 远程版本时间戳
 * @returns 1: 当前版本更新, 0: 版本相同, -1: 远程版本更新
 */
export function compareVersions(current: string, remote: string): number {
  const currentNum = parseInt(current);
  const remoteNum = parseInt(remote);

  if (currentNum > remoteNum) return 1;
  if (currentNum < remoteNum) return -1;
  return 0;
}

/**
 * 格式化版本时间戳为可读格式
 */
export function formatVersionTimestamp(timestamp: string): string {
  const date = parseVersionTimestamp(timestamp);
  if (!date) return timestamp;

  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * 生成当前时间戳版本号
 */
export function generateVersionTimestamp(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = String(now.getHours()).padStart(2, '0');
  const minute = String(now.getMinutes()).padStart(2, '0');
  const second = String(now.getSeconds()).padStart(2, '0');

  return `${year}${month}${day}${hour}${minute}${second}`;
}

/**
 * 获取当前版本信息
 */
/**
 * 获取当前版本信息（基于时间戳）
 */
export async function getCurrentVersionInfo(): Promise<VersionInfo> {
  try {
    // 从 VERSION.txt 获取时间戳版本
    const response = await fetch('/VERSION.txt');
    const timestamp = (await response.text()).trim();

    const buildTime = parseVersionTimestamp(timestamp) || new Date();

    return {
      version: CURRENT_VERSION,
      timestamp,
      buildTime,
      isLatest: true, // 将在 checkForUpdates 中更新
      updateAvailable: false, // 将在 checkForUpdates 中更新
      displayVersion: `v${CURRENT_VERSION}`,
    };
  } catch {
    // 降级处理：使用 VERSION.txt 的默认值
    const timestamp = '20260326205408';
    return {
      version: CURRENT_VERSION,
      timestamp,
      buildTime: parseVersionTimestamp(timestamp) || new Date(),
      isLatest: true,
      updateAvailable: false,
      displayVersion: `v${CURRENT_VERSION}`,
    };
  }
}

/**
 * 从远程获取版本时间戳
 */
async function fetchRemoteVersion(): Promise<string | null> {
  for (const url of VERSION_SOURCE_URLS) {
    const timestamp = await fetchPlainTextWithTimeout(url);
    if (timestamp && VERSION_TIMESTAMP_REGEX.test(timestamp)) {
      return timestamp;
    }
  }

  return null;
}

/**
 * 从远程获取语义版本号
 */
async function fetchRemoteSemanticVersion(): Promise<string | null> {
  for (const url of PACKAGE_SOURCE_URLS) {
    const payload = await fetchPlainTextWithTimeout(url, 'application/json');
    if (!payload) {
      continue;
    }

    try {
      const packageJson = JSON.parse(payload);
      if (typeof packageJson.version === 'string') {
        return packageJson.version;
      }
    } catch {
      // 忽略解析失败，尝试下一个源
      continue;
    }
  }

  return null;
}

/**
 * 检查是否有新版本可用（基于时间戳比较）
 */
export async function checkForUpdates(currentTimestamp: string): Promise<{
  hasUpdate: boolean;
  remoteVersion?: RemoteVersionInfo;
  checkFailed?: boolean;
}> {
  try {
    // 同时获取远程时间戳和语义版本号
    const [remoteTimestamp, remoteSemanticVersion] = await Promise.all([
      fetchRemoteVersion(),
      fetchRemoteSemanticVersion(),
    ]);

    if (!remoteTimestamp) {
      throw new Error('无法获取远程版本信息');
    }

    // 比较时间戳：只有远程时间戳大于当前时间戳才认为有更新
    const comparison = compareVersions(currentTimestamp, remoteTimestamp);
    const hasUpdate = comparison < 0;

    if (hasUpdate) {
      // 使用远程的语义版本号，如果获取失败则使用时间戳后6位
      // 如果远程版本号已经包含 v 前缀，就不再添加
      const displayVersion = remoteSemanticVersion
        ? remoteSemanticVersion.startsWith('v')
          ? remoteSemanticVersion
          : `v${remoteSemanticVersion}`
        : `v${CURRENT_VERSION}+${remoteTimestamp.slice(-6)}`;

      const remoteVersion: RemoteVersionInfo = {
        version: displayVersion,
        timestamp: remoteTimestamp,
        releaseNotes: [
          '发现新版本可用',
          `最新版本: ${displayVersion}`,
          `构建时间: ${formatVersionTimestamp(remoteTimestamp)}`,
          '点击前往仓库查看更新详情',
        ],
        downloadUrl: 'https://github.com/Decohererk/DecoTV/releases',
      };

      return {
        hasUpdate: true,
        remoteVersion,
      };
    }

    return {
      hasUpdate: false,
    };
  } catch {
    // 标记检查失败
    return {
      hasUpdate: false,
      checkFailed: true,
    };
  }
}

/**
 * 获取版本状态文本和颜色
 */
export function getVersionStatusInfo(versionInfo: VersionInfo) {
  if (versionInfo.updateAvailable) {
    return {
      text: '有新版本可用',
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-900/20',
      borderColor: 'border-orange-200 dark:border-orange-800',
      icon: '🔄',
    };
  }

  return {
    text: '当前已是最新版本',
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    icon: '✅',
  };
}

// CURRENT_VERSION 已在文件顶部导出
