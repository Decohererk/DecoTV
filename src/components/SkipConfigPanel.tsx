'use client';

import { Clock, FastForward, Settings, X } from 'lucide-react';
import { useEffect, useState } from 'react';

export interface SkipConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: {
    enable: boolean;
    intro_time: number; // 片头时长（秒）
    outro_time: number; // 片尾时长（负数，表示距离结尾的秒数）
  };
  onChange: (config: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
  }) => void;
  videoDuration: number; // 视频总时长
  currentTime: number; // 当前播放时间
}

export default function SkipConfigPanel({
  isOpen,
  onClose,
  config,
  onChange,
  videoDuration,
  currentTime,
}: SkipConfigPanelProps) {
  const [mode, setMode] = useState<'seconds' | 'timestamp'>('seconds');
  const [tempConfig, setTempConfig] = useState(config);

  // 当配置变化时更新临时配置
  useEffect(() => {
    setTempConfig(config);
  }, [config]);

  // 格式化时间显示
  const formatTime = (seconds: number): string => {
    if (seconds === 0) return '00:00';

    const absSeconds = Math.abs(seconds);
    const hours = Math.floor(absSeconds / 3600);
    const minutes = Math.floor((absSeconds % 3600) / 60);
    const remainingSeconds = Math.round(absSeconds % 60);

    if (hours === 0) {
      return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
        .toString()
        .padStart(2, '0')}`;
    } else {
      return `${hours.toString().padStart(2, '0')}:${minutes
        .toString()
        .padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
  };

  // 使用当前播放时间设置片头
  const handleSetIntroFromCurrentTime = () => {
    setTempConfig((prev) => ({
      ...prev,
      intro_time: Math.floor(currentTime),
    }));
  };

  // 使用当前播放时间设置片尾
  const handleSetOutroFromCurrentTime = () => {
    const outroTime = -(videoDuration - currentTime);
    setTempConfig((prev) => ({
      ...prev,
      outro_time: Math.floor(outroTime),
    }));
  };

  // 保存配置
  const handleSave = () => {
    onChange(tempConfig);
    onClose();
  };

  // 重置配置
  const handleReset = () => {
    setTempConfig({
      enable: false,
      intro_time: 0,
      outro_time: 0,
    });
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4 animate-fadeIn'>
      <div
        className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-slideUp'
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className='relative bg-gradient-to-r from-purple-600 via-pink-500 to-indigo-600 p-6'>
          <div className='flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <div className='bg-white/20 backdrop-blur-sm p-3 rounded-xl'>
                <FastForward className='w-6 h-6 text-white' />
              </div>
              <div>
                <h2 className='text-2xl font-bold text-white'>
                  跳过片头片尾设置
                </h2>
                <p className='text-white/80 text-sm mt-1'>
                  自动跳过开头和结尾，享受无缝追剧体验
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className='text-white/80 hover:text-white hover:bg-white/20 p-2 rounded-lg transition-all'
            >
              <X className='w-6 h-6' />
            </button>
          </div>

          {/* 总开关 */}
          <div className='mt-4 bg-white/10 backdrop-blur-md rounded-xl p-4 flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <Settings className='w-5 h-5 text-white' />
              <span className='text-white font-medium'>启用跳过功能</span>
            </div>
            <button
              onClick={() =>
                setTempConfig((prev) => ({ ...prev, enable: !prev.enable }))
              }
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors ${
                tempConfig.enable ? 'bg-white' : 'bg-white/30'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                  tempConfig.enable
                    ? 'translate-x-8 bg-gradient-to-r from-purple-600 to-pink-500'
                    : 'translate-x-1 bg-gray-400'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 内容区 - 使用 flex-1 和 overflow-y-auto */}
        <div className='flex-1 overflow-y-auto p-6'>
          {/* 模式切换 */}
          <div className='mb-6'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
              设置模式
            </label>
            <div className='flex gap-3'>
              <button
                onClick={() => setMode('seconds')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
                  mode === 'seconds'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-lg scale-105'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <div className='flex items-center justify-center space-x-2'>
                  <Clock className='w-4 h-4' />
                  <span>秒数模式</span>
                </div>
                <p className='text-xs mt-1 opacity-80'>例如: 90秒</p>
              </button>
              <button
                onClick={() => setMode('timestamp')}
                className={`flex-1 py-3 px-4 rounded-xl font-medium transition-all ${
                  mode === 'timestamp'
                    ? 'bg-gradient-to-r from-purple-600 to-pink-500 text-white shadow-lg scale-105'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                <div className='flex items-center justify-center space-x-2'>
                  <FastForward className='w-4 h-4' />
                  <span>时间戳模式</span>
                </div>
                <p className='text-xs mt-1 opacity-80'>例如: 1:30</p>
              </button>
            </div>
          </div>

          {/* 片头设置 */}
          <div className='mb-6 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/20 dark:to-cyan-900/20 rounded-xl p-5 border-2 border-blue-200 dark:border-blue-700'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center space-x-2'>
                <div className='bg-blue-500 text-white p-2 rounded-lg'>
                  <svg
                    className='w-5 h-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M5 12h14M5 12l6-6m-6 6l6 6'
                    />
                  </svg>
                </div>
                <span>片头设置</span>
              </h3>
              <button
                onClick={handleSetIntroFromCurrentTime}
                className='text-sm bg-blue-500 hover:bg-blue-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1'
              >
                <Clock className='w-3.5 h-3.5' />
                <span>使用当前时间</span>
              </button>
            </div>

            {mode === 'seconds' ? (
              <div>
                <label className='block text-sm text-gray-700 dark:text-gray-300 mb-2'>
                  片头时长（秒）
                </label>
                <div className='flex items-center space-x-3'>
                  <input
                    type='number'
                    min='0'
                    max='3600'
                    value={tempConfig.intro_time}
                    onChange={(e) =>
                      setTempConfig((prev) => ({
                        ...prev,
                        intro_time: parseInt(e.target.value) || 0,
                      }))
                    }
                    className='flex-1 px-4 py-3 border-2 border-blue-300 dark:border-blue-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-mono'
                    placeholder='例如: 90'
                  />
                  <div className='text-gray-600 dark:text-gray-400 font-medium min-w-[80px]'>
                    = {formatTime(tempConfig.intro_time)}
                  </div>
                </div>
                <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                  💡 从 0 秒跳到 {tempConfig.intro_time} 秒处（
                  {formatTime(tempConfig.intro_time)}）
                </p>
              </div>
            ) : (
              <div>
                <label className='block text-sm text-gray-700 dark:text-gray-300 mb-2'>
                  跳到时间点
                </label>
                <div className='flex items-center space-x-2'>
                  <input
                    type='number'
                    min='0'
                    max='23'
                    value={Math.floor(tempConfig.intro_time / 3600)}
                    onChange={(e) => {
                      const hours = parseInt(e.target.value) || 0;
                      const minutes = Math.floor(
                        (tempConfig.intro_time % 3600) / 60,
                      );
                      const seconds = tempConfig.intro_time % 60;
                      setTempConfig((prev) => ({
                        ...prev,
                        intro_time: hours * 3600 + minutes * 60 + seconds,
                      }));
                    }}
                    className='w-20 px-3 py-3 border-2 border-blue-300 dark:border-blue-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-mono text-center'
                    placeholder='时'
                  />
                  <span className='text-xl font-bold text-gray-500'>:</span>
                  <input
                    type='number'
                    min='0'
                    max='59'
                    value={Math.floor((tempConfig.intro_time % 3600) / 60)}
                    onChange={(e) => {
                      const hours = Math.floor(tempConfig.intro_time / 3600);
                      const minutes = parseInt(e.target.value) || 0;
                      const seconds = tempConfig.intro_time % 60;
                      setTempConfig((prev) => ({
                        ...prev,
                        intro_time: hours * 3600 + minutes * 60 + seconds,
                      }));
                    }}
                    className='w-20 px-3 py-3 border-2 border-blue-300 dark:border-blue-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-mono text-center'
                    placeholder='分'
                  />
                  <span className='text-xl font-bold text-gray-500'>:</span>
                  <input
                    type='number'
                    min='0'
                    max='59'
                    value={tempConfig.intro_time % 60}
                    onChange={(e) => {
                      const hours = Math.floor(tempConfig.intro_time / 3600);
                      const minutes = Math.floor(
                        (tempConfig.intro_time % 3600) / 60,
                      );
                      const seconds = parseInt(e.target.value) || 0;
                      setTempConfig((prev) => ({
                        ...prev,
                        intro_time: hours * 3600 + minutes * 60 + seconds,
                      }));
                    }}
                    className='w-20 px-3 py-3 border-2 border-blue-300 dark:border-blue-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg font-mono text-center'
                    placeholder='秒'
                  />
                </div>
                <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                  💡 从 0:00 跳到 {formatTime(tempConfig.intro_time)}
                </p>
              </div>
            )}
          </div>

          {/* 片尾设置 */}
          <div className='mb-6 bg-gradient-to-br from-orange-50 to-red-50 dark:from-orange-900/20 dark:to-red-900/20 rounded-xl p-5 border-2 border-orange-200 dark:border-orange-700'>
            <div className='flex items-center justify-between mb-4'>
              <h3 className='text-lg font-semibold text-gray-800 dark:text-gray-200 flex items-center space-x-2'>
                <div className='bg-orange-500 text-white p-2 rounded-lg'>
                  <svg
                    className='w-5 h-5'
                    fill='none'
                    stroke='currentColor'
                    viewBox='0 0 24 24'
                  >
                    <path
                      strokeLinecap='round'
                      strokeLinejoin='round'
                      strokeWidth={2}
                      d='M19 12H5m14 0l-6 6m6-6l-6-6'
                    />
                  </svg>
                </div>
                <span>片尾设置</span>
              </h3>
              <button
                onClick={handleSetOutroFromCurrentTime}
                className='text-sm bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition-colors flex items-center space-x-1'
              >
                <Clock className='w-3.5 h-3.5' />
                <span>使用当前时间</span>
              </button>
            </div>

            {mode === 'seconds' ? (
              <div>
                <label className='block text-sm text-gray-700 dark:text-gray-300 mb-2'>
                  片尾提前跳转时间（秒）
                </label>
                <div className='flex items-center space-x-3'>
                  <input
                    type='number'
                    min='0'
                    max='3600'
                    value={Math.abs(tempConfig.outro_time)}
                    onChange={(e) =>
                      setTempConfig((prev) => ({
                        ...prev,
                        outro_time: -(parseInt(e.target.value) || 0),
                      }))
                    }
                    className='flex-1 px-4 py-3 border-2 border-orange-300 dark:border-orange-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-lg font-mono'
                    placeholder='例如: 180'
                  />
                  <div className='text-gray-600 dark:text-gray-400 font-medium min-w-[80px]'>
                    提前 {formatTime(Math.abs(tempConfig.outro_time))}
                  </div>
                </div>
                <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                  💡 距离结尾还有 {Math.abs(tempConfig.outro_time)}{' '}
                  秒时自动跳转下一集
                </p>
              </div>
            ) : (
              <div>
                <label className='block text-sm text-gray-700 dark:text-gray-300 mb-2'>
                  片尾开始时间点
                </label>
                <div className='flex items-center space-x-2'>
                  <input
                    type='number'
                    min='0'
                    max='23'
                    value={
                      videoDuration > 0
                        ? Math.floor(
                            (videoDuration + tempConfig.outro_time) / 3600,
                          )
                        : 0
                    }
                    onChange={(e) => {
                      const hours = parseInt(e.target.value) || 0;
                      const currentOutroTime =
                        videoDuration + tempConfig.outro_time;
                      const minutes = Math.floor(
                        (currentOutroTime % 3600) / 60,
                      );
                      const seconds = currentOutroTime % 60;
                      const newOutroTime =
                        hours * 3600 + minutes * 60 + seconds;
                      setTempConfig((prev) => ({
                        ...prev,
                        outro_time: newOutroTime - videoDuration,
                      }));
                    }}
                    className='w-20 px-3 py-3 border-2 border-orange-300 dark:border-orange-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-lg font-mono text-center'
                    placeholder='时'
                  />
                  <span className='text-xl font-bold text-gray-500'>:</span>
                  <input
                    type='number'
                    min='0'
                    max='59'
                    value={
                      videoDuration > 0
                        ? Math.floor(
                            ((videoDuration + tempConfig.outro_time) % 3600) /
                              60,
                          )
                        : 0
                    }
                    onChange={(e) => {
                      const currentOutroTime =
                        videoDuration + tempConfig.outro_time;
                      const hours = Math.floor(currentOutroTime / 3600);
                      const minutes = parseInt(e.target.value) || 0;
                      const seconds = currentOutroTime % 60;
                      const newOutroTime =
                        hours * 3600 + minutes * 60 + seconds;
                      setTempConfig((prev) => ({
                        ...prev,
                        outro_time: newOutroTime - videoDuration,
                      }));
                    }}
                    className='w-20 px-3 py-3 border-2 border-orange-300 dark:border-orange-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-lg font-mono text-center'
                    placeholder='分'
                  />
                  <span className='text-xl font-bold text-gray-500'>:</span>
                  <input
                    type='number'
                    min='0'
                    max='59'
                    value={
                      videoDuration > 0
                        ? (videoDuration + tempConfig.outro_time) % 60
                        : 0
                    }
                    onChange={(e) => {
                      const currentOutroTime =
                        videoDuration + tempConfig.outro_time;
                      const hours = Math.floor(currentOutroTime / 3600);
                      const minutes = Math.floor(
                        (currentOutroTime % 3600) / 60,
                      );
                      const seconds = parseInt(e.target.value) || 0;
                      const newOutroTime =
                        hours * 3600 + minutes * 60 + seconds;
                      setTempConfig((prev) => ({
                        ...prev,
                        outro_time: newOutroTime - videoDuration,
                      }));
                    }}
                    className='w-20 px-3 py-3 border-2 border-orange-300 dark:border-orange-600 rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-orange-500 focus:border-transparent text-lg font-mono text-center'
                    placeholder='秒'
                  />
                </div>
                <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                  💡 播放到{' '}
                  {videoDuration > 0
                    ? formatTime(videoDuration + tempConfig.outro_time)
                    : '00:00'}{' '}
                  时自动跳转下一集
                </p>
              </div>
            )}
          </div>

          {/* 预览信息 */}
          {tempConfig.enable && (
            <div className='bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-900/20 dark:to-emerald-900/20 rounded-xl p-4 border-2 border-green-200 dark:border-green-700'>
              <h4 className='font-semibold text-gray-800 dark:text-gray-200 mb-3 flex items-center space-x-2'>
                <svg
                  className='w-5 h-5 text-green-600'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  />
                </svg>
                <span>跳过效果预览</span>
              </h4>
              <div className='space-y-2 text-sm text-gray-700 dark:text-gray-300'>
                {tempConfig.intro_time > 0 && (
                  <p className='flex items-center space-x-2'>
                    <span className='text-blue-600 dark:text-blue-400'>
                      ▶️ 片头:
                    </span>
                    <span>
                      自动从 <strong>0:00</strong> 跳到{' '}
                      <strong>{formatTime(tempConfig.intro_time)}</strong>
                    </span>
                  </p>
                )}
                {tempConfig.outro_time < 0 && (
                  <p className='flex items-center space-x-2'>
                    <span className='text-orange-600 dark:text-orange-400'>
                      ⏭️ 片尾:
                    </span>
                    <span>
                      播放到{' '}
                      <strong>
                        {videoDuration > 0
                          ? formatTime(videoDuration + tempConfig.outro_time)
                          : '结尾'}
                      </strong>{' '}
                      时自动跳转下一集
                    </span>
                  </p>
                )}
                {tempConfig.intro_time === 0 && tempConfig.outro_time === 0 && (
                  <p className='text-gray-500 dark:text-gray-400'>
                    请设置片头或片尾时间
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 - 固定在底部 */}
        <div className='flex-shrink-0 p-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between'>
          <button
            onClick={handleReset}
            className='px-4 py-2.5 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors font-medium text-sm'
          >
            重置设置
          </button>
          <div className='flex space-x-3'>
            <button
              onClick={onClose}
              className='px-5 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium text-sm'
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className='px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-500 text-white rounded-lg hover:from-purple-700 hover:to-pink-600 transition-all shadow-lg hover:shadow-xl transform hover:scale-105 font-medium text-sm'
            >
              保存设置
            </button>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }

        @keyframes slideUp {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }

        .animate-slideUp {
          animation: slideUp 0.3s ease-out;
        }
      `}</style>
    </div>
  );
}
