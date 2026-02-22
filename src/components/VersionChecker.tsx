'use client';

import { AlertCircle, CheckCircle, Download, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

import { formatVersionTimestamp } from '@/lib/version';

interface VersionCheckResponse {
  success: boolean;
  current: {
    version: string;
    timestamp: string;
    displayVersion: string;
    updateAvailable: boolean;
  };
  hasUpdate: boolean;
  remote?: {
    version: string;
    timestamp: string;
    releaseNotes?: string[];
    downloadUrl?: string;
  };
}

export default function VersionChecker() {
  const [versionData, setVersionData] = useState<VersionCheckResponse | null>(
    null,
  );
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkVersion = async () => {
    setIsChecking(true);
    setError(null);

    try {
      const response = await fetch('/api/version/check');
      const data: VersionCheckResponse = await response.json();

      if (data.success) {
        setVersionData(data);
        setLastCheck(new Date());
      } else {
        throw new Error('版本检查失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setIsChecking(false);
    }
  };

  useEffect(() => {
    checkVersion();
  }, []);

  if (!versionData) {
    return (
      <div className='animate-pulse'>
        <div className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg'></div>
      </div>
    );
  }

  const hasUpdate = versionData.hasUpdate;
  const current = versionData.current;
  const remote = versionData.remote;

  return (
    <div className='space-y-4'>
      {/* 当前版本信息 */}
      <div
        className={`
        p-4 rounded-lg border-2 transition-all duration-200
        ${
          hasUpdate
            ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800'
            : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
        }
      `}
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center space-x-3'>
            <div className='text-2xl'>{hasUpdate ? '🔄' : '✅'}</div>
            <div>
              <h3
                className={`font-semibold ${
                  hasUpdate
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-green-600 dark:text-green-400'
                }`}
              >
                {current.displayVersion}
              </h3>
              <p
                className={`text-sm ${
                  hasUpdate
                    ? 'text-orange-600 dark:text-orange-400'
                    : 'text-green-600 dark:text-green-400'
                }`}
              >
                {hasUpdate ? '有新版本可用' : '当前已是最新版本'}
              </p>
            </div>
          </div>

          <button
            onClick={checkVersion}
            disabled={isChecking}
            className={`
              flex items-center space-x-2 px-3 py-2 rounded-md text-sm font-medium
              transition-colors
              ${
                isChecking
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed dark:bg-gray-600 dark:text-gray-400'
                  : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60'
              }
            `}
          >
            <RefreshCw
              className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`}
            />
            <span>{isChecking ? '检查中...' : '检查更新'}</span>
          </button>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className='mt-3 flex items-center space-x-2 text-red-600 dark:text-red-400'>
            <AlertCircle className='w-4 h-4' />
            <span className='text-sm'>{error}</span>
          </div>
        )}

        {/* 版本详情 */}
        <div className='mt-4 pt-3 border-t border-gray-200 dark:border-gray-600'>
          <div className='grid grid-cols-1 md:grid-cols-2 gap-3 text-sm'>
            <div>
              <span className='text-gray-600 dark:text-gray-400'>
                构建时间:
              </span>
              <span className='ml-2 font-mono'>
                {formatVersionTimestamp(current.timestamp)}
              </span>
            </div>
            <div>
              <span className='text-gray-600 dark:text-gray-400'>版本号:</span>
              <span className='ml-2 font-mono'>{current.timestamp}</span>
            </div>
            {lastCheck && (
              <div className='md:col-span-2'>
                <span className='text-gray-600 dark:text-gray-400'>
                  上次检查:
                </span>
                <span className='ml-2 text-gray-500 dark:text-gray-400'>
                  {lastCheck.toLocaleString('zh-CN')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 更新提示 */}
      {hasUpdate && remote && (
        <div className='p-4 bg-orange-50 dark:bg-orange-900/20 border-2 border-orange-200 dark:border-orange-800 rounded-lg'>
          <div className='flex items-start justify-between'>
            <div className='flex-1'>
              <div className='flex items-center space-x-2 mb-2'>
                <Download className='w-5 h-5 text-orange-600 dark:text-orange-400' />
                <h4 className='font-semibold text-orange-800 dark:text-orange-200'>
                  发现新版本 v{remote.version}+{remote.timestamp}
                </h4>
              </div>

              <div className='mb-3 space-y-2'>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-orange-700 dark:text-orange-300'>
                    当前版本:
                  </span>
                  <span className='font-mono text-orange-600 dark:text-orange-400'>
                    v{current.version} (构建:{' '}
                    {formatVersionTimestamp(current.timestamp)})
                  </span>
                </div>
                <div className='flex items-center justify-between text-sm'>
                  <span className='text-orange-700 dark:text-orange-300'>
                    最新版本:
                  </span>
                  <span className='font-mono text-orange-600 dark:text-orange-400'>
                    v{remote.version} (构建:{' '}
                    {formatVersionTimestamp(remote.timestamp)})
                  </span>
                </div>
              </div>

              {remote.releaseNotes && remote.releaseNotes.length > 0 && (
                <div className='mb-3'>
                  <p className='text-sm text-orange-700 dark:text-orange-300 mb-2 font-medium'>
                    更新内容:
                  </p>
                  <ul className='text-sm text-orange-600 dark:text-orange-400 space-y-1.5'>
                    {remote.releaseNotes.map((note, index) => (
                      <li key={index} className='flex items-start space-x-2'>
                        <CheckCircle className='w-3.5 h-3.5 shrink-0 mt-0.5' />
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className='text-xs text-orange-600 dark:text-orange-400 mt-2 flex items-center space-x-2'>
                <AlertCircle className='w-3.5 h-3.5' />
                <span>点击前往仓库查看更新详情</span>
              </p>
            </div>

            <a
              href={
                remote.downloadUrl || 'https://github.com/Decohererk/DecoTV'
              }
              target='_blank'
              rel='noopener noreferrer'
              className='
                inline-flex items-center space-x-2 px-4 py-2 ml-4
                bg-linear-to-r from-orange-600 to-red-600 text-white rounded-md text-sm font-medium
                hover:from-orange-700 hover:to-red-700 transition-all shadow-md hover:shadow-lg
                transform hover:scale-105
              '
            >
              <Download className='w-4 h-4' />
              <span>立即更新</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
