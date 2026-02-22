'use client';

import {
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  RefreshCcw,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  DownloadTask,
  formatBytes,
  formatSpeed,
  formatTaskProgress,
} from '@/lib/download-types';

export interface DownloadManagerModalProps {
  isOpen: boolean;
  tasks: DownloadTask[];
  onClose: () => void;
  onPause: (taskId: string) => void;
  onResume: (taskId: string) => void;
  onRetry: (taskId: string) => void;
  onRemove: (taskId: string) => void;
}

const STATUS_LABELS: Record<DownloadTask['status'], string> = {
  queued: '排队中',
  parsing: '解析流地址',
  downloading: '下载中',
  paused: '已暂停',
  merging: '正在合并',
  completed: '已完成',
  error: '下载失败',
};

function DownloadManagerModal({
  isOpen,
  tasks,
  onClose,
  onPause,
  onResume,
  onRetry,
  onRemove,
}: DownloadManagerModalProps) {
  const [mounted, setMounted] = useState(false);

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

  const sortedTasks = useMemo(() => {
    return [...tasks].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [tasks]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <>
      <div
        className='fixed inset-0 z-[1005] bg-black/55 backdrop-blur-sm'
        onClick={onClose}
      />
      <div className='fixed left-1/2 top-1/2 z-[1006] w-[min(95vw,960px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-slate-950/95 shadow-2xl'>
        <div className='flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6'>
          <div>
            <h2 className='text-lg font-semibold text-white'>下载管理</h2>
            <p className='text-xs text-slate-400'>
              分片下载、断点续传、进度追踪
            </p>
          </div>
          <button
            type='button'
            onClick={onClose}
            className='rounded-full p-2 text-slate-300 transition hover:bg-white/10 hover:text-white'
            aria-label='关闭下载管理'
          >
            <X className='h-5 w-5' />
          </button>
        </div>

        <div className='max-h-[70vh] overflow-y-auto p-4 sm:p-6'>
          {sortedTasks.length === 0 ? (
            <div className='rounded-xl border border-dashed border-white/15 bg-white/5 p-8 text-center text-sm text-slate-300'>
              暂无下载任务
            </div>
          ) : (
            <div className='space-y-3'>
              {sortedTasks.map((task) => {
                const progress = formatTaskProgress(task);
                const statusLabel = STATUS_LABELS[task.status];
                const showPause = task.status === 'downloading';
                const showResume =
                  task.status === 'paused' || task.status === 'queued';
                const showRetry = task.status === 'error';
                const isCompleted = task.status === 'completed';

                return (
                  <div
                    key={task.id}
                    className='rounded-xl border border-white/10 bg-white/5 p-3 sm:p-4'
                  >
                    <div className='flex flex-wrap items-start justify-between gap-3'>
                      <div className='min-w-0'>
                        <p className='truncate text-sm font-medium text-slate-100 sm:text-base'>
                          {task.title}
                        </p>
                        <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-300'>
                          <span>{statusLabel}</span>
                          {task.downloadChannel === 'ffmpeg' && (
                            <span className='rounded border border-amber-300/35 bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-200'>
                              FFmpeg 转存
                            </span>
                          )}
                          {task.status === 'downloading' && (
                            <span>速度 {formatSpeed(task.speedBps)}</span>
                          )}
                          {task.status !== 'merging' &&
                            task.totalSegments > 0 && (
                              <span>
                                {task.downloadedSegments}/{task.totalSegments}{' '}
                                分片
                              </span>
                            )}
                          {task.downloadedBytes > 0 && (
                            <span>{formatBytes(task.downloadedBytes)}</span>
                          )}
                        </div>
                      </div>

                      <div className='flex items-center gap-1.5'>
                        {showPause && (
                          <button
                            type='button'
                            onClick={() => onPause(task.id)}
                            className='inline-flex items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-xs text-slate-100 transition hover:bg-white/10'
                          >
                            <Pause className='h-3.5 w-3.5' />
                            暂停
                          </button>
                        )}
                        {showResume && (
                          <button
                            type='button'
                            onClick={() => onResume(task.id)}
                            className='inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 px-2 py-1 text-xs text-emerald-200 transition hover:bg-emerald-500/15'
                          >
                            <Play className='h-3.5 w-3.5' />
                            继续
                          </button>
                        )}
                        {showRetry && (
                          <button
                            type='button'
                            onClick={() => onRetry(task.id)}
                            className='inline-flex items-center gap-1 rounded-lg border border-amber-400/35 px-2 py-1 text-xs text-amber-200 transition hover:bg-amber-500/15'
                          >
                            <RefreshCcw className='h-3.5 w-3.5' />
                            重试
                          </button>
                        )}
                        <button
                          type='button'
                          onClick={() => onRemove(task.id)}
                          className='inline-flex items-center gap-1 rounded-lg border border-red-400/35 px-2 py-1 text-xs text-red-200 transition hover:bg-red-500/15'
                        >
                          <Trash2 className='h-3.5 w-3.5' />
                          删除
                        </button>
                      </div>
                    </div>

                    <div className='mt-3 h-2 overflow-hidden rounded-full bg-slate-800/80'>
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isCompleted
                            ? 'bg-linear-to-r from-emerald-400 to-emerald-500'
                            : 'bg-linear-to-r from-cyan-400 to-blue-500'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>

                    <div className='mt-2 flex items-center justify-between text-xs text-slate-400'>
                      <span>{progress}%</span>
                      <span>
                        {task.status === 'merging' && (
                          <span className='inline-flex items-center gap-1 text-cyan-200'>
                            <Loader2 className='h-3.5 w-3.5 animate-spin' />
                            合并 {Math.min(100, Math.round(task.mergeProgress))}
                            %
                          </span>
                        )}
                        {task.status === 'completed' && (
                          <span className='inline-flex items-center gap-1 text-emerald-200'>
                            <CheckCircle2 className='h-3.5 w-3.5' />
                            已导出
                          </span>
                        )}
                        {task.status === 'error' && task.error && (
                          <span className='text-red-300'>{task.error}</span>
                        )}
                      </span>
                    </div>
                  </div>
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

export default DownloadManagerModal;
