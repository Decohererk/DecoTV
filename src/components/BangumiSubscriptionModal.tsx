'use client';

import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock3,
  Download,
  Loader2,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  BangumiSubscription,
  BangumiSubscriptionStatus,
  BangumiSubscriptionUpdate,
  formatBangumiInterval,
  formatBangumiTime,
} from '@/lib/bangumi-subscription';

import ExternalImage from './ExternalImage';

export interface BangumiSubscriptionModalProps {
  isOpen: boolean;
  subscriptions: BangumiSubscription[];
  onClose: () => void;
  onCheck: (
    subscriptionId: string,
    options?: { force?: boolean },
  ) => Promise<void>;
  onCheckAll: (options?: { force?: boolean }) => Promise<void>;
  onRemove: (subscriptionId: string) => void;
  onUpdate: (subscriptionId: string, update: BangumiSubscriptionUpdate) => void;
  onOpenDownloadManager: () => void;
}

const STATUS_LABELS: Record<BangumiSubscriptionStatus, string> = {
  idle: '已同步',
  checking: '检查中',
  updated: '有更新',
  cached: '已缓存',
  error: '失败',
};

const STATUS_STYLES: Record<BangumiSubscriptionStatus, string> = {
  idle: 'border-slate-300/70 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  checking:
    'border-cyan-300/70 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/15 dark:text-cyan-200',
  updated:
    'border-amber-300/70 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200',
  cached:
    'border-emerald-300/70 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/15 dark:text-emerald-200',
  error:
    'border-red-300/70 bg-red-50 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-200',
};

const INTERVAL_OPTIONS = [
  { label: '6 小时', value: 6 },
  { label: '12 小时', value: 12 },
  { label: '每天', value: 24 },
  { label: '2 天', value: 48 },
  { label: '7 天', value: 168 },
];

function statusIcon(status: BangumiSubscriptionStatus) {
  if (status === 'checking') {
    return <Loader2 className='h-3.5 w-3.5 animate-spin' />;
  }
  if (status === 'error') {
    return <AlertTriangle className='h-3.5 w-3.5' />;
  }
  if (status === 'cached') {
    return <CheckCircle2 className='h-3.5 w-3.5' />;
  }
  return <Clock3 className='h-3.5 w-3.5' />;
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <label className='inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300'>
      <input
        type='checkbox'
        className='sr-only'
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={`relative h-5 w-9 rounded-full transition-colors ${
          checked ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0'
          }`}
        />
      </span>
      <span>{label}</span>
    </label>
  );
}

function BangumiSubscriptionModal({
  isOpen,
  subscriptions,
  onClose,
  onCheck,
  onCheckAll,
  onRemove,
  onUpdate,
  onOpenDownloadManager,
}: BangumiSubscriptionModalProps) {
  const [mounted, setMounted] = useState(false);
  const [checkingAll, setCheckingAll] = useState(false);
  const [checkingIds, setCheckingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isOpen]);

  const sortedSubscriptions = useMemo(
    () => [...subscriptions].sort((a, b) => b.updatedAt - a.updatedAt),
    [subscriptions],
  );

  const enabledCount = useMemo(
    () => subscriptions.filter((item) => item.enabled).length,
    [subscriptions],
  );

  const handleCheck = async (subscriptionId: string) => {
    setCheckingIds((prev) => new Set(prev).add(subscriptionId));
    try {
      await onCheck(subscriptionId, { force: true });
    } finally {
      setCheckingIds((prev) => {
        const next = new Set(prev);
        next.delete(subscriptionId);
        return next;
      });
    }
  };

  const handleCheckAll = async () => {
    setCheckingAll(true);
    try {
      await onCheckAll({ force: true });
    } finally {
      setCheckingAll(false);
    }
  };

  if (!mounted || !isOpen) return null;

  return createPortal(
    <>
      <div
        className='fixed inset-0 z-[1005] bg-black/55 backdrop-blur-sm'
        onClick={onClose}
      />
      <div className='fixed left-1/2 top-1/2 z-[1006] flex max-h-[90vh] w-[min(95vw,980px)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-white/10 dark:bg-slate-950/95'>
        <div className='flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10 sm:px-6'>
          <div>
            <div className='flex items-center gap-2'>
              <Bell className='h-5 w-5 text-emerald-500' />
              <h2 className='text-lg font-semibold text-slate-900 dark:text-white'>
                追番缓存
              </h2>
            </div>
            <p className='mt-1 text-xs text-slate-500 dark:text-slate-400'>
              {subscriptions.length} 个订阅 · {enabledCount} 个启用
            </p>
          </div>

          <div className='flex items-center gap-2'>
            <button
              type='button'
              onClick={handleCheckAll}
              disabled={checkingAll || subscriptions.length === 0}
              className='inline-flex items-center gap-1.5 rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-200'
            >
              {checkingAll ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <RefreshCcw className='h-4 w-4' />
              )}
              全部检查
            </button>
            <button
              type='button'
              onClick={onOpenDownloadManager}
              className='inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
            >
              <Download className='h-4 w-4' />
              下载管理
            </button>
            <button
              type='button'
              onClick={onClose}
              className='rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white'
              aria-label='关闭追番缓存'
            >
              <X className='h-5 w-5' />
            </button>
          </div>
        </div>

        <div className='overflow-y-auto p-4 sm:p-6'>
          {sortedSubscriptions.length === 0 ? (
            <div className='rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-slate-300'>
              暂无追番订阅
            </div>
          ) : (
            <div className='grid gap-3'>
              {sortedSubscriptions.map((subscription) => {
                const status = checkingIds.has(subscription.id)
                  ? 'checking'
                  : subscription.status;
                return (
                  <article
                    key={subscription.id}
                    className='rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-white/10 dark:bg-white/5 sm:p-4'
                  >
                    <div className='flex gap-3'>
                      <div className='relative h-24 w-16 shrink-0 overflow-hidden rounded-lg bg-slate-200 dark:bg-slate-800'>
                        <ExternalImage
                          src={subscription.cover}
                          alt={subscription.title}
                          fill
                          className='object-cover'
                          sizes='64px'
                          proxyWidth={160}
                        />
                      </div>

                      <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-start justify-between gap-2'>
                          <div className='min-w-0'>
                            <h3 className='truncate text-base font-semibold text-slate-900 dark:text-slate-100'>
                              {subscription.title}
                            </h3>
                            <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400'>
                              <span>{subscription.sourceName}</span>
                              {subscription.year &&
                                subscription.year !== 'unknown' && (
                                  <span>{subscription.year}</span>
                                )}
                              <span>
                                已知 {subscription.lastKnownEpisodeCount} 集
                              </span>
                              <span>
                                {formatBangumiInterval(
                                  subscription.intervalHours,
                                )}
                              </span>
                            </div>
                          </div>

                          <span
                            className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-medium ${STATUS_STYLES[status]}`}
                          >
                            {statusIcon(status)}
                            {STATUS_LABELS[status]}
                          </span>
                        </div>

                        <div className='mt-3 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end'>
                          <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-4'>
                            <Toggle
                              checked={subscription.enabled}
                              onChange={(checked) =>
                                onUpdate(subscription.id, {
                                  enabled: checked,
                                })
                              }
                              label='启用'
                            />
                            <Toggle
                              checked={subscription.autoCache}
                              onChange={(checked) =>
                                onUpdate(subscription.id, {
                                  autoCache: checked,
                                })
                              }
                              label='自动缓存'
                            />
                            <label className='flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-300'>
                              <span>周期</span>
                              <select
                                value={subscription.intervalHours}
                                onChange={(event) =>
                                  onUpdate(subscription.id, {
                                    intervalHours: Number(event.target.value),
                                  })
                                }
                                className='rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 outline-none transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
                              >
                                {INTERVAL_OPTIONS.map((option) => (
                                  <option
                                    key={option.value}
                                    value={option.value}
                                  >
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className='flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300'>
                              <span>方式</span>
                              <button
                                type='button'
                                onClick={() =>
                                  onUpdate(subscription.id, {
                                    downloadChannel: 'browser',
                                  })
                                }
                                className={`rounded-lg px-2 py-1 transition ${
                                  subscription.downloadChannel === 'browser'
                                    ? 'bg-emerald-500 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                                }`}
                              >
                                浏览器
                              </button>
                              <button
                                type='button'
                                onClick={() =>
                                  onUpdate(subscription.id, {
                                    downloadChannel: 'ffmpeg',
                                  })
                                }
                                className={`rounded-lg px-2 py-1 transition ${
                                  subscription.downloadChannel === 'ffmpeg'
                                    ? 'bg-amber-500 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                                }`}
                              >
                                FFmpeg
                              </button>
                            </div>
                          </div>

                          <div className='flex items-center gap-2'>
                            <button
                              type='button'
                              onClick={() => handleCheck(subscription.id)}
                              disabled={checkingIds.has(subscription.id)}
                              className='inline-flex items-center gap-1.5 rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-700 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:text-cyan-200'
                            >
                              {checkingIds.has(subscription.id) ? (
                                <Loader2 className='h-3.5 w-3.5 animate-spin' />
                              ) : (
                                <RefreshCcw className='h-3.5 w-3.5' />
                              )}
                              检查
                            </button>
                            <button
                              type='button'
                              onClick={() => onRemove(subscription.id)}
                              className='inline-flex items-center gap-1.5 rounded-lg border border-red-400/35 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-500/20 dark:text-red-200'
                            >
                              <Trash2 className='h-3.5 w-3.5' />
                              删除
                            </button>
                          </div>
                        </div>

                        <div className='mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400'>
                          <span>
                            上次 {formatBangumiTime(subscription.lastCheckedAt)}
                          </span>
                          <span>
                            下次 {formatBangumiTime(subscription.nextCheckAt)}
                          </span>
                          {subscription.lastCachedEpisodeCount ? (
                            <span className='text-emerald-600 dark:text-emerald-300'>
                              已加入 {subscription.lastCachedEpisodeCount} 集
                            </span>
                          ) : null}
                          {subscription.lastError ? (
                            <span className='text-red-600 dark:text-red-300'>
                              {subscription.lastError}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}

export default BangumiSubscriptionModal;
