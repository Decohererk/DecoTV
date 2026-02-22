'use client';

import { ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import type { AdminConfig } from '@/lib/admin.types';
import { DEFAULT_PANSOU_SERVER_URL, MAX_PANSOU_NODE_COUNT } from '@/lib/pansou';

export interface PanSouConfigPanelProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

interface PanSouNodeForm {
  id: string;
  name: string;
  serverUrl: string;
  token: string;
  username: string;
  password: string;
  createdAt: number;
  updatedAt: number;
}

interface PanSouTestResult {
  success?: boolean;
  latency?: number;
  status?: number;
  searchStatus?: number;
  searchResultCount?: number;
  nodeName?: string;
  error?: string;
}

interface NoticeState {
  type: 'success' | 'error';
  message: string;
}

function normalizeServerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function createNodeId(): string {
  return `pansou_node_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function createDefaultNode(): PanSouNodeForm {
  const now = Date.now();
  return {
    id: 'pansou_default_node',
    name: '演示节点',
    serverUrl: normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL),
    token: '',
    username: '',
    password: '',
    createdAt: now,
    updatedAt: now,
  };
}

function toNodeForm(value: unknown, index: number): PanSouNodeForm | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const raw = value as Partial<PanSouNodeForm>;
  const now = Date.now();
  const serverUrl = normalizeServerUrl(raw.serverUrl || '');
  if (!serverUrl) {
    return null;
  }

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : createNodeId(),
    name:
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim()
        : `节点 ${index + 1}`,
    serverUrl,
    token: typeof raw.token === 'string' ? raw.token : '',
    username: typeof raw.username === 'string' ? raw.username : '',
    password: typeof raw.password === 'string' ? raw.password : '',
    createdAt:
      typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : now,
    updatedAt:
      typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
        ? raw.updatedAt
        : now,
  };
}

export default function PanSouConfigPanel({
  config,
  refreshConfig,
}: PanSouConfigPanelProps) {
  const [mounted, setMounted] = useState(false);
  const [nodes, setNodes] = useState<PanSouNodeForm[]>([createDefaultNode()]);
  const [activeNodeId, setActiveNodeId] = useState('pansou_default_node');
  const [isSaving, setIsSaving] = useState(false);
  const [testingNodeId, setTestingNodeId] = useState('');
  const [testResult, setTestResult] = useState<PanSouTestResult | null>(null);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [nodeModalMode, setNodeModalMode] = useState<'create' | 'edit'>(
    'create',
  );
  const [editingNodeId, setEditingNodeId] = useState('');
  const [draftNode, setDraftNode] =
    useState<PanSouNodeForm>(createDefaultNode());
  const [deleteNodeId, setDeleteNodeId] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const hasGlobalModal = isNodeModalOpen || Boolean(deleteNodeId);
    if (!hasGlobalModal) {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [mounted, isNodeModalOpen, deleteNodeId]);

  useEffect(() => {
    const incomingNodes = Array.isArray(config?.PanSouConfig?.nodes)
      ? config.PanSouConfig.nodes
      : [];

    const parsedNodes = incomingNodes
      .map((item, index) => toNodeForm(item, index))
      .filter((item): item is PanSouNodeForm => Boolean(item));

    const nextNodes =
      parsedNodes.length > 0 ? parsedNodes : [createDefaultNode()];
    const candidateActiveId =
      typeof config?.PanSouConfig?.activeNodeId === 'string'
        ? config.PanSouConfig.activeNodeId
        : '';
    const nextActiveId = nextNodes.some((item) => item.id === candidateActiveId)
      ? candidateActiveId
      : nextNodes[0].id;

    setNodes(nextNodes);
    setActiveNodeId(nextActiveId);
    setTestResult(null);
    setNotice(null);
  }, [config]);

  const activeNode = useMemo(() => {
    return nodes.find((node) => node.id === activeNodeId) || nodes[0] || null;
  }, [activeNodeId, nodes]);

  const showError = (message: string) => {
    setNotice({ type: 'error', message });
  };

  const showSuccess = (message: string) => {
    setNotice({ type: 'success', message });
  };

  const openCreateModal = () => {
    if (nodes.length >= MAX_PANSOU_NODE_COUNT) {
      showError(`最多支持 ${MAX_PANSOU_NODE_COUNT} 个节点`);
      return;
    }

    const now = Date.now();
    setNodeModalMode('create');
    setEditingNodeId('');
    setDraftNode({
      id: createNodeId(),
      name: `节点 ${nodes.length + 1}`,
      serverUrl: '',
      token: '',
      username: '',
      password: '',
      createdAt: now,
      updatedAt: now,
    });
    setIsNodeModalOpen(true);
  };

  const openEditModal = (node: PanSouNodeForm) => {
    setNodeModalMode('edit');
    setEditingNodeId(node.id);
    setDraftNode({ ...node });
    setIsNodeModalOpen(true);
  };

  const closeNodeModal = () => {
    setIsNodeModalOpen(false);
  };

  const handleConfirmNode = () => {
    const normalizedUrl = normalizeServerUrl(draftNode.serverUrl);
    if (!normalizedUrl) {
      showError('请填写服务地址');
      return;
    }

    const now = Date.now();
    const nextNode: PanSouNodeForm = {
      ...draftNode,
      name: draftNode.name.trim() || '未命名节点',
      serverUrl: normalizedUrl,
      token: draftNode.token.trim(),
      username: draftNode.username.trim(),
      password: draftNode.password,
      updatedAt: now,
    };

    if (nodeModalMode === 'create') {
      setNodes((prev) => [...prev, nextNode]);
      if (!activeNodeId) {
        setActiveNodeId(nextNode.id);
      }
    } else {
      setNodes((prev) =>
        prev.map((node) => (node.id === editingNodeId ? nextNode : node)),
      );
    }

    setIsNodeModalOpen(false);
    setNotice(null);
    setTestResult(null);
  };

  const handleDeleteNode = (nodeId: string) => {
    if (nodes.length <= 1) {
      showError('至少需要保留一个节点');
      return;
    }
    setDeleteNodeId(nodeId);
  };

  const confirmDeleteNode = () => {
    if (!deleteNodeId) {
      return;
    }

    const nextNodes = nodes.filter((node) => node.id !== deleteNodeId);
    if (nextNodes.length === 0) {
      return;
    }

    setNodes(nextNodes);
    if (activeNodeId === deleteNodeId) {
      setActiveNodeId(nextNodes[0].id);
    }
    setDeleteNodeId('');
    setTestResult(null);
    setNotice(null);
  };

  const handleSave = async () => {
    const payloadNodes = nodes.map((node, index) => ({
      id: node.id,
      name: node.name.trim() || `节点 ${index + 1}`,
      serverUrl: normalizeServerUrl(node.serverUrl),
      token: node.token.trim(),
      username: node.username.trim(),
      password: node.password,
      createdAt: node.createdAt,
      updatedAt: Date.now(),
    }));

    const invalidNode = payloadNodes.find((node) => !node.serverUrl);
    if (invalidNode) {
      showError(`节点“${invalidNode.name}”缺少服务地址`);
      return;
    }

    const nextActiveNodeId = payloadNodes.some(
      (node) => node.id === activeNodeId,
    )
      ? activeNodeId
      : payloadNodes[0].id;

    setIsSaving(true);
    setNotice(null);
    try {
      const response = await fetch('/api/admin/pansou', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          activeNodeId: nextActiveNodeId,
          nodes: payloadNodes,
        }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(data.error || '保存失败');
      }

      await refreshConfig();
      showSuccess('PanSou 配置已保存');
    } catch (error) {
      showError(
        error instanceof Error ? error.message : '保存配置失败，请稍后重试',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestNode = async (node: PanSouNodeForm) => {
    const serverUrl = normalizeServerUrl(node.serverUrl);
    if (!serverUrl) {
      showError('请先填写节点服务地址');
      return;
    }

    setTestingNodeId(node.id);
    setNotice(null);
    setTestResult(null);
    try {
      const response = await fetch('/api/admin/pansou/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          node: {
            ...node,
            serverUrl,
            token: node.token.trim(),
            username: node.username.trim(),
          },
          keyword: 'test',
        }),
      });

      const data = (await response
        .json()
        .catch(() => ({}))) as PanSouTestResult;
      setTestResult(data);

      if (!data.success) {
        showError(data.error || '连接失败');
      } else {
        showSuccess(`节点“${node.name}”连接成功`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : '网络请求失败';
      setTestResult({
        success: false,
        error: errorMessage,
      });
      showError(errorMessage);
    } finally {
      setTestingNodeId('');
    }
  };

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50 dark:bg-cyan-900/10 p-4'>
        <div className='flex flex-wrap items-center justify-between gap-3'>
          <div className='space-y-1'>
            <p className='text-sm font-semibold text-cyan-900 dark:text-cyan-200'>
              PanSou 节点管理
            </p>
            <p className='text-xs text-cyan-700 dark:text-cyan-300'>
              支持对接第三方 PanSou 服务
            </p>
          </div>
          <a
            href='https://github.com/fish2018/pansou'
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1.5 rounded-lg border border-cyan-300/70 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-800 transition hover:bg-cyan-500/20 dark:border-cyan-700 dark:text-cyan-200'
          >
            <ExternalLink className='h-3.5 w-3.5' />
            PanSou 官方仓库
          </a>
        </div>
      </div>

      <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
        <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50 flex flex-wrap items-center justify-between gap-3'>
          <div>
            <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
              节点列表
            </h4>
            <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
              当前使用：{activeNode?.name || '未配置'}
            </p>
          </div>
          <button
            type='button'
            onClick={openCreateModal}
            className='px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors'
          >
            新增节点
          </button>
        </div>

        <div className='p-4 space-y-3'>
          {nodes.map((node) => {
            const isActive = node.id === activeNodeId;
            const serverUrl = normalizeServerUrl(node.serverUrl);
            const isDemoNode =
              serverUrl === normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL);

            return (
              <div
                key={node.id}
                className={`rounded-lg border p-3 ${
                  isActive
                    ? 'border-cyan-300/70 bg-cyan-50/70 dark:border-cyan-800 dark:bg-cyan-900/10'
                    : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/30'
                }`}
              >
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0 space-y-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <p className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                        {node.name}
                      </p>
                      {isActive && (
                        <span className='rounded-full bg-cyan-500/15 px-2 py-0.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300'>
                          当前使用
                        </span>
                      )}
                      {isDemoNode && (
                        <span className='rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300'>
                          演示节点
                        </span>
                      )}
                    </div>
                    <p className='text-xs text-gray-600 dark:text-gray-300 break-all'>
                      {serverUrl || '未配置服务地址'}
                    </p>
                    <p className='text-[11px] text-gray-500 dark:text-gray-400'>
                      {node.username.trim()
                        ? '鉴权方式：Basic Auth（用户名/密码）'
                        : node.token.trim()
                          ? '鉴权方式：Bearer Token'
                          : '鉴权方式：无'}
                    </p>
                  </div>

                  <div className='flex flex-wrap items-center gap-2'>
                    {!isActive && (
                      <button
                        type='button'
                        onClick={() => setActiveNodeId(node.id)}
                        className='px-2 py-1 text-xs font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-md transition-colors'
                      >
                        设为当前
                      </button>
                    )}
                    <button
                      type='button'
                      onClick={() => void handleTestNode(node)}
                      disabled={testingNodeId === node.id}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                        testingNodeId === node.id
                          ? 'bg-gray-400 cursor-not-allowed text-white'
                          : 'bg-green-600 hover:bg-green-700 text-white'
                      }`}
                    >
                      {testingNodeId === node.id ? '测试中...' : '连通性测试'}
                    </button>
                    <button
                      type='button'
                      onClick={() => openEditModal(node)}
                      className='px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md transition-colors'
                    >
                      编辑
                    </button>
                    <button
                      type='button'
                      onClick={() => handleDeleteNode(node.id)}
                      disabled={nodes.length <= 1}
                      className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                        nodes.length <= 1
                          ? 'bg-gray-400 cursor-not-allowed text-white'
                          : 'bg-red-600 hover:bg-red-700 text-white'
                      }`}
                    >
                      删除
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            notice.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300'
          }`}
        >
          {notice.message}
        </div>
      )}

      {testResult && (
        <div
          className={`rounded-lg border p-3 ${
            testResult.success
              ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
              : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
          }`}
        >
          <p
            className={`text-sm font-medium ${
              testResult.success
                ? 'text-emerald-800 dark:text-emerald-300'
                : 'text-red-800 dark:text-red-300'
            }`}
          >
            {testResult.success ? '节点连接成功' : '节点连接失败'}
          </p>
          {testResult.success ? (
            <div className='mt-1 text-xs text-emerald-700 dark:text-emerald-400 space-y-0.5'>
              {testResult.nodeName && <p>节点: {testResult.nodeName}</p>}
              <p>延迟: {testResult.latency ?? 0}ms</p>
              <p>
                状态码: {testResult.searchStatus ?? testResult.status ?? 200}
              </p>
              <p>测试返回结果数: {testResult.searchResultCount ?? 0}</p>
            </div>
          ) : (
            <p className='mt-1 text-xs text-red-700 dark:text-red-400'>
              {testResult.error || '连接异常，请检查地址与鉴权配置'}
            </p>
          )}
        </div>
      )}

      <div className='flex justify-end'>
        <button
          type='button'
          onClick={() => void handleSave()}
          disabled={isSaving}
          className={`px-4 py-2 rounded-lg transition-colors ${
            isSaving
              ? 'bg-gray-400 cursor-not-allowed text-white'
              : 'px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg'
          }`}
        >
          {isSaving ? '保存中...' : '保存配置'}
        </button>
      </div>

      {mounted &&
        isNodeModalOpen &&
        createPortal(
          <div
            className='fixed inset-0 z-1200 flex items-center justify-center bg-black/60 backdrop-blur-md p-4'
            onClick={closeNodeModal}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto'
              onClick={(event) => event.stopPropagation()}
            >
              <div className='p-6 space-y-4'>
                <div className='flex items-center justify-between'>
                  <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    {nodeModalMode === 'create' ? '新增节点' : '编辑节点'}
                  </h3>
                  <button
                    type='button'
                    onClick={closeNodeModal}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
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
                        d='M6 18L18 6M6 6l12 12'
                      />
                    </svg>
                  </button>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    节点名称
                  </label>
                  <input
                    type='text'
                    value={draftNode.name}
                    onChange={(event) =>
                      setDraftNode((prev) => ({
                        ...prev,
                        name: event.target.value,
                      }))
                    }
                    placeholder='例如：主节点'
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
                  />
                </div>

                <div>
                  <div className='flex items-center justify-between mb-1.5'>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300'>
                      服务地址 (URL)
                    </label>
                    <button
                      type='button'
                      onClick={() =>
                        setDraftNode((prev) => ({
                          ...prev,
                          serverUrl: normalizeServerUrl(
                            DEFAULT_PANSOU_SERVER_URL,
                          ),
                        }))
                      }
                      className='text-xs text-cyan-700 dark:text-cyan-300 hover:underline'
                    >
                      使用演示地址
                    </button>
                  </div>
                  <input
                    type='text'
                    value={draftNode.serverUrl}
                    onChange={(event) =>
                      setDraftNode((prev) => ({
                        ...prev,
                        serverUrl: event.target.value,
                      }))
                    }
                    placeholder='例如: https://pansou.example.com'
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
                  />
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    API Token / 鉴权密钥
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      选填
                    </span>
                  </label>
                  <input
                    type='text'
                    value={draftNode.token}
                    onChange={(event) =>
                      setDraftNode((prev) => ({
                        ...prev,
                        token: event.target.value,
                      }))
                    }
                    placeholder='不填则不注入 Bearer Token'
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
                  />
                </div>

                <div className='grid gap-3 sm:grid-cols-2'>
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                      用户名 (Username)
                      <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                        选填
                      </span>
                    </label>
                    <input
                      type='text'
                      value={draftNode.username}
                      onChange={(event) =>
                        setDraftNode((prev) => ({
                          ...prev,
                          username: event.target.value,
                        }))
                      }
                      placeholder='Basic Auth 用户名'
                      className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
                    />
                  </div>
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                      密码 (Password)
                      <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                        选填
                      </span>
                    </label>
                    <input
                      type='password'
                      value={draftNode.password}
                      onChange={(event) =>
                        setDraftNode((prev) => ({
                          ...prev,
                          password: event.target.value,
                        }))
                      }
                      placeholder='Basic Auth 密码'
                      className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all'
                    />
                  </div>
                </div>

                <div className='rounded-lg border border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/30 p-3'>
                  <p className='text-xs text-gray-600 dark:text-gray-400'>
                    如填写用户名和密码，请求会自动注入 HTTP Basic
                    Auth（Authorization: Basic ...）。
                  </p>
                </div>

                <div className='flex justify-end gap-2 pt-2'>
                  <button
                    type='button'
                    onClick={closeNodeModal}
                    className='px-3 py-1.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors'
                  >
                    取消
                  </button>
                  <button
                    type='button'
                    onClick={handleConfirmNode}
                    className='px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors'
                  >
                    {nodeModalMode === 'create' ? '添加节点' : '保存节点'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {deleteNodeId && (
        <div className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'>
          <div className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full'>
            <div className='p-6 space-y-4'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                确认删除节点
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400'>
                删除后无法恢复，请确认是否继续。
              </p>
              <div className='flex justify-end gap-2'>
                <button
                  type='button'
                  onClick={() => setDeleteNodeId('')}
                  className='px-3 py-1.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors'
                >
                  取消
                </button>
                <button
                  type='button'
                  onClick={confirmDeleteNode}
                  className='px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors'
                >
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
