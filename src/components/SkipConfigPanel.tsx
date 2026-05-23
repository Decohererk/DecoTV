'use client';

import { Clock, FastForward, Settings, X } from 'lucide-react';
import { type ChangeEventHandler, useEffect, useRef, useState } from 'react';

import { getSkipPresets, saveSkipPresets } from '@/lib/db.client';
import type { SkipPreset } from '@/lib/types';

const MAX_PRESET_COUNT = 20;
const PRESET_CATEGORIES = [
  '通用',
  '动漫',
  '欧美剧',
  '日剧',
  '韩剧',
  '综艺',
  '纪录片',
] as const;

function normalizePresetName(name: string): string {
  return name.trim().slice(0, 20);
}

function sanitizePresetList(input: SkipPreset[]): SkipPreset[] {
  return input
    .map((item): SkipPreset | null => {
      if (!item || typeof item !== 'object') return null;
      const name = normalizePresetName(item.name);
      if (!name) return null;

      return {
        id:
          typeof item.id === 'string' && item.id
            ? item.id
            : `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        category: PRESET_CATEGORIES.includes(
          (item.category || '通用') as (typeof PRESET_CATEGORIES)[number],
        )
          ? (item.category as SkipPreset['category'])
          : '通用',
        pinned: Boolean(item.pinned),
        lastUsedAt: Number(item.lastUsedAt) || 0,
        enable: Boolean(item.enable),
        intro_time: Math.max(0, Number(item.intro_time) || 0),
        outro_time: Math.min(0, Number(item.outro_time) || 0),
        updatedAt: Number(item.updatedAt) || Date.now(),
      };
    })
    .filter((item): item is SkipPreset => item !== null)
    .sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) {
        return a.pinned ? -1 : 1;
      }
      const aLast = a.lastUsedAt || 0;
      const bLast = b.lastUsedAt || 0;
      if (aLast !== bLast) return bLast - aLast;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, MAX_PRESET_COUNT);
}

function inferVideoKind(
  videoTypeName: string,
  videoTitle: string,
): (typeof PRESET_CATEGORIES)[number] {
  const text = `${videoTypeName} ${videoTitle}`.toLowerCase();
  if (/动漫|动画|anime/.test(text)) return '动漫';
  if (/美剧|欧美|英剧/.test(text)) return '欧美剧';
  if (/日剧/.test(text)) return '日剧';
  if (/韩剧/.test(text)) return '韩剧';
  if (/综艺|variety/.test(text)) return '综艺';
  if (/纪录片|documentary/.test(text)) return '纪录片';
  return '通用';
}

export interface SkipConfigPanelProps {
  isOpen: boolean;
  onClose: () => void;
  config: {
    enable: boolean;
    intro_time: number; // 片头时长（秒）
    outro_time: number; // 片尾时长（负数，表示距离结尾的秒数）
    preset_id?: string;
    preset_name?: string;
    preset_category?: SkipPreset['category'];
    preset_pinned?: boolean;
  };
  onChange: (config: {
    enable: boolean;
    intro_time: number;
    outro_time: number;
    preset_id?: string;
    preset_name?: string;
    preset_category?: SkipPreset['category'];
    preset_pinned?: boolean;
  }) => void;
  videoDuration: number; // 视频总时长
  currentTime: number; // 当前播放时间
  videoTitle?: string;
  videoTypeName?: string;
}

export default function SkipConfigPanel({
  isOpen,
  onClose,
  config,
  onChange,
  videoDuration,
  currentTime,
  videoTitle = '',
  videoTypeName = '',
}: SkipConfigPanelProps) {
  const [mode, setMode] = useState<'seconds' | 'timestamp'>('seconds');
  const [tempConfig, setTempConfig] = useState(config);
  const [presets, setPresets] = useState<SkipPreset[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetCategory, setPresetCategory] =
    useState<(typeof PRESET_CATEGORIES)[number]>('通用');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetFeedback, setPresetFeedback] = useState('');
  const [isPresetSyncing, setIsPresetSyncing] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [pendingImportedPresets, setPendingImportedPresets] = useState<
    SkipPreset[]
  >([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  // 当配置变化时更新临时配置
  useEffect(() => {
    setTempConfig(config);
  }, [config]);

  const videoKind = inferVideoKind(videoTypeName, videoTitle);

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setPresetCategory(videoKind);

    const load = async () => {
      const loadedPresets = sanitizePresetList(await getSkipPresets());
      if (cancelled) return;
      setPresets(loadedPresets);
      setSelectedPresetId((prev) => {
        if (
          config.preset_id &&
          loadedPresets.some((item) => item.id === config.preset_id)
        ) {
          return config.preset_id;
        }
        if (prev && loadedPresets.some((item) => item.id === prev)) return prev;
        return loadedPresets[0]?.id || '';
      });
    };

    load().catch(() => {
      if (!cancelled) {
        setPresets([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [isOpen, videoKind, config.preset_id]);

  const selectedPreset = presets.find((item) => item.id === selectedPresetId);
  const recommendedPreset = presets.find((item) => {
    const lowerName = item.name.toLowerCase();
    if (videoKind === '动漫') return /动漫|动画|anime/.test(lowerName);
    if (videoKind === '欧美剧') return /美剧|欧美|英剧/.test(lowerName);
    if (videoKind === '日剧') return /日剧/.test(lowerName);
    if (videoKind === '韩剧') return /韩剧/.test(lowerName);
    if (videoKind === '综艺') return /综艺|variety/.test(lowerName);
    if (videoKind === '纪录片') return /纪录片|documentary/.test(lowerName);
    return /通用|默认|default/.test(lowerName);
  });

  useEffect(() => {
    if (selectedPreset?.category) {
      setPresetCategory(selectedPreset.category);
    }
  }, [selectedPreset?.id, selectedPreset?.category]);

  const resolvePresetEnable = () =>
    tempConfig.enable || tempConfig.intro_time > 0 || tempConfig.outro_time < 0;

  const savePresetsState = async (nextPresets: SkipPreset[]) => {
    const sorted = sanitizePresetList(nextPresets);
    setPresets(sorted);

    setIsPresetSyncing(true);
    try {
      await saveSkipPresets(sorted);
    } finally {
      setIsPresetSyncing(false);
    }
  };

  const applyPreset = async (preset: SkipPreset) => {
    const now = Date.now();
    setTempConfig((prev) => ({
      ...prev,
      enable: preset.enable,
      intro_time: preset.intro_time,
      outro_time: preset.outro_time,
      preset_id: preset.id,
      preset_name: preset.name,
      preset_category: preset.category || '通用',
      preset_pinned: Boolean(preset.pinned),
    }));
    const nextPresets = presets.map((item) =>
      item.id === preset.id ? { ...item, lastUsedAt: now } : item,
    );
    setPresets(sanitizePresetList(nextPresets));
    await saveSkipPresets(sanitizePresetList(nextPresets));
    setPresetFeedback(`已套用预设「${preset.name}」`);
  };

  const handleCreatePreset = async () => {
    const normalizedName = normalizePresetName(presetName);
    if (!normalizedName) {
      setPresetFeedback('请先输入预设名称');
      return;
    }

    if (
      presets.some(
        (item) => item.name.toLowerCase() === normalizedName.toLowerCase(),
      )
    ) {
      setPresetFeedback('预设名称已存在，请换一个名称');
      return;
    }

    const newPreset: SkipPreset = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: normalizedName,
      category: presetCategory,
      pinned: false,
      lastUsedAt: 0,
      enable: resolvePresetEnable(),
      intro_time: Math.max(0, tempConfig.intro_time),
      outro_time: Math.min(0, tempConfig.outro_time),
      updatedAt: Date.now(),
    };

    const nextPresets = [newPreset, ...presets];
    await savePresetsState(nextPresets);
    setSelectedPresetId(newPreset.id);
    setPresetName('');
    setPresetCategory(videoKind);
    setPresetFeedback(`已创建预设「${newPreset.name}」`);
  };

  const handleUpdateSelectedPreset = async () => {
    if (!selectedPreset) {
      setPresetFeedback('请先选择一个预设');
      return;
    }

    const nextPresets = presets.map((item) =>
      item.id === selectedPreset.id
        ? {
            ...item,
            category: presetCategory,
            enable: resolvePresetEnable(),
            intro_time: Math.max(0, tempConfig.intro_time),
            outro_time: Math.min(0, tempConfig.outro_time),
            updatedAt: Date.now(),
          }
        : item,
    );

    await savePresetsState(nextPresets);
    setPresetFeedback(`已更新预设「${selectedPreset.name}」`);
  };

  const handleTogglePinSelectedPreset = async () => {
    if (!selectedPreset) {
      setPresetFeedback('请先选择一个预设');
      return;
    }

    const nextPresets = presets.map((item) =>
      item.id === selectedPreset.id ? { ...item, pinned: !item.pinned } : item,
    );
    await savePresetsState(nextPresets);
    setPresetFeedback(
      selectedPreset.pinned
        ? `已取消置顶「${selectedPreset.name}」`
        : `已置顶「${selectedPreset.name}」`,
    );
  };

  const handleDeleteSelectedPreset = async () => {
    if (!selectedPreset) {
      setPresetFeedback('请先选择一个预设');
      return;
    }

    const nextPresets = presets.filter((item) => item.id !== selectedPreset.id);
    await savePresetsState(nextPresets);
    setSelectedPresetId(nextPresets[0]?.id || '');
    setPresetFeedback(`已删除预设「${selectedPreset.name}」`);
  };

  const handleExportPresets = () => {
    const payload = JSON.stringify(presets, null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `decotv-skip-presets-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setPresetFeedback('预设已导出');
  };

  const handleImportPresets: ChangeEventHandler<HTMLInputElement> = async (
    event,
  ) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) {
        setPresetFeedback('导入失败：文件格式无效');
        return;
      }

      const imported = sanitizePresetList(parsed as SkipPreset[]);
      if (imported.length === 0) {
        setPresetFeedback('导入失败：未识别到有效预设');
        return;
      }
      setPendingImportedPresets(imported);
      setIsImportDialogOpen(true);
    } catch {
      setPresetFeedback('导入失败：文件内容无法解析');
    } finally {
      event.target.value = '';
    }
  };

  const handleConfirmImport = async (mode: 'merge' | 'overwrite') => {
    const byName = (name: string) => name.trim().toLowerCase();

    const finalPresets =
      mode === 'overwrite'
        ? sanitizePresetList(pendingImportedPresets)
        : sanitizePresetList([
            ...pendingImportedPresets,
            ...presets.filter(
              (localItem) =>
                !pendingImportedPresets.some(
                  (item) =>
                    item.id === localItem.id ||
                    byName(item.name) === byName(localItem.name),
                ),
            ),
          ]);

    await savePresetsState(finalPresets);
    setSelectedPresetId(finalPresets[0]?.id || '');
    setPresetFeedback(`已导入 ${pendingImportedPresets.length} 条预设`);
    setPendingImportedPresets([]);
    setIsImportDialogOpen(false);
  };

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
    const configWithPreset = {
      ...tempConfig,
      preset_id: selectedPreset?.id || tempConfig.preset_id,
      preset_name: selectedPreset?.name || tempConfig.preset_name,
      preset_category:
        selectedPreset?.category || tempConfig.preset_category || '通用',
      preset_pinned:
        selectedPreset?.pinned ?? tempConfig.preset_pinned ?? false,
    };
    onChange(configWithPreset);
    onClose();
  };

  // 重置配置
  const handleReset = () => {
    setTempConfig({
      enable: false,
      intro_time: 0,
      outro_time: 0,
      preset_id: undefined,
      preset_name: undefined,
      preset_category: undefined,
      preset_pinned: undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className='fixed inset-0 z-9999 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeIn'>
      <div
        className='bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-slideUp'
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className='relative bg-linear-to-r from-purple-600 via-pink-500 to-indigo-600 p-6'>
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
                    ? 'translate-x-8 bg-linear-to-r from-purple-600 to-pink-500'
                    : 'translate-x-1 bg-gray-400'
                }`}
              />
            </button>
          </div>
        </div>

        {/* 内容区 - 使用 flex-1 和 overflow-y-auto */}
        <div className='flex-1 overflow-y-auto p-6'>
          {/* 预设组 */}
          <div className='mb-6 rounded-xl border-2 border-violet-200 bg-linear-to-r from-violet-50 to-fuchsia-50 p-4 dark:border-violet-700 dark:from-violet-900/20 dark:to-fuchsia-900/20'>
            <input
              ref={importInputRef}
              type='file'
              accept='application/json'
              className='hidden'
              onChange={handleImportPresets}
            />

            <div className='flex items-center justify-between gap-3 mb-3'>
              <div>
                <h3 className='text-base font-semibold text-gray-800 dark:text-gray-200'>
                  跳过预设组
                </h3>
                <p className='text-xs text-gray-600 dark:text-gray-400 mt-1'>
                  一次设置，多影片复用。先套用，再点右下角保存到当前影片。
                </p>
              </div>
              <span className='text-xs text-gray-500 dark:text-gray-400'>
                {presets.length}/{MAX_PRESET_COUNT}
              </span>
            </div>

            {recommendedPreset && (
              <div className='mb-3 px-3 py-2 rounded-lg bg-emerald-100/70 dark:bg-emerald-900/30 border border-emerald-300/70 dark:border-emerald-700/60 flex flex-wrap items-center gap-2 text-xs'>
                <span className='text-emerald-700 dark:text-emerald-300'>
                  为当前影片类型「{videoKind}」推荐：
                  <strong>{recommendedPreset.name}</strong>
                </span>
                <button
                  onClick={() => {
                    setSelectedPresetId(recommendedPreset.id);
                    void applyPreset(recommendedPreset);
                  }}
                  className='px-2.5 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 transition-colors'
                >
                  一键套用推荐
                </button>
              </div>
            )}

            <div className='flex flex-col md:flex-row gap-3 mb-3'>
              <select
                value={selectedPresetId}
                onChange={(e) => setSelectedPresetId(e.target.value)}
                className='flex-1 px-3 py-2.5 border border-violet-300 dark:border-violet-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent'
              >
                <option value=''>选择一个预设组</option>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name} · 片头{formatTime(preset.intro_time)} /
                    片尾提前
                    {formatTime(Math.abs(preset.outro_time))}
                  </option>
                ))}
              </select>
              <button
                onClick={() =>
                  selectedPreset && void applyPreset(selectedPreset)
                }
                disabled={!selectedPreset}
                className='px-4 py-2.5 rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed transition-colors text-sm font-medium'
              >
                套用到当前
              </button>
            </div>

            {presets.length > 0 && (
              <div className='mb-3'>
                <div className='text-xs text-gray-500 dark:text-gray-400 mb-2'>
                  一键套用
                </div>
                <div className='flex flex-wrap gap-2'>
                  {presets.slice(0, 4).map((preset) => (
                    <button
                      key={`quick_${preset.id}`}
                      onClick={() => {
                        setSelectedPresetId(preset.id);
                        void applyPreset(preset);
                      }}
                      className='px-3 py-1.5 rounded-full border border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors text-xs'
                    >
                      {preset.pinned ? '置顶 · ' : ''}
                      {preset.name} · {formatTime(preset.intro_time)} / -
                      {formatTime(Math.abs(preset.outro_time))}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className='flex flex-col md:flex-row gap-3 mb-3'>
              <input
                type='text'
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                maxLength={20}
                placeholder='新建预设名,例如:国产剧通用90s/120s'
                className='flex-1 px-3 py-2.5 border border-violet-300 dark:border-violet-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent'
              />
              <select
                value={presetCategory}
                onChange={(e) =>
                  setPresetCategory(
                    e.target.value as (typeof PRESET_CATEGORIES)[number],
                  )
                }
                className='w-full md:w-32 px-3 py-2.5 border border-violet-300 dark:border-violet-600 rounded-lg bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:ring-2 focus:ring-violet-500 focus:border-transparent'
              >
                {PRESET_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <button
                onClick={handleCreatePreset}
                className='px-4 py-2.5 rounded-lg bg-fuchsia-600 text-white hover:bg-fuchsia-700 transition-colors text-sm font-medium'
              >
                以当前配置新建
              </button>
            </div>

            <div className='flex flex-wrap items-center gap-2'>
              <button
                onClick={handleUpdateSelectedPreset}
                disabled={!selectedPreset}
                className='px-3 py-2 rounded-lg border border-violet-300 dark:border-violet-600 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium'
              >
                用当前配置覆盖已选预设
              </button>
              <button
                onClick={handleDeleteSelectedPreset}
                disabled={!selectedPreset}
                className='px-3 py-2 rounded-lg border border-rose-300 dark:border-rose-600 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium'
              >
                删除已选预设
              </button>
              <button
                onClick={handleTogglePinSelectedPreset}
                disabled={!selectedPreset}
                className='px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium'
              >
                {selectedPreset?.pinned ? '取消置顶' : '置顶已选预设'}
              </button>
              <button
                onClick={handleExportPresets}
                disabled={presets.length === 0}
                className='px-3 py-2 rounded-lg border border-cyan-300 dark:border-cyan-600 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-xs font-medium'
              >
                导出预设
              </button>
              <button
                onClick={() => importInputRef.current?.click()}
                className='px-3 py-2 rounded-lg border border-cyan-300 dark:border-cyan-600 text-cyan-700 dark:text-cyan-300 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 transition-colors text-xs font-medium'
              >
                导入预设
              </button>
              {isPresetSyncing && (
                <span className='text-xs text-gray-500 dark:text-gray-400'>
                  正在同步到云端...
                </span>
              )}
              {presetFeedback && (
                <span className='text-xs text-gray-600 dark:text-gray-300'>
                  {presetFeedback}
                </span>
              )}
            </div>

            {isImportDialogOpen && (
              <div className='mt-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white/90 dark:bg-gray-900/70 p-3'>
                {(() => {
                  const byName = (name: string) => name.trim().toLowerCase();
                  const overwriteCount = pendingImportedPresets.filter((item) =>
                    presets.some(
                      (localItem) =>
                        localItem.id === item.id ||
                        byName(localItem.name) === byName(item.name),
                    ),
                  ).length;
                  const addCount =
                    pendingImportedPresets.length - overwriteCount;
                  const conflictNames = Array.from(
                    new Set(
                      presets
                        .filter((localItem) =>
                          pendingImportedPresets.some(
                            (item) =>
                              localItem.id === item.id ||
                              byName(localItem.name) === byName(item.name),
                          ),
                        )
                        .map((item) => item.name),
                    ),
                  );
                  const conflictPreviewNames = conflictNames.slice(0, 10);
                  const hiddenConflictCount = Math.max(
                    conflictNames.length - conflictPreviewNames.length,
                    0,
                  );

                  return (
                    <>
                      <div className='text-sm text-gray-800 dark:text-gray-200 mb-2'>
                        检测到 {pendingImportedPresets.length}{' '}
                        条可导入预设，请选择导入方式。
                      </div>
                      <div className='text-xs text-gray-600 dark:text-gray-300 mb-3'>
                        预览：将覆盖 {overwriteCount} 条，新增 {addCount} 条。
                      </div>
                      {conflictPreviewNames.length > 0 && (
                        <div className='mb-3 rounded-md border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-700/60 dark:bg-amber-900/20'>
                          <div className='mb-1 text-xs text-amber-800 dark:text-amber-300'>
                            冲突明细预览（前 10 条）：
                          </div>
                          <div className='flex flex-wrap gap-1.5'>
                            {conflictPreviewNames.map((name) => (
                              <span
                                key={name}
                                className='rounded-full border border-amber-300 bg-white/80 px-2 py-0.5 text-xs text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200'
                              >
                                {name}
                              </span>
                            ))}
                            {hiddenConflictCount > 0 && (
                              <span className='rounded-full border border-amber-300 bg-white/80 px-2 py-0.5 text-xs text-amber-900 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200'>
                                还有 {hiddenConflictCount} 条
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                  );
                })()}
                <div className='flex flex-wrap gap-2'>
                  <button
                    onClick={() => void handleConfirmImport('merge')}
                    className='px-3 py-2 rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition-colors text-xs font-medium'
                  >
                    合并导入
                  </button>
                  <button
                    onClick={() => void handleConfirmImport('overwrite')}
                    className='px-3 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors text-xs font-medium'
                  >
                    覆盖现有
                  </button>
                  <button
                    onClick={() => {
                      setPendingImportedPresets([]);
                      setIsImportDialogOpen(false);
                    }}
                    className='px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors text-xs font-medium'
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
          </div>

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
                    ? 'bg-linear-to-r from-purple-600 to-pink-500 text-white shadow-lg scale-105'
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
                    ? 'bg-linear-to-r from-purple-600 to-pink-500 text-white shadow-lg scale-105'
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
          <div className='mb-6 rounded-xl border-2 border-blue-200 bg-linear-to-br from-blue-50 to-cyan-50 p-5 dark:border-blue-700 dark:from-blue-900/20 dark:to-cyan-900/20'>
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
                  <div className='min-w-20 font-medium text-gray-600 dark:text-gray-400'>
                    = {formatTime(tempConfig.intro_time)}
                  </div>
                </div>
                <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                  从 0 秒跳到 {tempConfig.intro_time} 秒处（
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
                  从 0:00 跳到 {formatTime(tempConfig.intro_time)}
                </p>
              </div>
            )}
          </div>

          {/* 片尾设置 */}
          <div className='mb-6 rounded-xl border-2 border-orange-200 bg-linear-to-br from-orange-50 to-red-50 p-5 dark:border-orange-700 dark:from-orange-900/20 dark:to-red-900/20'>
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
                  <div className='min-w-20 font-medium text-gray-600 dark:text-gray-400'>
                    提前 {formatTime(Math.abs(tempConfig.outro_time))}
                  </div>
                </div>
                <p className='mt-2 text-sm text-gray-600 dark:text-gray-400'>
                  距离结尾还有 {Math.abs(tempConfig.outro_time)}{' '}
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
                  播放到{' '}
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
            <div className='rounded-xl border-2 border-green-200 bg-linear-to-r from-green-50 to-emerald-50 p-4 dark:border-green-700 dark:from-green-900/20 dark:to-emerald-900/20'>
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
                      片头:
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
                      片尾:
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
        <div className='flex shrink-0 items-center justify-between border-t border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900'>
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
              className='rounded-lg bg-linear-to-r from-purple-600 to-pink-500 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-all hover:scale-105 hover:from-purple-700 hover:to-pink-600 hover:shadow-xl'
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
