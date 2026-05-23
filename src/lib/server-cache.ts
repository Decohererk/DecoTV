type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const CACHE = new Map<string, CacheEntry<unknown>>();

export function getServerCache<T>(key: string): T | null {
  const entry = CACHE.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    CACHE.delete(key);
    return null;
  }

  return entry.value as T;
}

export function setServerCache<T>(
  key: string,
  value: T,
  ttlSeconds: number,
): void {
  CACHE.set(key, {
    value,
    expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000,
  });
}

export function deleteServerCache(key: string): void {
  CACHE.delete(key);
}
