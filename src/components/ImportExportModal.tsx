'use client';

import { AlertCircle, CheckCircle, Download, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface ImportResult {
  success: number;
  failed: number;
  skipped: number;
  details: Array<{
    name: string;
    key: string;
    status: 'success' | 'failed' | 'skipped';
    reason?: string;
  }>;
}

export interface ImportExportModalProps {
  isOpen: boolean;
  mode: 'import' | 'export' | 'result';
  onClose: () => void;
  onImport?: (
    file: File,
    onProgress?: (current: number, total: number) => void,
  ) => Promise<ImportResult>;
  onExport?: (format?: 'array' | 'config') => void;
  result?: ImportResult;
}

export default function ImportExportModal({
  isOpen,
  mode,
  onClose,
  onImport,
  onExport,
  result,
}: ImportExportModalProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importProgress, setImportProgress] = useState({
    current: 0,
    total: 0,
  });
  const [exportFormat, setExportFormat] = useState<'array' | 'config'>('array');

  if (!isOpen) return null;

  const handleFileSelect = async (file: File) => {
    if (!file.name.endsWith('.json')) {
      alert('请选择 JSON 格式的文件');
      return;
    }

    setIsProcessing(true);
    setImportProgress({ current: 0, total: 0 });

    try {
      if (onImport) {
        await onImport(file, (current, total) => {
          setImportProgress({ current, total });
        });
      }
    } finally {
      setIsProcessing(false);
      setImportProgress({ current: 0, total: 0 });
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const modalContent = (
    <div className='fixed inset-0 bg-black/60 backdrop-blur-sm z-[9999] flex items-center justify-center p-4'>
      <div className='bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col overflow-hidden'>
        {/* 头部 - 更紧凑的设计 */}
        <div
          className={`relative px-5 py-4 ${
            mode === 'import'
              ? 'bg-gradient-to-r from-blue-600 to-cyan-600'
              : mode === 'export'
                ? 'bg-gradient-to-r from-green-600 to-emerald-600'
                : result && result.failed > 0
                  ? 'bg-gradient-to-r from-yellow-600 to-orange-600'
                  : 'bg-gradient-to-r from-green-600 to-emerald-600'
          }`}
        >
          <div className='flex items-center justify-between'>
            <div className='flex items-center space-x-3'>
              <div className='bg-white/20 backdrop-blur-sm p-2 rounded-lg'>
                {mode === 'import' ? (
                  <Upload className='w-5 h-5 text-white' />
                ) : (
                  <Download className='w-5 h-5 text-white' />
                )}
              </div>
              <div>
                <h2 className='text-lg font-bold text-white'>
                  {mode === 'import'
                    ? '导入视频源'
                    : mode === 'export'
                      ? '导出视频源'
                      : '导入结果'}
                </h2>
                <p className='text-white/80 text-xs mt-0.5'>
                  {mode === 'import'
                    ? isProcessing && importProgress.total > 0
                      ? `正在导入 ${importProgress.current}/${importProgress.total}`
                      : '从 JSON 文件导入配置'
                    : mode === 'export'
                      ? '导出为 JSON 文件'
                      : '查看导入详情'}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isProcessing}
              className={`text-white/80 hover:text-white hover:bg-white/20 p-1.5 rounded-lg transition-all ${
                isProcessing ? 'opacity-50 cursor-not-allowed' : ''
              }`}
            >
              <X className='w-5 h-5' />
            </button>
          </div>

          {/* 导入进度条 */}
          {isProcessing && importProgress.total > 0 && (
            <div className='mt-3'>
              <div className='flex items-center justify-between text-white/90 text-xs mb-1'>
                <span>导入进度</span>
                <span className='font-mono font-semibold'>
                  {importProgress.current}/{importProgress.total}
                </span>
              </div>
              <div className='h-2 bg-white/20 rounded-full overflow-hidden'>
                <div
                  className='h-full bg-white/90 transition-all duration-300 ease-out'
                  style={{
                    width: `${
                      (importProgress.current / importProgress.total) * 100
                    }%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* 内容区 - 优化间距 */}
        <div className='flex-1 overflow-y-auto p-5'>
          {mode === 'import' && (
            <div className='space-y-3'>
              {/* 拖放区域 - 更紧凑 */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-all ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                }`}
              >
                <div className='flex flex-col items-center space-y-3'>
                  <div
                    className={`p-3 rounded-full ${
                      isDragging
                        ? 'bg-blue-100 dark:bg-blue-900/40'
                        : 'bg-gray-100 dark:bg-gray-700'
                    }`}
                  >
                    <Upload
                      className={`w-10 h-10 ${
                        isDragging
                          ? 'text-blue-600 dark:text-blue-400'
                          : 'text-gray-400 dark:text-gray-500'
                      }`}
                    />
                  </div>
                  <div>
                    <p className='text-base font-medium text-gray-700 dark:text-gray-300'>
                      {isDragging ? '松开以上传文件' : '拖放文件到这里'}
                    </p>
                    <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                      或点击下方按钮选择文件
                    </p>
                  </div>
                  <label className='cursor-pointer'>
                    <input
                      type='file'
                      accept='.json'
                      onChange={handleFileInput}
                      className='hidden'
                      disabled={isProcessing}
                    />
                    <div
                      className={`px-5 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isProcessing
                          ? 'bg-gray-400 cursor-not-allowed text-white'
                          : 'bg-blue-600 hover:bg-blue-700 text-white'
                      }`}
                    >
                      {isProcessing ? '处理中...' : '选择 JSON 文件'}
                    </div>
                  </label>
                </div>
              </div>

              {/* 说明文档 - 更紧凑 */}
              <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3'>
                <h4 className='font-semibold text-blue-900 dark:text-blue-200 mb-1.5 text-sm'>
                  📝 导入说明
                </h4>
                <ul className='text-xs text-blue-800 dark:text-blue-300 space-y-0.5'>
                  <li>• 支持标准 JSON 格式的视频源配置文件</li>
                  <li>• 重复的 key 将被跳过，不会覆盖现有配置</li>
                  <li>• 导入完成后会显示详细的导入结果</li>
                  <li>• 建议先导出备份，再进行导入操作</li>
                </ul>
              </div>
            </div>
          )}

          {mode === 'export' && (
            <div className='space-y-3'>
              {/* 导出格式选择 */}
              <div className='bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg p-4'>
                <h4 className='font-semibold text-gray-900 dark:text-gray-100 mb-3 text-sm'>
                  📋 选择导出格式
                </h4>
                <div className='space-y-2'>
                  <label className='flex items-start space-x-3 cursor-pointer group'>
                    <input
                      type='radio'
                      name='exportFormat'
                      value='array'
                      checked={exportFormat === 'array'}
                      onChange={(e) =>
                        setExportFormat(e.target.value as 'array' | 'config')
                      }
                      className='mt-1 w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500'
                    />
                    <div className='flex-1'>
                      <div className='font-medium text-gray-900 dark:text-gray-100 text-sm group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
                        数组格式 (推荐)
                      </div>
                      <div className='text-xs text-gray-600 dark:text-gray-400 mt-0.5'>
                        用于"视频源配置"卡片的导入功能,支持批量导入视频源
                      </div>
                    </div>
                  </label>
                  <label className='flex items-start space-x-3 cursor-pointer group'>
                    <input
                      type='radio'
                      name='exportFormat'
                      value='config'
                      checked={exportFormat === 'config'}
                      onChange={(e) =>
                        setExportFormat(e.target.value as 'array' | 'config')
                      }
                      className='mt-1 w-4 h-4 text-green-600 border-gray-300 focus:ring-green-500'
                    />
                    <div className='flex-1'>
                      <div className='font-medium text-gray-900 dark:text-gray-100 text-sm group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
                        配置文件格式
                      </div>
                      <div className='text-xs text-gray-600 dark:text-gray-400 mt-0.5'>
                        用于"配置文件"卡片,可直接粘贴到配置文件编辑器中
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              <div className='text-center py-4'>
                <div className='inline-flex p-3 bg-green-100 dark:bg-green-900/40 rounded-full mb-3'>
                  <CheckCircle className='w-12 h-12 text-green-600 dark:text-green-400' />
                </div>
                <h3 className='text-lg font-semibold text-gray-800 dark:text-gray-200 mb-1.5'>
                  准备导出
                </h3>
                <p className='text-sm text-gray-600 dark:text-gray-400'>
                  点击下方按钮开始导出视频源配置
                </p>
              </div>

              <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3'>
                <h4 className='font-semibold text-green-900 dark:text-green-200 mb-1.5 text-sm'>
                  📦 导出说明
                </h4>
                <ul className='text-xs text-green-800 dark:text-green-300 space-y-0.5'>
                  <li>
                    • 文件名：
                    {exportFormat === 'array'
                      ? 'video_sources_YYYYMMDD_HHMMSS.json'
                      : 'config_YYYYMMDD_HHMMSS.json'}
                  </li>
                  <li>
                    • 格式：
                    {exportFormat === 'array'
                      ? '数组格式 [{"name": "...", ...}]'
                      : '配置文件格式 {"api_site": {...}}'}
                  </li>
                  <li>• 包含所有视频源的完整配置信息</li>
                  <li>• 可用于备份或迁移到其他设备</li>
                </ul>
              </div>
            </div>
          )}

          {mode === 'result' && result && (
            <div className='space-y-3'>
              {/* 统计信息 - 更紧凑 */}
              <div className='grid grid-cols-3 gap-3'>
                <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 text-center'>
                  <div className='text-2xl font-bold text-green-600 dark:text-green-400'>
                    {result.success}
                  </div>
                  <div className='text-xs text-green-700 dark:text-green-300 mt-0.5'>
                    成功导入
                  </div>
                </div>
                <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 text-center'>
                  <div className='text-2xl font-bold text-yellow-600 dark:text-yellow-400'>
                    {result.skipped}
                  </div>
                  <div className='text-xs text-yellow-700 dark:text-yellow-300 mt-0.5'>
                    已跳过
                  </div>
                </div>
                <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-center'>
                  <div className='text-2xl font-bold text-red-600 dark:text-red-400'>
                    {result.failed}
                  </div>
                  <div className='text-xs text-red-700 dark:text-red-300 mt-0.5'>
                    导入失败
                  </div>
                </div>
              </div>

              {/* 详细列表 - 优化高度和间距 */}
              <div className='max-h-[350px] overflow-y-auto'>
                <div className='space-y-1.5'>
                  {result.details.map((item, index) => (
                    <div
                      key={index}
                      className={`flex items-start space-x-2.5 p-2.5 rounded-lg border ${
                        item.status === 'success'
                          ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                          : item.status === 'skipped'
                            ? 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                            : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                      }`}
                    >
                      {item.status === 'success' ? (
                        <CheckCircle className='w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5' />
                      ) : (
                        <AlertCircle
                          className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                            item.status === 'skipped'
                              ? 'text-yellow-600 dark:text-yellow-400'
                              : 'text-red-600 dark:text-red-400'
                          }`}
                        />
                      )}
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center space-x-1.5'>
                          <span className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                            {item.name}
                          </span>
                          <span className='text-[10px] text-gray-500 dark:text-gray-400 font-mono'>
                            ({item.key})
                          </span>
                        </div>
                        {item.reason && (
                          <p className='text-xs text-gray-600 dark:text-gray-400 mt-0.5'>
                            {item.reason}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 - 更紧凑 */}
        <div className='flex-shrink-0 px-5 py-3 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end space-x-2.5'>
          {mode === 'export' && (
            <button
              onClick={() => onExport?.(exportFormat)}
              className='px-4 py-2 text-sm bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition-all shadow-md hover:shadow-lg font-medium'
            >
              确认导出
            </button>
          )}
          <button
            onClick={onClose}
            disabled={isProcessing}
            className={`px-4 py-2 text-sm rounded-lg transition-colors font-medium ${
              isProcessing
                ? 'bg-gray-300 dark:bg-gray-600 text-gray-500 dark:text-gray-400 cursor-not-allowed'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            {mode === 'result' ? '完成' : '取消'}
          </button>
        </div>
      </div>
    </div>
  );

  // 使用 createPortal 渲染到 body，确保覆盖整个页面
  if (typeof window === 'undefined') return null;
  return createPortal(modalContent, document.body);
}
