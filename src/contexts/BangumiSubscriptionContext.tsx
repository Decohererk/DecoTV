'use client';

import dynamic from 'next/dynamic';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  applyBangumiSubscriptionUpdate,
  BangumiSubscription,
  BangumiSubscriptionUpdate,
  createBangumiSubscriptionFromDetail,
  createBangumiSubscriptionId,
  getNextBangumiCheckAt,
  loadBangumiSubscriptions,
  saveBangumiSubscriptions,
} from '@/lib/bangumi-subscription';
import { normalizeDownloadSource } from '@/lib/download-url';
import { SearchResult } from '@/lib/types';

import type { BangumiSubscriptionModalProps } from '@/components/BangumiSubscriptionModal';

import { useDownloadManager } from './DownloadManagerContext';

const BangumiSubscriptionModal = dynamic<BangumiSubscriptionModalProps>(
  () =>
    import('../components/BangumiSubscriptionModal').then((mod) => mod.default),
  { ssr: false },
);

interface SubscribeFromDetailInput {
  source: string;
  videoId: string;
  fallbackTitle: string;
  detail: SearchResult;
  searchTitle?: string;
}

interface BangumiSubscriptionContextValue {
  subscriptions: BangumiSubscription[];
  isManagerOpen: boolean;
  openManager: () => void;
  closeManager: () => void;
  isSubscribed: (source: string, videoId: string) => boolean;
  subscribeFromDetail: (input: SubscribeFromDetailInput) => Promise<void>;
  unsubscribe: (subscriptionId: string) => void;
  updateSubscription: (
    subscriptionId: string,
    update: BangumiSubscriptionUpdate,
  ) => void;
  checkSubscription: (
    subscriptionId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  checkAllSubscriptions: (options?: { force?: boolean }) => Promise<void>;
}

const BangumiSubscriptionContext =
  createContext<BangumiSubscriptionContextValue | null>(null);

function sortSubscriptions(
  subscriptions: BangumiSubscription[],
): BangumiSubscription[] {
  return [...subscriptions].sort((a, b) => b.updatedAt - a.updatedAt);
}

async function readApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.clone().json()) as {
      error?: string;
      details?: string;
    };
    return payload.details || payload.error || fallback;
  } catch {
    return response.text().catch(() => fallback);
  }
}

async function fetchSubscriptionDetail(
  subscription: BangumiSubscription,
): Promise<SearchResult> {
  const params = new URLSearchParams({
    source: subscription.source,
    id: subscription.videoId,
  });
  const response = await fetch(`/api/detail?${params.toString()}`, {
    cache: 'no-store',
  });

  if (!response.ok) {
    const details = await readApiErrorMessage(
      response,
      `检查更新失败 (${response.status})`,
    );
    throw new Error(details);
  }

  return (await response.json()) as SearchResult;
}

function getEpisodeLabel(detail: SearchResult, episodeIndex: number): string {
  return detail.episodes_titles?.[episodeIndex] || `第${episodeIndex + 1}集`;
}

export function BangumiSubscriptionProvider({
  children,
}: {
  children: ReactNode;
}) {
  const {
    enqueueDownload,
    tasks,
    openManager: openDownloadManager,
  } = useDownloadManager();
  const [subscriptions, setSubscriptions] = useState<BangumiSubscription[]>([]);
  const [isManagerOpen, setIsManagerOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const subscriptionsRef = useRef<BangumiSubscription[]>([]);
  const tasksRef = useRef(tasks);
  const checkingIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  useEffect(() => {
    subscriptionsRef.current = subscriptions;
  }, [subscriptions]);

  useEffect(() => {
    const stored = loadBangumiSubscriptions();
    setSubscriptions(stored);
    subscriptionsRef.current = stored;
    setLoaded(true);
  }, []);

  const persist = useCallback(
    (
      updater:
        | BangumiSubscription[]
        | ((current: BangumiSubscription[]) => BangumiSubscription[]),
    ) => {
      setSubscriptions((current) => {
        const next = typeof updater === 'function' ? updater(current) : updater;
        const sorted = sortSubscriptions(next);
        subscriptionsRef.current = sorted;
        saveBangumiSubscriptions(sorted);
        return sorted;
      });
    },
    [],
  );

  const patchSubscription = useCallback(
    (
      subscriptionId: string,
      updater: (current: BangumiSubscription) => BangumiSubscription,
    ) => {
      persist((current) =>
        current.map((item) =>
          item.id === subscriptionId ? updater(item) : item,
        ),
      );
    },
    [persist],
  );

  const openManager = useCallback(() => {
    setIsManagerOpen(true);
  }, []);

  const closeManager = useCallback(() => {
    setIsManagerOpen(false);
  }, []);

  const isSubscribed = useCallback((source: string, videoId: string) => {
    const id = createBangumiSubscriptionId(source, videoId);
    return subscriptionsRef.current.some((item) => item.id === id);
  }, []);

  const subscribeFromDetail = useCallback(
    async ({
      source,
      videoId,
      fallbackTitle,
      detail,
      searchTitle,
    }: SubscribeFromDetailInput) => {
      const nextSubscription = createBangumiSubscriptionFromDetail(
        detail,
        source,
        videoId,
        fallbackTitle,
        searchTitle,
      );

      persist((current) => {
        const existing = current.find(
          (item) => item.id === nextSubscription.id,
        );
        if (!existing) {
          return [nextSubscription, ...current];
        }

        return current.map((item) =>
          item.id === nextSubscription.id
            ? {
                ...item,
                title: nextSubscription.title,
                sourceName: nextSubscription.sourceName,
                cover: nextSubscription.cover,
                year: nextSubscription.year,
                searchTitle: nextSubscription.searchTitle,
                episodeTitles: nextSubscription.episodeTitles,
                lastKnownEpisodeCount: Math.max(
                  item.lastKnownEpisodeCount,
                  nextSubscription.lastKnownEpisodeCount,
                ),
                cachedThroughEpisode: Math.max(
                  item.cachedThroughEpisode,
                  nextSubscription.cachedThroughEpisode,
                ),
                enabled: true,
                updatedAt: Date.now(),
                lastError: undefined,
                status: 'idle',
              }
            : item,
        );
      });
    },
    [persist],
  );

  const unsubscribe = useCallback(
    (subscriptionId: string) => {
      persist((current) =>
        current.filter((item) => item.id !== subscriptionId),
      );
    },
    [persist],
  );

  const updateSubscription = useCallback(
    (subscriptionId: string, update: BangumiSubscriptionUpdate) => {
      patchSubscription(subscriptionId, (current) =>
        applyBangumiSubscriptionUpdate(current, update),
      );
    },
    [patchSubscription],
  );

  const hasExistingEpisodeTask = useCallback(
    (subscriptionId: string, episodeNumber: number, sourceUrl: string) => {
      return tasksRef.current.some((task) => {
        if (
          task.subscriptionId === subscriptionId &&
          task.episodeNumber === episodeNumber
        ) {
          return true;
        }
        return task.sourceUrl === sourceUrl && task.status !== 'error';
      });
    },
    [],
  );

  const enqueueEpisodeCache = useCallback(
    async (
      subscription: BangumiSubscription,
      detail: SearchResult,
      episodeIndex: number,
    ): Promise<'queued' | 'exists' | false> => {
      const rawUrl = detail.episodes?.[episodeIndex];
      if (!rawUrl) return false;

      const episodeNumber = episodeIndex + 1;
      const { sourceUrl, referer, origin } = normalizeDownloadSource(rawUrl);
      if (hasExistingEpisodeTask(subscription.id, episodeNumber, sourceUrl)) {
        return 'exists';
      }

      const episodeLabel = getEpisodeLabel(detail, episodeIndex);
      await enqueueDownload({
        title: `${detail.title || subscription.title} ${episodeLabel}`,
        sourceUrl,
        channel: subscription.downloadChannel,
        referer,
        origin,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        openManager: false,
        subscriptionId: subscription.id,
        episodeNumber,
      });

      return 'queued';
    },
    [enqueueDownload, hasExistingEpisodeTask],
  );

  const checkSubscription = useCallback(
    async (subscriptionId: string, options: { force?: boolean } = {}) => {
      const subscription = subscriptionsRef.current.find(
        (item) => item.id === subscriptionId,
      );
      if (!subscription) return;

      const now = Date.now();
      if (
        !options.force &&
        (!subscription.enabled || subscription.nextCheckAt > now)
      ) {
        return;
      }
      if (checkingIdsRef.current.has(subscriptionId)) return;

      checkingIdsRef.current.add(subscriptionId);
      patchSubscription(subscriptionId, (current) => ({
        ...current,
        status: 'checking',
        lastError: undefined,
        updatedAt: Date.now(),
      }));

      try {
        const detail = await fetchSubscriptionDetail(subscription);
        const episodeCount = detail.episodes?.length || 0;
        let cachedThroughEpisode = subscription.cachedThroughEpisode;
        let cachedCount = 0;

        if (subscription.autoCache && episodeCount > cachedThroughEpisode) {
          for (
            let episodeIndex = cachedThroughEpisode;
            episodeIndex < episodeCount;
            episodeIndex += 1
          ) {
            const cacheResult = await enqueueEpisodeCache(
              subscription,
              detail,
              episodeIndex,
            );
            if (cacheResult) {
              cachedThroughEpisode = episodeIndex + 1;
              if (cacheResult === 'queued') {
                cachedCount += 1;
              }
            } else {
              break;
            }
          }
        } else if (!subscription.autoCache) {
          cachedThroughEpisode = Math.max(cachedThroughEpisode, episodeCount);
        }

        const checkedAt = Date.now();
        const newEpisodeCount = Math.max(
          0,
          episodeCount - subscription.lastKnownEpisodeCount,
        );

        patchSubscription(subscriptionId, (current) => ({
          ...current,
          title: detail.title || current.title,
          sourceName: detail.source_name || current.sourceName,
          cover: detail.poster || current.cover,
          year: detail.year || current.year,
          lastKnownEpisodeCount: Math.max(
            current.lastKnownEpisodeCount,
            episodeCount,
          ),
          cachedThroughEpisode: Math.max(
            current.cachedThroughEpisode,
            cachedThroughEpisode,
          ),
          episodeTitles: detail.episodes_titles || current.episodeTitles,
          lastCheckedAt: checkedAt,
          lastNewEpisodeCount: newEpisodeCount,
          lastCachedEpisodeCount: cachedCount,
          nextCheckAt: getNextBangumiCheckAt(current.intervalHours, checkedAt),
          status:
            cachedCount > 0
              ? 'cached'
              : newEpisodeCount > 0
                ? 'updated'
                : 'idle',
          lastError: undefined,
          updatedAt: checkedAt,
        }));
      } catch (error) {
        const checkedAt = Date.now();
        patchSubscription(subscriptionId, (current) => ({
          ...current,
          status: 'error',
          lastCheckedAt: checkedAt,
          nextCheckAt: getNextBangumiCheckAt(current.intervalHours, checkedAt),
          lastError:
            error instanceof Error ? error.message : '检查追番更新失败',
          updatedAt: checkedAt,
        }));
      } finally {
        checkingIdsRef.current.delete(subscriptionId);
      }
    },
    [enqueueEpisodeCache, patchSubscription],
  );

  const checkAllSubscriptions = useCallback(
    async (options: { force?: boolean } = {}) => {
      const now = Date.now();
      const targets = subscriptionsRef.current.filter((item) => {
        if (options.force) return true;
        return item.enabled && item.nextCheckAt <= now;
      });

      for (const subscription of targets) {
        await checkSubscription(subscription.id, options);
      }
    },
    [checkSubscription],
  );

  useEffect(() => {
    if (!loaded) return;

    const runDueChecks = () => {
      void checkAllSubscriptions();
    };

    const startupTimer = window.setTimeout(runDueChecks, 1500);
    const intervalTimer = window.setInterval(runDueChecks, 60 * 1000);

    return () => {
      window.clearTimeout(startupTimer);
      window.clearInterval(intervalTimer);
    };
  }, [checkAllSubscriptions, loaded]);

  const value = useMemo<BangumiSubscriptionContextValue>(
    () => ({
      subscriptions,
      isManagerOpen,
      openManager,
      closeManager,
      isSubscribed,
      subscribeFromDetail,
      unsubscribe,
      updateSubscription,
      checkSubscription,
      checkAllSubscriptions,
    }),
    [
      checkAllSubscriptions,
      checkSubscription,
      closeManager,
      isManagerOpen,
      isSubscribed,
      openManager,
      subscribeFromDetail,
      subscriptions,
      unsubscribe,
      updateSubscription,
    ],
  );

  return (
    <BangumiSubscriptionContext.Provider value={value}>
      {children}
      {isManagerOpen && (
        <BangumiSubscriptionModal
          isOpen={isManagerOpen}
          subscriptions={subscriptions}
          onClose={closeManager}
          onCheck={checkSubscription}
          onCheckAll={checkAllSubscriptions}
          onRemove={unsubscribe}
          onUpdate={updateSubscription}
          onOpenDownloadManager={() => {
            setIsManagerOpen(false);
            openDownloadManager();
          }}
        />
      )}
    </BangumiSubscriptionContext.Provider>
  );
}

export function useBangumiSubscription() {
  const context = useContext(BangumiSubscriptionContext);
  if (!context) {
    throw new Error(
      'useBangumiSubscription must be used within BangumiSubscriptionProvider',
    );
  }
  return context;
}
