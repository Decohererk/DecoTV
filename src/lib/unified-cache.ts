/**
 * 统一缓存管理系统 (Unified Cache System) - 纯客户端版
 *
 * 极简设计：仅保留 Memory + localStorage，无需后端支持
 * - 内存缓存 (~0ms)：LRU 策略，页面刷新后失效
 * - localStorage (~5ms)：持久化，跨会话保留
 *
 * 参考 LunaTV "查询参数路由 + 混合缓存系统" 架构
 */

'use client';

// ============ 类型定义 ============

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

interface CacheConfig {
  enableMemory?: boolean;
  enableLocalStorage?: boolean;
  defaultTTL?: number;
  maxMemoryEntries?: number;
  localStoragePrefix?: string;
}

// ============ 内存缓存 (LRU) ============

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    if (this.store.size >= this.maxSize) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }
    this.store.set(key, { data, timestamp: Date.now(), ttl: ttlSeconds });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;

    const elapsed = (Date.now() - entry.timestamp) / 1000;
    if (elapsed > entry.ttl) {
      this.store.delete(key);
      return null;
    }

    // LRU: 移动到末尾
    this.store.delete(key);
    this.store.set(key, entry);
    return entry.data as T;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ============ localStorage 缓存 ============

class LocalStorageCache {
  private prefix: string;

  constructor(prefix = 'deco-cache:') {
    this.prefix = prefix;
  }

  private getFullKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  set<T>(key: string, data: T, ttlSeconds: number): void {
    if (typeof localStorage === 'undefined') return;

    const fullKey = this.getFullKey(key);
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl: ttlSeconds,
    };

    try {
      localStorage.setItem(fullKey, JSON.stringify(entry));
    } catch {
      // localStorage 已满，清理过期数据后重试
      this.cleanExpired();
      try {
        localStorage.setItem(fullKey, JSON.stringify(entry));
      } catch {
        // 仍然失败，忽略
      }
    }
  }

  get<T>(key: string): T | null {
    if (typeof localStorage === 'undefined') return null;

    const fullKey = this.getFullKey(key);
    const stored = localStorage.getItem(fullKey);
    if (!stored) return null;

    try {
      const entry = JSON.parse(stored) as CacheEntry<T>;
      const elapsed = (Date.now() - entry.timestamp) / 1000;

      if (elapsed > entry.ttl) {
        localStorage.removeItem(fullKey);
        return null;
      }

      return entry.data;
    } catch {
      localStorage.removeItem(fullKey);
      return null;
    }
  }

  delete(key: string): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(this.getFullKey(key));
  }

  cleanExpired(): number {
    if (typeof localStorage === 'undefined') return 0;

    const keysToDelete: string[] = [];
    const now = Date.now();

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(this.prefix)) continue;

      try {
        const stored = localStorage.getItem(key);
        if (!stored) continue;

        const entry = JSON.parse(stored) as CacheEntry<unknown>;
        if ((now - entry.timestamp) / 1000 > entry.ttl) {
          keysToDelete.push(key);
        }
      } catch {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => localStorage.removeItem(key));
    return keysToDelete.length;
  }

  clear(): void {
    if (typeof localStorage === 'undefined') return;

    const keysToDelete: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach((key) => localStorage.removeItem(key));
  }
}

// ============ 统一缓存管理器 ============

export class UnifiedCache {
  private memoryCache: MemoryCache;
  private localStorageCache: LocalStorageCache;
  private config: Required<CacheConfig>;

  constructor(config: CacheConfig = {}) {
    this.config = {
      enableMemory: config.enableMemory ?? true,
      enableLocalStorage: config.enableLocalStorage ?? true,
      defaultTTL: config.defaultTTL ?? 3600,
      maxMemoryEntries: config.maxMemoryEntries ?? 100,
      localStoragePrefix: config.localStoragePrefix ?? 'deco-cache:',
    };

    this.memoryCache = new MemoryCache(this.config.maxMemoryEntries);
    this.localStorageCache = new LocalStorageCache(
      this.config.localStoragePrefix,
    );
  }

  /**
   * 同步获取缓存（无需 await）
   * 优先级：Memory → localStorage
   */
  get<T>(key: string): T | null {
    // 第一层：内存 (~0ms)
    if (this.config.enableMemory) {
      const data = this.memoryCache.get<T>(key);
      if (data !== null) return data;
    }

    // 第二层：localStorage (~5ms)
    if (this.config.enableLocalStorage) {
      const data = this.localStorageCache.get<T>(key);
      if (data !== null) {
        // 回填到内存
        if (this.config.enableMemory) {
          this.memoryCache.set(key, data, this.config.defaultTTL);
        }
        return data;
      }
    }

    return null;
  }

  /**
   * 同步设置缓存
   */
  set<T>(key: string, data: T, ttlSeconds = this.config.defaultTTL): void {
    if (this.config.enableMemory) {
      this.memoryCache.set(key, data, ttlSeconds);
    }
    if (this.config.enableLocalStorage) {
      this.localStorageCache.set(key, data, ttlSeconds);
    }
  }

  delete(key: string): void {
    this.memoryCache.delete(key);
    this.localStorageCache.delete(key);
  }

  cleanExpired(): void {
    this.localStorageCache.cleanExpired();
  }

  clear(): void {
    this.memoryCache.clear();
    this.localStorageCache.clear();
  }

  getStats(): { memorySize: number } {
    return { memorySize: this.memoryCache.size };
  }
}

// ============ 全局实例 ============

export const globalCache = new UnifiedCache({
  enableMemory: true,
  enableLocalStorage: true,
  defaultTTL: 3600, // 1 小时
  maxMemoryEntries: 100,
  localStoragePrefix: 'deco-cache:',
});

// ============ 辅助函数 ============

export function generateCacheKey(
  prefix: string,
  params: Record<string, string | number | boolean | undefined>,
): string {
  const filteredParams = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return `${prefix}-${filteredParams}`;
}
