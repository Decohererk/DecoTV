/* eslint-disable @typescript-eslint/no-explicit-any, no-console, @typescript-eslint/no-non-null-assertion,react-hooks/exhaustive-deps */

'use client';

import {
  closestCenter,
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from '@dnd-kit/modifiers';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  MessageSquareText,
  Package,
  Settings,
  Tv,
  Upload,
  Users,
  Video,
} from 'lucide-react';
import { GripVertical } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import { AdminConfig, DanmuCustomNode } from '@/lib/admin.types';
import { getAuthInfoFromBrowserCookie } from '@/lib/auth';
import { DEFAULT_PANSOU_SERVER_URL } from '@/lib/pansou';

import DataMigration from '@/components/DataMigration';
import type { ImportExportModalProps } from '@/components/ImportExportModal';
import PageLayout from '@/components/PageLayout';
import type { PanSouConfigPanelProps } from '@/components/PanSouConfigPanel';

const ImportExportModal = dynamic<ImportExportModalProps>(
  () => import('../../components/ImportExportModal').then((mod) => mod.default),
  { ssr: false },
);
const PanSouConfigPanel = dynamic<PanSouConfigPanelProps>(
  () => import('../../components/PanSouConfigPanel').then((mod) => mod.default),
  { ssr: false },
);

// 统一按钮样式系统
const buttonStyles = {
  // 主要操作按钮（蓝色）- 用于配置、设置、确认等
  primary:
    'px-3 py-1.5 text-sm font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors',
  // 成功操作按钮（绿色）- 用于添加、启用、保存等
  success:
    'px-3 py-1.5 text-sm font-medium bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 text-white rounded-lg transition-colors',
  // 危险操作按钮（红色）- 用于删除、禁用、重置等
  danger:
    'px-3 py-1.5 text-sm font-medium bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 text-white rounded-lg transition-colors',
  // 次要操作按钮（灰色）- 用于取消、关闭等
  secondary:
    'px-3 py-1.5 text-sm font-medium bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 text-white rounded-lg transition-colors',
  // 警告操作按钮（黄色）- 用于批量禁用等
  warning:
    'px-3 py-1.5 text-sm font-medium bg-yellow-600 hover:bg-yellow-700 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white rounded-lg transition-colors',
  // 小尺寸主要按钮
  primarySmall:
    'px-2 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-md transition-colors',
  // 小尺寸成功按钮
  successSmall:
    'px-2 py-1 text-xs font-medium bg-green-600 hover:bg-green-700 dark:bg-green-600 dark:hover:bg-green-700 text-white rounded-md transition-colors',
  // 小尺寸危险按钮
  dangerSmall:
    'px-2 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 dark:bg-red-600 dark:hover:bg-red-700 text-white rounded-md transition-colors',
  // 小尺寸次要按钮
  secondarySmall:
    'px-2 py-1 text-xs font-medium bg-gray-600 hover:bg-gray-700 dark:bg-gray-600 dark:hover:bg-gray-700 text-white rounded-md transition-colors',
  // 小尺寸警告按钮
  warningSmall:
    'px-2 py-1 text-xs font-medium bg-yellow-600 hover:bg-yellow-700 dark:bg-yellow-600 dark:hover:bg-yellow-700 text-white rounded-md transition-colors',
  // 圆角小按钮（用于表格操作）
  roundedPrimary:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900/40 dark:hover:bg-blue-900/60 dark:text-blue-200 transition-colors',
  roundedSuccess:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-green-100 text-green-800 hover:bg-green-200 dark:bg-green-900/40 dark:hover:bg-green-900/60 dark:text-green-200 transition-colors',
  roundedDanger:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-200 transition-colors',
  roundedSecondary:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800 hover:bg-gray-200 dark:bg-gray-700/40 dark:hover:bg-gray-700/60 dark:text-gray-200 transition-colors',
  roundedWarning:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 hover:bg-yellow-200 dark:bg-yellow-900/40 dark:hover:bg-yellow-900/60 dark:text-yellow-200 transition-colors',
  roundedPurple:
    'inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800 hover:bg-purple-200 dark:bg-purple-900/40 dark:hover:bg-purple-900/60 dark:text-purple-200 transition-colors',
  // 禁用状态
  disabled:
    'px-3 py-1.5 text-sm font-medium bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg transition-colors',
  disabledSmall:
    'px-2 py-1 text-xs font-medium bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-md transition-colors',
  // 开关按钮样式
  toggleOn: 'bg-green-600 dark:bg-green-600',
  toggleOff: 'bg-gray-200 dark:bg-gray-700',
  toggleThumb: 'bg-white',
  toggleThumbOn: 'translate-x-6',
  toggleThumbOff: 'translate-x-1',
  // 快速操作按钮样式
  quickAction:
    'px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-md transition-colors',
};

// 通用弹窗组件
interface AlertModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'success' | 'error' | 'warning';
  title: string;
  message?: string;
  timer?: number;
  showConfirm?: boolean;
}

const AlertModal = ({
  isOpen,
  onClose,
  type,
  title,
  message,
  timer,
  showConfirm = false,
}: AlertModalProps) => {
  const [isVisible, setIsVisible] = useState(false);
  const [mounted, setMounted] = useState(false);

  // 确保组件已挂载到客户端
  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setIsVisible(true);
      if (timer) {
        const timeoutId = setTimeout(() => {
          onClose();
        }, timer);
        return () => clearTimeout(timeoutId);
      }
    } else {
      setIsVisible(false);
    }
  }, [isOpen, timer, onClose]);

  // 未挂载或未打开时不渲染
  if (!mounted || !isOpen) return null;

  const getIcon = () => {
    switch (type) {
      case 'success':
        return <CheckCircle className='w-8 h-8 text-green-500' />;
      case 'error':
        return <AlertCircle className='w-8 h-8 text-red-500' />;
      case 'warning':
        return <AlertTriangle className='w-8 h-8 text-yellow-500' />;
      default:
        return null;
    }
  };

  const getBgColor = () => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800';
      case 'error':
        return 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
      case 'warning':
        return 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800';
      default:
        return 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800';
    }
  };

  return createPortal(
    <div
      className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
        isVisible ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={onClose}
    >
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-sm w-full border ${getBgColor()} transition-all duration-200 ${
          isVisible ? 'scale-100' : 'scale-95'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className='p-6 text-center'>
          <div className='flex justify-center mb-4'>{getIcon()}</div>

          <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2'>
            {title}
          </h3>

          {message && (
            <p className='text-gray-600 dark:text-gray-400 mb-4'>{message}</p>
          )}

          {showConfirm && (
            <button
              onClick={onClose}
              className={`px-4 py-2 text-sm font-medium ${buttonStyles.primary}`}
            >
              确定
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

// 弹窗状态管理
const useAlertModal = () => {
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: 'success' | 'error' | 'warning';
    title: string;
    message?: string;
    timer?: number;
    showConfirm?: boolean;
  }>({
    isOpen: false,
    type: 'success',
    title: '',
  });

  const showAlert = (config: Omit<typeof alertModal, 'isOpen'>) => {
    setAlertModal({ ...config, isOpen: true });
  };

  const hideAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  return { alertModal, showAlert, hideAlert };
};

// 统一弹窗方法（必须在首次使用前定义）
const showError = (message: string, showAlert?: (config: any) => void) => {
  if (showAlert) {
    showAlert({ type: 'error', title: '错误', message, showConfirm: true });
  } else {
    console.error(message);
  }
};

const showSuccess = (message: string, showAlert?: (config: any) => void) => {
  if (showAlert) {
    showAlert({ type: 'success', title: '成功', message, timer: 2000 });
  } else {
    console.log(message);
  }
};

// 通用加载状态管理系统
interface LoadingState {
  [key: string]: boolean;
}

const useLoadingState = () => {
  const [loadingStates, setLoadingStates] = useState<LoadingState>({});

  const setLoading = (key: string, loading: boolean) => {
    setLoadingStates((prev) => ({ ...prev, [key]: loading }));
  };

  const isLoading = (key: string) => loadingStates[key] || false;

  const withLoading = async (
    key: string,
    operation: () => Promise<any>,
  ): Promise<any> => {
    setLoading(key, true);
    try {
      const result = await operation();
      return result;
    } finally {
      setLoading(key, false);
    }
  };

  return { loadingStates, setLoading, isLoading, withLoading };
};

// 新增站点配置类型
interface SiteConfig {
  SiteName: string;
  Announcement: string;
  SearchDownstreamMaxPage: number;
  SiteInterfaceCacheTime: number;
  DoubanProxyType: string;
  DoubanProxy: string;
  DoubanImageProxyType: string;
  DoubanImageProxy: string;
  DisableYellowFilter: boolean;
  FluidSearch: boolean;
  // 登录页面背景图
  LoginBackground: string;
}

// 视频源数据类型
interface DataSource {
  name: string;
  key: string;
  api: string;
  detail?: string;
  disabled?: boolean;
  is_adult?: boolean; // 标记是否为成人资源
  from: 'config' | 'custom';
}

// 直播源数据类型
interface LiveDataSource {
  name: string;
  key: string;
  url: string;
  ua?: string;
  epg?: string;
  channelNumber?: number;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 自定义分类数据类型
interface CustomCategory {
  name?: string;
  type: 'movie' | 'tv';
  query: string;
  disabled?: boolean;
  from: 'config' | 'custom';
}

// 可折叠标签组件
interface CollapsibleTabProps {
  title: string;
  icon?: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const CollapsibleTab = ({
  title,
  icon,
  isExpanded,
  onToggle,
  children,
}: CollapsibleTabProps) => {
  return (
    <div className='rounded-xl shadow-sm mb-4 overflow-hidden bg-white/80 backdrop-blur-md dark:bg-gray-800/50 dark:ring-1 dark:ring-gray-700'>
      <button
        onClick={onToggle}
        className='w-full px-6 py-4 flex items-center justify-between bg-gray-50/70 dark:bg-gray-800/60 hover:bg-gray-100/80 dark:hover:bg-gray-700/60 transition-colors'
      >
        <div className='flex items-center gap-3'>
          {icon}
          <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100'>
            {title}
          </h3>
        </div>
        <div className='text-gray-500 dark:text-gray-400'>
          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
        </div>
      </button>

      {isExpanded && <div className='px-6 py-4'>{children}</div>}
    </div>
  );
};

// 用户配置组件
interface UserConfigProps {
  config: AdminConfig | null;
  role: 'owner' | 'admin' | null;
  refreshConfig: () => Promise<void>;
}

const UserConfig = ({ config, role, refreshConfig }: UserConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [showAddUserForm, setShowAddUserForm] = useState(false);
  const [showChangePasswordForm, setShowChangePasswordForm] = useState(false);
  const [showAddUserGroupForm, setShowAddUserGroupForm] = useState(false);
  const [showEditUserGroupForm, setShowEditUserGroupForm] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    password: '',
    userGroup: '', // 新增用户组字段
  });
  const [changePasswordUser, setChangePasswordUser] = useState({
    username: '',
    password: '',
  });
  const [newUserGroup, setNewUserGroup] = useState({
    name: '',
    enabledApis: [] as string[],
  });
  const [editingUserGroup, setEditingUserGroup] = useState<{
    name: string;
    enabledApis: string[];
  } | null>(null);
  const [showConfigureApisModal, setShowConfigureApisModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
    tags?: string[];
  } | null>(null);
  const [selectedApis, setSelectedApis] = useState<string[]>([]);
  const [showConfigureUserGroupModal, setShowConfigureUserGroupModal] =
    useState(false);
  const [selectedUserForGroup, setSelectedUserForGroup] = useState<{
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  } | null>(null);
  const [selectedUserGroups, setSelectedUserGroups] = useState<string[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set());
  const [showBatchUserGroupModal, setShowBatchUserGroupModal] = useState(false);
  const [selectedUserGroup, setSelectedUserGroup] = useState<string>('');
  const [showDeleteUserGroupModal, setShowDeleteUserGroupModal] =
    useState(false);
  const [deletingUserGroup, setDeletingUserGroup] = useState<{
    name: string;
    affectedUsers: Array<{
      username: string;
      role: 'user' | 'admin' | 'owner';
    }>;
  } | null>(null);
  const [showDeleteUserModal, setShowDeleteUserModal] = useState(false);
  const [deletingUser, setDeletingUser] = useState<string | null>(null);

  // 当前登录用户名
  const currentUsername = getAuthInfoFromBrowserCookie()?.username || null;

  // 使用 useMemo 计算全选状态，避免每次渲染都重新计算
  const selectAllUsers = useMemo(() => {
    const selectableUserCount =
      config?.UserConfig?.Users?.filter(
        (user) =>
          role === 'owner' ||
          (role === 'admin' &&
            (user.role === 'user' || user.username === currentUsername)),
      ).length || 0;
    return selectedUsers.size === selectableUserCount && selectedUsers.size > 0;
  }, [selectedUsers.size, config?.UserConfig?.Users, role, currentUsername]);

  // 获取用户组列表
  const userGroups = config?.UserConfig?.Tags || [];

  // 处理用户组相关操作
  const handleUserGroupAction = async (
    action: 'add' | 'edit' | 'delete',
    groupName: string,
    enabledApis?: string[],
  ) => {
    return withLoading(`userGroup_${action}_${groupName}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'userGroup',
            groupAction: action,
            groupName,
            enabledApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        await refreshConfig();

        if (action === 'add') {
          setNewUserGroup({ name: '', enabledApis: [] });
          setShowAddUserGroupForm(false);
        } else if (action === 'edit') {
          setEditingUserGroup(null);
          setShowEditUserGroupForm(false);
        }

        showSuccess(
          action === 'add'
            ? '用户组添加成功'
            : action === 'edit'
              ? '用户组更新成功'
              : '用户组删除成功',
          showAlert,
        );
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleAddUserGroup = () => {
    if (!newUserGroup.name.trim()) return;
    handleUserGroupAction('add', newUserGroup.name, newUserGroup.enabledApis);
  };

  const handleEditUserGroup = () => {
    if (!editingUserGroup?.name.trim()) return;
    handleUserGroupAction(
      'edit',
      editingUserGroup.name,
      editingUserGroup.enabledApis,
    );
  };

  const handleDeleteUserGroup = (groupName: string) => {
    // 计算会受影响的用户数量
    const affectedUsers =
      config?.UserConfig?.Users?.filter(
        (user) => user.tags && user.tags.includes(groupName),
      ) || [];

    setDeletingUserGroup({
      name: groupName,
      affectedUsers: affectedUsers.map((u) => ({
        username: u.username,
        role: u.role,
      })),
    });
    setShowDeleteUserGroupModal(true);
  };

  const handleConfirmDeleteUserGroup = async () => {
    if (!deletingUserGroup) return;

    try {
      await handleUserGroupAction('delete', deletingUserGroup.name);
      setShowDeleteUserGroupModal(false);
      setDeletingUserGroup(null);
    } catch {
      // 错误处理已在 handleUserGroupAction 中处理
    }
  };

  const handleStartEditUserGroup = (group: {
    name: string;
    enabledApis: string[];
  }) => {
    setEditingUserGroup({ ...group });
    setShowEditUserGroupForm(true);
    setShowAddUserGroupForm(false);
  };

  // 为用户分配用户组
  const handleAssignUserGroup = async (
    username: string,
    userGroups: string[],
  ) => {
    return withLoading(`assignUserGroup_${username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: username,
            action: 'updateUserGroups',
            userGroups,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        await refreshConfig();
        showSuccess('用户组分配成功', showAlert);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  const handleBanUser = async (uname: string) => {
    await withLoading(`banUser_${uname}`, () => handleUserAction('ban', uname));
  };

  const handleUnbanUser = async (uname: string) => {
    await withLoading(`unbanUser_${uname}`, () =>
      handleUserAction('unban', uname),
    );
  };

  const handleSetAdmin = async (uname: string) => {
    await withLoading(`setAdmin_${uname}`, () =>
      handleUserAction('setAdmin', uname),
    );
  };

  const handleRemoveAdmin = async (uname: string) => {
    await withLoading(`removeAdmin_${uname}`, () =>
      handleUserAction('cancelAdmin', uname),
    );
  };

  const handleAddUser = async () => {
    if (!newUser.username || !newUser.password) return;
    await withLoading('addUser', async () => {
      await handleUserAction(
        'add',
        newUser.username,
        newUser.password,
        newUser.userGroup,
      );
      setNewUser({ username: '', password: '', userGroup: '' });
      setShowAddUserForm(false);
    });
  };

  const handleChangePassword = async () => {
    if (!changePasswordUser.username || !changePasswordUser.password) return;
    await withLoading(
      `changePassword_${changePasswordUser.username}`,
      async () => {
        await handleUserAction(
          'changePassword',
          changePasswordUser.username,
          changePasswordUser.password,
        );
        setChangePasswordUser({ username: '', password: '' });
        setShowChangePasswordForm(false);
      },
    );
  };

  const handleShowChangePasswordForm = (username: string) => {
    setChangePasswordUser({ username, password: '' });
    setShowChangePasswordForm(true);
    setShowAddUserForm(false); // 关闭添加用户表单
  };

  const handleDeleteUser = (username: string) => {
    setDeletingUser(username);
    setShowDeleteUserModal(true);
  };

  const handleConfigureUserApis = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    enabledApis?: string[];
  }) => {
    setSelectedUser(user);
    setSelectedApis(user.enabledApis || []);
    setShowConfigureApisModal(true);
  };

  const handleConfigureUserGroup = (user: {
    username: string;
    role: 'user' | 'admin' | 'owner';
    tags?: string[];
  }) => {
    setSelectedUserForGroup(user);
    setSelectedUserGroups(user.tags || []);
    setShowConfigureUserGroupModal(true);
  };

  const handleSaveUserGroups = async () => {
    if (!selectedUserForGroup) return;

    await withLoading(
      `saveUserGroups_${selectedUserForGroup.username}`,
      async () => {
        try {
          await handleAssignUserGroup(
            selectedUserForGroup.username,
            selectedUserGroups,
          );
          setShowConfigureUserGroupModal(false);
          setSelectedUserForGroup(null);
          setSelectedUserGroups([]);
        } catch {
          // 错误处理已在 handleAssignUserGroup 中处理
        }
      },
    );
  };

  // 处理用户选择
  const handleSelectUser = useCallback((username: string, checked: boolean) => {
    setSelectedUsers((prev) => {
      const newSelectedUsers = new Set(prev);
      if (checked) {
        newSelectedUsers.add(username);
      } else {
        newSelectedUsers.delete(username);
      }
      return newSelectedUsers;
    });
  }, []);

  const handleSelectAllUsers = useCallback(
    (checked: boolean) => {
      if (checked) {
        // 只选择自己有权限操作的用户
        const selectableUsernames =
          config?.UserConfig?.Users?.filter(
            (user) =>
              role === 'owner' ||
              (role === 'admin' &&
                (user.role === 'user' || user.username === currentUsername)),
          ).map((u) => u.username) || [];
        setSelectedUsers(new Set(selectableUsernames));
      } else {
        setSelectedUsers(new Set());
      }
    },
    [config?.UserConfig?.Users, role, currentUsername],
  );

  // 批量设置用户组
  const handleBatchSetUserGroup = async (userGroup: string) => {
    if (selectedUsers.size === 0) return;

    await withLoading('batchSetUserGroup', async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'batchUpdateUserGroups',
            usernames: Array.from(selectedUsers),
            userGroups: userGroup === '' ? [] : [userGroup],
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        const userCount = selectedUsers.size;
        setSelectedUsers(new Set());
        setShowBatchUserGroupModal(false);
        setSelectedUserGroup('');
        showSuccess(
          `已为 ${userCount} 个用户设置用户组: ${userGroup}`,
          showAlert,
        );

        // 刷新配置
        await refreshConfig();
      } catch (err) {
        showError('批量设置用户组失败', showAlert);
        throw err;
      }
    });
  };

  // 提取URL域名的辅助函数
  const extractDomain = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      // 如果URL格式不正确，返回原字符串
      return url;
    }
  };

  const handleSaveUserApis = async () => {
    if (!selectedUser) return;

    await withLoading(`saveUserApis_${selectedUser.username}`, async () => {
      try {
        const res = await fetch('/api/admin/user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetUsername: selectedUser.username,
            action: 'updateUserApis',
            enabledApis: selectedApis,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `操作失败: ${res.status}`);
        }

        // 成功后刷新配置
        await refreshConfig();
        setShowConfigureApisModal(false);
        setSelectedUser(null);
        setSelectedApis([]);
      } catch (err) {
        showError(err instanceof Error ? err.message : '操作失败', showAlert);
        throw err;
      }
    });
  };

  // 通用请求函数
  const handleUserAction = async (
    action:
      | 'add'
      | 'ban'
      | 'unban'
      | 'setAdmin'
      | 'cancelAdmin'
      | 'changePassword'
      | 'deleteUser',
    targetUsername: string,
    targetPassword?: string,
    userGroup?: string,
  ) => {
    try {
      const res = await fetch('/api/admin/user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetUsername,
          ...(targetPassword ? { targetPassword } : {}),
          ...(userGroup ? { userGroup } : {}),
          action,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${res.status}`);
      }

      // 成功后刷新配置（无需整页刷新）
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
    }
  };

  const handleConfirmDeleteUser = async () => {
    if (!deletingUser) return;

    await withLoading(`deleteUser_${deletingUser}`, async () => {
      try {
        await handleUserAction('deleteUser', deletingUser);
        setShowDeleteUserModal(false);
        setDeletingUser(null);
      } catch {
        // 错误处理已在 handleUserAction 中处理
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 用户统计 */}
      <div>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
          用户统计
        </h4>
        <div className='p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800'>
          <div className='text-2xl font-bold text-green-800 dark:text-green-300'>
            {config.UserConfig.Users.length}
          </div>
          <div className='text-sm text-green-600 dark:text-green-400'>
            总用户数
          </div>
        </div>
      </div>

      {/* 用户组管理 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户组管理
          </h4>
          <button
            onClick={() => {
              setShowAddUserGroupForm(!showAddUserGroupForm);
              if (showEditUserGroupForm) {
                setShowEditUserGroupForm(false);
                setEditingUserGroup(null);
              }
            }}
            className={
              showAddUserGroupForm
                ? buttonStyles.secondary
                : buttonStyles.primary
            }
          >
            {showAddUserGroupForm ? '取消' : '添加用户组'}
          </button>
        </div>

        {/* 用户组列表 */}
        <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-80 overflow-y-auto overflow-x-auto relative'>
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  用户组名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  可用视频源
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
              {userGroups.map((group) => (
                <tr
                  key={group.name}
                  className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                >
                  <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                    {group.name}
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap'>
                    <div className='flex items-center space-x-2'>
                      <span className='text-sm text-gray-900 dark:text-gray-100'>
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `${group.enabledApis.length} 个源`
                          : '无限制'}
                      </span>
                    </div>
                  </td>
                  <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                    <button
                      onClick={() => handleStartEditUserGroup(group)}
                      disabled={isLoading(`userGroup_edit_${group.name}`)}
                      className={`${buttonStyles.roundedPrimary} ${
                        isLoading(`userGroup_edit_${group.name}`)
                          ? 'opacity-50 cursor-not-allowed'
                          : ''
                      }`}
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => handleDeleteUserGroup(group.name)}
                      className={buttonStyles.roundedDanger}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {userGroups.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className='px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400'
                  >
                    暂无用户组，请添加用户组来管理用户权限
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 用户列表 */}
      <div>
        <div className='flex items-center justify-between mb-3'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            用户列表
          </h4>
          <div className='flex items-center space-x-2'>
            {/* 批量操作按钮 */}
            {selectedUsers.size > 0 && (
              <>
                <div className='flex items-center space-x-3'>
                  <span className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择 {selectedUsers.size} 个用户
                  </span>
                  <button
                    onClick={() => setShowBatchUserGroupModal(true)}
                    className={buttonStyles.primary}
                  >
                    批量设置用户组
                  </button>
                </div>
                <div className='w-px h-6 bg-gray-300 dark:bg-gray-600'></div>
              </>
            )}
            <button
              onClick={() => {
                setShowAddUserForm(!showAddUserForm);
                if (showChangePasswordForm) {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }
              }}
              className={
                showAddUserForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddUserForm ? '取消' : '添加用户'}
            </button>
          </div>
        </div>

        {/* 添加用户表单 */}
        {showAddUserForm && (
          <div className='mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='space-y-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
                <input
                  type='text'
                  placeholder='用户名'
                  value={newUser.username}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      username: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
                <input
                  type='password'
                  placeholder='密码'
                  value={newUser.password}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      password: e.target.value,
                    }))
                  }
                  className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                  用户组（可选）
                </label>
                <select
                  value={newUser.userGroup}
                  onChange={(e) =>
                    setNewUser((prev) => ({
                      ...prev,
                      userGroup: e.target.value,
                    }))
                  }
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
                >
                  <option value=''>无用户组（无限制）</option>
                  {userGroups.map((group) => (
                    <option key={group.name} value={group.name}>
                      {group.name} (
                      {group.enabledApis && group.enabledApis.length > 0
                        ? `${group.enabledApis.length} 个源`
                        : '无限制'}
                      )
                    </option>
                  ))}
                </select>
              </div>
              <div className='flex justify-end'>
                <button
                  onClick={handleAddUser}
                  disabled={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                  }
                  className={
                    !newUser.username ||
                    !newUser.password ||
                    isLoading('addUser')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }
                >
                  {isLoading('addUser') ? '添加中...' : '添加'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 修改密码表单 */}
        {showChangePasswordForm && (
          <div className='mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-700'>
            <h5 className='text-sm font-medium text-blue-800 dark:text-blue-300 mb-3'>
              修改用户密码
            </h5>
            <div className='flex flex-col sm:flex-row gap-4 sm:gap-3'>
              <input
                type='text'
                placeholder='用户名'
                value={changePasswordUser.username}
                disabled
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 cursor-not-allowed'
              />
              <input
                type='password'
                placeholder='新密码'
                value={changePasswordUser.password}
                onChange={(e) =>
                  setChangePasswordUser((prev) => ({
                    ...prev,
                    password: e.target.value,
                  }))
                }
                className='flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              />
              <button
                onClick={handleChangePassword}
                disabled={
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                }
                className={`w-full sm:w-auto ${
                  !changePasswordUser.password ||
                  isLoading(`changePassword_${changePasswordUser.username}`)
                    ? buttonStyles.disabled
                    : buttonStyles.primary
                }`}
              >
                {isLoading(`changePassword_${changePasswordUser.username}`)
                  ? '修改中...'
                  : '修改密码'}
              </button>
              <button
                onClick={() => {
                  setShowChangePasswordForm(false);
                  setChangePasswordUser({ username: '', password: '' });
                }}
                className={`w-full sm:w-auto ${buttonStyles.secondary}`}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 用户列表 */}
        <div
          className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
          data-table='user-list'
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-4' />
                <th className='w-10 px-1 py-3 text-center'>
                  {(() => {
                    // 检查是否有权限操作任何用户
                    const hasAnyPermission = config?.UserConfig?.Users?.some(
                      (user) =>
                        role === 'owner' ||
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername)),
                    );

                    return hasAnyPermission ? (
                      <input
                        type='checkbox'
                        checked={selectAllUsers}
                        onChange={(e) => handleSelectAllUsers(e.target.checked)}
                        className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                      />
                    ) : (
                      <div className='w-4 h-4' />
                    );
                  })()}
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户名
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  角色
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  状态
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  用户组
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  采集源权限
                </th>
                <th
                  scope='col'
                  className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'
                >
                  操作
                </th>
              </tr>
            </thead>
            {/* 按规则排序用户：自己 -> 站长(若非自己) -> 管理员 -> 其他 */}
            {(() => {
              const sortedUsers = [...config.UserConfig.Users].sort((a, b) => {
                type UserInfo = (typeof config.UserConfig.Users)[number];
                const priority = (u: UserInfo) => {
                  if (u.username === currentUsername) return 0;
                  if (u.role === 'owner') return 1;
                  if (u.role === 'admin') return 2;
                  return 3;
                };
                return priority(a) - priority(b);
              });
              return (
                <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                  {sortedUsers.map((user) => {
                    // 修改密码权限：站长可修改管理员和普通用户密码，管理员可修改普通用户和自己的密码，但任何人都不能修改站长密码
                    const canChangePassword =
                      user.role !== 'owner' && // 不能修改站长密码
                      (role === 'owner' || // 站长可以修改管理员和普通用户密码
                        (role === 'admin' &&
                          (user.role === 'user' ||
                            user.username === currentUsername))); // 管理员可以修改普通用户和自己的密码

                    // 删除用户权限：站长可删除除自己外的所有用户，管理员仅可删除普通用户
                    const canDeleteUser =
                      user.username !== currentUsername &&
                      (role === 'owner' || // 站长可以删除除自己外的所有用户
                        (role === 'admin' && user.role === 'user')); // 管理员仅可删除普通用户

                    // 其他操作权限：不能操作自己，站长可操作所有用户，管理员可操作普通用户
                    const canOperate =
                      user.username !== currentUsername &&
                      (role === 'owner' ||
                        (role === 'admin' && user.role === 'user'));
                    return (
                      <tr
                        key={user.username}
                        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors'
                      >
                        <td className='w-4' />
                        <td className='w-10 px-1 py-3 text-center'>
                          {role === 'owner' ||
                          (role === 'admin' &&
                            (user.role === 'user' ||
                              user.username === currentUsername)) ? (
                            <input
                              type='checkbox'
                              checked={selectedUsers.has(user.username)}
                              onChange={(e) =>
                                handleSelectUser(
                                  user.username,
                                  e.target.checked,
                                )
                              }
                              className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                            />
                          ) : (
                            <div className='w-4 h-4' />
                          )}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-gray-100'>
                          {user.username}
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              user.role === 'owner'
                                ? 'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300'
                                : user.role === 'admin'
                                  ? 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {user.role === 'owner'
                              ? '站长'
                              : user.role === 'admin'
                                ? '管理员'
                                : '普通用户'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <span
                            className={`px-2 py-1 text-xs rounded-full ${
                              !user.banned
                                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
                            }`}
                          >
                            {!user.banned ? '正常' : '已封禁'}
                          </span>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-gray-900 dark:text-gray-100'>
                              {user.tags && user.tags.length > 0
                                ? user.tags.join(', ')
                                : '无用户组'}
                            </span>
                            {/* 配置用户组按钮 */}
                            {(role === 'owner' ||
                              (role === 'admin' &&
                                (user.role === 'user' ||
                                  user.username === currentUsername))) && (
                              <button
                                onClick={() => handleConfigureUserGroup(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                配置
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap'>
                          <div className='flex items-center space-x-2'>
                            <span className='text-sm text-gray-900 dark:text-gray-100'>
                              {user.enabledApis && user.enabledApis.length > 0
                                ? `${user.enabledApis.length} 个源`
                                : '无限制'}
                            </span>
                            {/* 配置采集源权限按钮 */}
                            {(role === 'owner' ||
                              (role === 'admin' &&
                                (user.role === 'user' ||
                                  user.username === currentUsername))) && (
                              <button
                                onClick={() => handleConfigureUserApis(user)}
                                className={buttonStyles.roundedPrimary}
                              >
                                配置
                              </button>
                            )}
                          </div>
                        </td>
                        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
                          {/* 修改密码按钮 */}
                          {canChangePassword && (
                            <button
                              onClick={() =>
                                handleShowChangePasswordForm(user.username)
                              }
                              className={buttonStyles.roundedPrimary}
                            >
                              修改密码
                            </button>
                          )}
                          {canOperate && (
                            <>
                              {/* 其他操作按钮 */}
                              {user.role === 'user' && (
                                <button
                                  onClick={() => handleSetAdmin(user.username)}
                                  disabled={isLoading(
                                    `setAdmin_${user.username}`,
                                  )}
                                  className={`${buttonStyles.roundedPurple} ${
                                    isLoading(`setAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  设为管理
                                </button>
                              )}
                              {user.role === 'admin' && (
                                <button
                                  onClick={() =>
                                    handleRemoveAdmin(user.username)
                                  }
                                  disabled={isLoading(
                                    `removeAdmin_${user.username}`,
                                  )}
                                  className={`${
                                    buttonStyles.roundedSecondary
                                  } ${
                                    isLoading(`removeAdmin_${user.username}`)
                                      ? 'opacity-50 cursor-not-allowed'
                                      : ''
                                  }`}
                                >
                                  取消管理
                                </button>
                              )}
                              {user.role !== 'owner' &&
                                (!user.banned ? (
                                  <button
                                    onClick={() => handleBanUser(user.username)}
                                    disabled={isLoading(
                                      `banUser_${user.username}`,
                                    )}
                                    className={`${buttonStyles.roundedDanger} ${
                                      isLoading(`banUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    封禁
                                  </button>
                                ) : (
                                  <button
                                    onClick={() =>
                                      handleUnbanUser(user.username)
                                    }
                                    disabled={isLoading(
                                      `unbanUser_${user.username}`,
                                    )}
                                    className={`${
                                      buttonStyles.roundedSuccess
                                    } ${
                                      isLoading(`unbanUser_${user.username}`)
                                        ? 'opacity-50 cursor-not-allowed'
                                        : ''
                                    }`}
                                  >
                                    解封
                                  </button>
                                ))}
                            </>
                          )}
                          {/* 删除用户按钮 - 放在最后，使用更明显的红色样式 */}
                          {canDeleteUser && (
                            <button
                              onClick={() => handleDeleteUser(user.username)}
                              className={buttonStyles.roundedDanger}
                            >
                              删除用户
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              );
            })()}
          </table>
        </div>
      </div>

      {/* 配置用户采集源权限弹窗 */}
      {showConfigureApisModal &&
        selectedUser &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowConfigureApisModal(false);
              setSelectedUser(null);
              setSelectedApis([]);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    配置用户采集源权限 - {selectedUser.username}
                  </h3>
                  <button
                    onClick={() => {
                      setShowConfigureApisModal(false);
                      setSelectedUser(null);
                      setSelectedApis([]);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='mb-6'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-blue-600 dark:text-blue-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                        配置说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
                      提示：全不选为无限制，选中的采集源将限制用户只能访问这些源
                    </p>
                  </div>
                </div>

                {/* 采集源选择 - 多列布局 */}
                <div className='mb-6'>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                    选择可用的采集源：
                  </h4>
                  <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
                    {config?.SourceConfig?.map((source) => (
                      <label
                        key={source.key}
                        className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                      >
                        <input
                          type='checkbox'
                          checked={selectedApis.includes(source.key)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedApis([...selectedApis, source.key]);
                            } else {
                              setSelectedApis(
                                selectedApis.filter(
                                  (api) => api !== source.key,
                                ),
                              );
                            }
                          }}
                          className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                        />
                        <div className='flex-1 min-w-0'>
                          <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                            {source.name}
                          </div>
                          {source.api && (
                            <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                              {extractDomain(source.api)}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 快速操作按钮 */}
                <div className='flex flex-wrap items-center justify-between mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg'>
                  <div className='flex space-x-2'>
                    <button
                      onClick={() => setSelectedApis([])}
                      className={buttonStyles.quickAction}
                    >
                      全不选（无限制）
                    </button>
                    <button
                      onClick={() => {
                        const allApis =
                          config?.SourceConfig?.filter(
                            (source) => !source.disabled,
                          ).map((s) => s.key) || [];
                        setSelectedApis(allApis);
                      }}
                      className={buttonStyles.quickAction}
                    >
                      全选
                    </button>
                  </div>
                  <div className='text-sm text-gray-600 dark:text-gray-400'>
                    已选择：
                    <span className='font-medium text-blue-600 dark:text-blue-400'>
                      {selectedApis.length > 0
                        ? `${selectedApis.length} 个源`
                        : '无限制'}
                    </span>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowConfigureApisModal(false);
                      setSelectedUser(null);
                      setSelectedApis([]);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveUserApis}
                    disabled={isLoading(
                      `saveUserApis_${selectedUser?.username}`,
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(`saveUserApis_${selectedUser?.username}`)
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading(`saveUserApis_${selectedUser?.username}`)
                      ? '配置中...'
                      : '确认配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 添加用户组弹窗 */}
      {showAddUserGroupForm &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowAddUserGroupForm(false);
              setNewUserGroup({ name: '', enabledApis: [] });
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    添加新用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowAddUserGroupForm(false);
                      setNewUserGroup({ name: '', enabledApis: [] });
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='space-y-6'>
                  {/* 用户组名称 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      用户组名称
                    </label>
                    <input
                      type='text'
                      placeholder='请输入用户组名称'
                      value={newUserGroup.name}
                      onChange={(e) =>
                        setNewUserGroup((prev) => ({
                          ...prev,
                          name: e.target.value,
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                    />
                  </div>

                  {/* 可用视频源 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      可用视频源
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                      {config?.SourceConfig?.map((source) => (
                        <label
                          key={source.key}
                          className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={newUserGroup.enabledApis.includes(
                              source.key,
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  enabledApis: [
                                    ...prev.enabledApis,
                                    source.key,
                                  ],
                                }));
                              } else {
                                setNewUserGroup((prev) => ({
                                  ...prev,
                                  enabledApis: prev.enabledApis.filter(
                                    (api) => api !== source.key,
                                  ),
                                }));
                              }
                            }}
                            className='rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                              {source.name}
                            </div>
                            {source.api && (
                              <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                                {extractDomain(source.api)}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 快速操作按钮 */}
                    <div className='mt-4 flex space-x-2'>
                      <button
                        onClick={() =>
                          setNewUserGroup((prev) => ({
                            ...prev,
                            enabledApis: [],
                          }))
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选（无限制）
                      </button>
                      <button
                        onClick={() => {
                          const allApis =
                            config?.SourceConfig?.filter(
                              (source) => !source.disabled,
                            ).map((s) => s.key) || [];
                          setNewUserGroup((prev) => ({
                            ...prev,
                            enabledApis: allApis,
                          }));
                        }}
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        setShowAddUserGroupForm(false);
                        setNewUserGroup({ name: '', enabledApis: [] });
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleAddUserGroup}
                      disabled={
                        !newUserGroup.name.trim() ||
                        isLoading('userGroup_add_new')
                      }
                      className={`px-6 py-2.5 text-sm font-medium ${
                        !newUserGroup.name.trim() ||
                        isLoading('userGroup_add_new')
                          ? buttonStyles.disabled
                          : buttonStyles.primary
                      }`}
                    >
                      {isLoading('userGroup_add_new')
                        ? '添加中...'
                        : '添加用户组'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 编辑用户组弹窗 */}
      {showEditUserGroupForm &&
        editingUserGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowEditUserGroupForm(false);
              setEditingUserGroup(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    编辑用户组 - {editingUserGroup.name}
                  </h3>
                  <button
                    onClick={() => {
                      setShowEditUserGroupForm(false);
                      setEditingUserGroup(null);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='space-y-6'>
                  {/* 可用视频源 */}
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-4'>
                      可用视频源
                    </label>
                    <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3'>
                      {config?.SourceConfig?.map((source) => (
                        <label
                          key={source.key}
                          className='flex items-center space-x-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors'
                        >
                          <input
                            type='checkbox'
                            checked={editingUserGroup.enabledApis.includes(
                              source.key,
                            )}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        enabledApis: [
                                          ...prev.enabledApis,
                                          source.key,
                                        ],
                                      }
                                    : null,
                                );
                              } else {
                                setEditingUserGroup((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        enabledApis: prev.enabledApis.filter(
                                          (api) => api !== source.key,
                                        ),
                                      }
                                    : null,
                                );
                              }
                            }}
                            className='rounded border-gray-300 text-purple-600 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-700'
                          />
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
                              {source.name}
                            </div>
                            {source.api && (
                              <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                                {extractDomain(source.api)}
                              </div>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>

                    {/* 快速操作按钮 */}
                    <div className='mt-4 flex space-x-2'>
                      <button
                        onClick={() =>
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, enabledApis: [] } : null,
                          )
                        }
                        className={buttonStyles.quickAction}
                      >
                        全不选（无限制）
                      </button>
                      <button
                        onClick={() => {
                          const allApis =
                            config?.SourceConfig?.filter(
                              (source) => !source.disabled,
                            ).map((s) => s.key) || [];
                          setEditingUserGroup((prev) =>
                            prev ? { ...prev, enabledApis: allApis } : null,
                          );
                        }}
                        className={buttonStyles.quickAction}
                      >
                        全选
                      </button>
                    </div>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-gray-700'>
                    <button
                      onClick={() => {
                        setShowEditUserGroupForm(false);
                        setEditingUserGroup(null);
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleEditUserGroup}
                      disabled={isLoading(
                        `userGroup_edit_${editingUserGroup?.name}`,
                      )}
                      className={`px-6 py-2.5 text-sm font-medium ${
                        isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                          ? buttonStyles.disabled
                          : buttonStyles.primary
                      }`}
                    >
                      {isLoading(`userGroup_edit_${editingUserGroup?.name}`)
                        ? '保存中...'
                        : '保存修改'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 配置用户组弹窗 */}
      {showConfigureUserGroupModal &&
        selectedUserForGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowConfigureUserGroupModal(false);
              setSelectedUserForGroup(null);
              setSelectedUserGroups([]);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-y-auto'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    配置用户组 - {selectedUserForGroup.username}
                  </h3>
                  <button
                    onClick={() => {
                      setShowConfigureUserGroupModal(false);
                      setSelectedUserForGroup(null);
                      setSelectedUserGroups([]);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='mb-6'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-blue-600 dark:text-blue-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                        配置说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400 mt-1'>
                      提示：选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                    </p>
                  </div>
                </div>

                {/* 用户组选择 - 下拉选择器 */}
                <div className='mb-6'>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    选择用户组：
                  </label>
                  <select
                    value={
                      selectedUserGroups.length > 0 ? selectedUserGroups[0] : ''
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setSelectedUserGroups(value ? [value] : []);
                    }}
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
                  >
                    <option value=''>无用户组（无限制）</option>
                    {userGroups.map((group) => (
                      <option key={group.name} value={group.name}>
                        {group.name}{' '}
                        {group.enabledApis && group.enabledApis.length > 0
                          ? `(${group.enabledApis.length} 个源)`
                          : ''}
                      </option>
                    ))}
                  </select>
                  <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                    选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowConfigureUserGroupModal(false);
                      setSelectedUserForGroup(null);
                      setSelectedUserGroups([]);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveUserGroups}
                    disabled={isLoading(
                      `saveUserGroups_${selectedUserForGroup?.username}`,
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(
                        `saveUserGroups_${selectedUserForGroup?.username}`,
                      )
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading(
                      `saveUserGroups_${selectedUserForGroup?.username}`,
                    )
                      ? '配置中...'
                      : '确认配置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 删除用户组确认弹窗 */}
      {showDeleteUserGroupModal &&
        deletingUserGroup &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowDeleteUserGroupModal(false);
              setDeletingUserGroup(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认删除用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowDeleteUserGroupModal(false);
                      setDeletingUserGroup(null);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='mb-6'>
                  <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-red-600 dark:text-red-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                        危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-red-700 dark:text-red-400'>
                      删除用户组 <strong>{deletingUserGroup.name}</strong>{' '}
                      将影响所有使用该组的用户，此操作不可恢复！
                    </p>
                  </div>

                  {deletingUserGroup.affectedUsers.length > 0 ? (
                    <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4'>
                      <div className='flex items-center space-x-2 mb-2'>
                        <svg
                          className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                          />
                        </svg>
                        <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                          ⚠️ 将影响 {deletingUserGroup.affectedUsers.length}{' '}
                          个用户：
                        </span>
                      </div>
                      <div className='space-y-1'>
                        {deletingUserGroup.affectedUsers.map((user, index) => (
                          <div
                            key={index}
                            className='text-sm text-yellow-700 dark:text-yellow-300'
                          >
                            • {user.username} ({user.role})
                          </div>
                        ))}
                      </div>
                      <p className='text-xs text-yellow-600 dark:text-yellow-400 mt-2'>
                        这些用户的用户组将被自动移除
                      </p>
                    </div>
                  ) : (
                    <div className='bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4'>
                      <div className='flex items-center space-x-2'>
                        <svg
                          className='w-5 h-5 text-green-600 dark:text-green-400'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth={2}
                            d='M5 13l4 4L19 7'
                          />
                        </svg>
                        <span className='text-sm font-medium text-green-800 dark:text-green-300'>
                          ✅ 当前没有用户使用此用户组
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowDeleteUserGroupModal(false);
                      setDeletingUserGroup(null);
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmDeleteUserGroup}
                    disabled={isLoading(
                      `userGroup_delete_${deletingUserGroup?.name}`,
                    )}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }`}
                  >
                    {isLoading(`userGroup_delete_${deletingUserGroup?.name}`)
                      ? '删除中...'
                      : '确认删除'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 删除用户确认弹窗 */}
      {showDeleteUserModal &&
        deletingUser &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowDeleteUserModal(false);
              setDeletingUser(null);
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认删除用户
                  </h3>
                  <button
                    onClick={() => {
                      setShowDeleteUserModal(false);
                      setDeletingUser(null);
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='mb-6'>
                  <div className='bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-red-600 dark:text-red-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-red-800 dark:text-red-300'>
                        危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-red-700 dark:text-red-400'>
                      删除用户 <strong>{deletingUser}</strong>{' '}
                      将同时删除其搜索历史、播放记录和收藏夹，此操作不可恢复！
                    </p>
                  </div>

                  {/* 操作按钮 */}
                  <div className='flex justify-end space-x-3'>
                    <button
                      onClick={() => {
                        setShowDeleteUserModal(false);
                        setDeletingUser(null);
                      }}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                    >
                      取消
                    </button>
                    <button
                      onClick={handleConfirmDeleteUser}
                      className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.danger}`}
                    >
                      确认删除
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 批量设置用户组弹窗 */}
      {showBatchUserGroupModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => {
              setShowBatchUserGroupModal(false);
              setSelectedUserGroup('');
            }}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    批量设置用户组
                  </h3>
                  <button
                    onClick={() => {
                      setShowBatchUserGroupModal(false);
                      setSelectedUserGroup('');
                    }}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='mb-6'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-blue-600 dark:text-blue-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-blue-800 dark:text-blue-300'>
                        批量操作说明
                      </span>
                    </div>
                    <p className='text-sm text-blue-700 dark:text-blue-400'>
                      将为选中的 <strong>{selectedUsers.size} 个用户</strong>{' '}
                      设置用户组，选择"无用户组"为无限制
                    </p>
                  </div>

                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      选择用户组：
                    </label>
                    <select
                      onChange={(e) => setSelectedUserGroup(e.target.value)}
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors'
                      value={selectedUserGroup}
                    >
                      <option value=''>无用户组（无限制）</option>
                      {userGroups.map((group) => (
                        <option key={group.name} value={group.name}>
                          {group.name}{' '}
                          {group.enabledApis && group.enabledApis.length > 0
                            ? `(${group.enabledApis.length} 个源)`
                            : ''}
                        </option>
                      ))}
                    </select>
                    <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
                      选择"无用户组"为无限制，选择特定用户组将限制用户只能访问该用户组允许的采集源
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => {
                      setShowBatchUserGroupModal(false);
                      setSelectedUserGroup('');
                    }}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={() => handleBatchSetUserGroup(selectedUserGroup)}
                    disabled={isLoading('batchSetUserGroup')}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading('batchSetUserGroup')
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading('batchSetUserGroup') ? '设置中...' : '确认设置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 视频源配置组件
const VideoSourceConfig = ({
  config,
  refreshConfig,
  storageMode,
  updateConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  storageMode: 'cloud' | 'local';
  updateConfig: (
    updater: (prev: AdminConfig | null) => AdminConfig | null,
  ) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [sources, setSources] = useState<DataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newSource, setNewSource] = useState<DataSource>({
    name: '',
    key: '',
    api: '',
    detail: '',
    disabled: false,
    from: 'config',
  });

  // 批量操作相关状态
  const [selectedSources, setSelectedSources] = useState<Set<string>>(
    new Set(),
  );

  // 使用 useMemo 计算全选状态，避免每次渲染都重新计算
  const selectAll = useMemo(() => {
    return selectedSources.size === sources.length && selectedSources.size > 0;
  }, [selectedSources.size, sources.length]);

  // 确认弹窗状态
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    onCancel: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
    onCancel: () => {},
  });

  // 有效性检测相关状态
  const [showValidationModal, setShowValidationModal] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [validationResults, setValidationResults] = useState<
    Array<{
      key: string;
      name: string;
      status: 'valid' | 'no_results' | 'invalid' | 'validating';
      message: string;
      resultCount: number;
    }>
  >([]);

  // 导入导出相关状态
  const [importExportModal, setImportExportModal] = useState<{
    isOpen: boolean;
    mode: 'import' | 'export' | 'result';
    result?: {
      success: number;
      failed: number;
      skipped: number;
      details: Array<{
        name: string;
        key: string;
        status: 'success' | 'failed' | 'skipped';
        reason?: string;
      }>;
    };
  }>({
    isOpen: false,
    mode: 'import',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.SourceConfig) {
      setSources(config.SourceConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
      // 重置选择状态
      setSelectedSources(new Set());
    }
  }, [config]);

  // 本地模式下直接更新配置
  const updateSourceConfigLocally = (
    action: string,
    payload: Record<string, any>,
  ) => {
    updateConfig((prev) => {
      if (!prev) return prev;
      const sources = [...(prev.SourceConfig || [])];

      switch (action) {
        case 'add': {
          const newSource: DataSource = {
            key: payload.key,
            name: payload.name,
            api: payload.api,
            detail: payload.detail || '',
            disabled: false,
            is_adult: payload.is_adult || false,
            from: 'custom',
          };
          sources.push(newSource);
          break;
        }
        case 'delete': {
          const idx = sources.findIndex((s) => s.key === payload.key);
          if (idx !== -1) sources.splice(idx, 1);
          break;
        }
        case 'enable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = false;
          break;
        }
        case 'disable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = true;
          break;
        }
        case 'update_adult': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.is_adult = payload.is_adult;
          break;
        }
        case 'sort': {
          if (payload.order && Array.isArray(payload.order)) {
            const orderMap = new Map(
              payload.order.map((key: string, idx: number) => [key, idx]),
            );
            sources.sort((a, b) => {
              const aIdx = orderMap.get(a.key) ?? 999;
              const bIdx = orderMap.get(b.key) ?? 999;
              return aIdx - bIdx;
            });
          }
          break;
        }
        case 'batch_enable': {
          payload.keys?.forEach((key: string) => {
            const source = sources.find((s) => s.key === key);
            if (source) source.disabled = false;
          });
          break;
        }
        case 'batch_disable': {
          payload.keys?.forEach((key: string) => {
            const source = sources.find((s) => s.key === key);
            if (source) source.disabled = true;
          });
          break;
        }
        case 'batch_delete': {
          payload.keys?.forEach((key: string) => {
            const idx = sources.findIndex((s) => s.key === key);
            if (idx !== -1) sources.splice(idx, 1);
          });
          break;
        }
      }

      return { ...prev, SourceConfig: sources };
    });
  };

  // 通用 API 请求
  const callSourceApi = async (body: Record<string, any>) => {
    // 本地模式：直接更新配置，不调用 API
    if (storageMode === 'local') {
      updateSourceConfigLocally(body.action, body);
      showAlert({
        type: 'success',
        title: '操作成功',
        message: '配置已保存到本地',
        timer: 2000,
      });
      return;
    }

    try {
      const resp = await fetch('/api/admin/source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));

        // 401 鉴权失败：保留表单，提示并引导重新登录
        if (resp.status === 401) {
          showError(
            data.error ||
              '登录已过期或未配置 AUTH_SECRET，请检查 Docker 环境变量后重新登录。',
            showAlert,
          );
          // 轻量跳转到登录页，避免多次点击无响应
          setTimeout(() => {
            window.location.href = '/login';
          }, 300);
          throw new Error('Unauthorized');
        }

        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleSource_${key}`, () =>
      callSourceApi({ action, key }),
    ).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleToggleAdult = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;
    const newAdultStatus = !target.is_adult;

    withLoading(`toggleAdult_${key}`, () =>
      callSourceApi({
        action: 'update_adult',
        key,
        is_adult: newAdultStatus,
      }),
    ).catch(() => {
      console.error('切换成人标记失败', key);
    });
  };

  const handleDelete = (key: string) => {
    const target = sources.find((s) => s.key === key);
    if (!target) return;

    // 检查是否是系统预设源
    if (target.from === 'config') {
      showAlert({
        type: 'warning',
        title: '无法删除系统预设源',
        message:
          `❌ "${target.name}" 是系统预设源（from=config），无法直接删除。\n\n` +
          `💡 此源来自「配置文件」标签页中的 JSON 配置。\n\n` +
          `如需删除，请：\n` +
          `1. 前往「配置文件」标签页\n` +
          `2. 修改或清空配置文件内容\n` +
          `3. 保存后即可删除对应的系统预设源\n\n` +
          `⚠️ 只有手动添加的自定义源可以直接删除。`,
      });
      return;
    }

    withLoading(`deleteSource_${key}`, () =>
      callSourceApi({ action: 'delete', key }),
    ).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  const handleAddSource = () => {
    if (!newSource.name || !newSource.key || !newSource.api) return;
    withLoading('addSource', async () => {
      await callSourceApi({
        action: 'add',
        key: newSource.key,
        name: newSource.name,
        api: newSource.api,
        detail: newSource.detail,
        is_adult: newSource.is_adult || false,
      });
      setNewSource({
        name: '',
        key: '',
        api: '',
        detail: '',
        disabled: false,
        is_adult: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newSource);
    });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = sources.findIndex((s) => s.key === active.id);
    const newIndex = sources.findIndex((s) => s.key === over.id);
    setSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = sources.map((s) => s.key);
    withLoading('saveSourceOrder', () =>
      callSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 批量标记/取消标记成人资源
  const handleBatchMarkAdult = async (markAsAdult: boolean) => {
    if (selectedSources.size === 0) {
      showAlert({
        type: 'warning',
        title: '请先选择要操作的视频源',
        message: '请选择至少一个视频源',
      });
      return;
    }

    const keys = Array.from(selectedSources);
    const loadingKey = markAsAdult
      ? 'batchSource_mark_adult'
      : 'batchSource_unmark_adult';

    try {
      await withLoading(loadingKey, async () => {
        // 逐个更新成人标记
        for (const key of keys) {
          await callSourceApi({
            action: 'update_adult',
            key,
            is_adult: markAsAdult,
          });
        }
      });

      showAlert({
        type: 'success',
        title: markAsAdult ? '批量标记成功' : '批量取消标记成功',
        message: `已${markAsAdult ? '标记' : '取消标记'} ${
          keys.length
        } 个视频源`,
        timer: 3000,
      });

      // 重置选择状态
      setSelectedSources(new Set());
    } catch (err) {
      showAlert({
        type: 'error',
        title: markAsAdult ? '批量标记失败' : '批量取消标记失败',
        message: err instanceof Error ? err.message : '操作失败',
      });
    }
  };

  // 有效性检测函数
  const handleValidateSources = async () => {
    if (!searchKeyword.trim()) {
      showAlert({
        type: 'warning',
        title: '请输入搜索关键词',
        message: '搜索关键词不能为空',
      });
      return;
    }

    await withLoading('validateSources', async () => {
      setIsValidating(true);
      setValidationResults([]); // 清空之前的结果
      setShowValidationModal(false); // 立即关闭弹窗

      // 初始化所有视频源为检测中状态
      const initialResults = sources.map((source) => ({
        key: source.key,
        name: source.name,
        status: 'validating' as const,
        message: '检测中...',
        resultCount: 0,
      }));
      setValidationResults(initialResults);

      try {
        // 使用EventSource接收流式数据
        const eventSource = new EventSource(
          `/api/admin/source/validate?q=${encodeURIComponent(
            searchKeyword.trim(),
          )}`,
        );

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);

            switch (data.type) {
              case 'start':
                console.log(`开始检测 ${data.totalSources} 个视频源`);
                break;

              case 'source_result':
              case 'source_error':
                // 更新验证结果
                setValidationResults((prev) => {
                  const existing = prev.find((r) => r.key === data.source);
                  if (existing) {
                    return prev.map((r) =>
                      r.key === data.source
                        ? {
                            key: data.source,
                            name:
                              sources.find((s) => s.key === data.source)
                                ?.name || data.source,
                            status: data.status,
                            message:
                              data.status === 'valid'
                                ? '搜索正常'
                                : data.status === 'no_results'
                                  ? '无法搜索到结果'
                                  : '连接失败',
                            resultCount: data.status === 'valid' ? 1 : 0,
                          }
                        : r,
                    );
                  } else {
                    return [
                      ...prev,
                      {
                        key: data.source,
                        name:
                          sources.find((s) => s.key === data.source)?.name ||
                          data.source,
                        status: data.status,
                        message:
                          data.status === 'valid'
                            ? '搜索正常'
                            : data.status === 'no_results'
                              ? '无法搜索到结果'
                              : '连接失败',
                        resultCount: data.status === 'valid' ? 1 : 0,
                      },
                    ];
                  }
                });
                break;

              case 'complete':
                console.log(
                  `检测完成，共检测 ${data.completedSources} 个视频源`,
                );
                eventSource.close();
                setIsValidating(false);
                break;
            }
          } catch (error) {
            console.error('解析EventSource数据失败:', error);
          }
        };

        eventSource.onerror = (error) => {
          console.error('EventSource错误:', error);
          eventSource.close();
          setIsValidating(false);
          showAlert({
            type: 'error',
            title: '验证失败',
            message: '连接错误，请重试',
          });
        };

        // 设置超时，防止长时间等待
        setTimeout(() => {
          if (eventSource.readyState === EventSource.OPEN) {
            eventSource.close();
            setIsValidating(false);
            showAlert({
              type: 'warning',
              title: '验证超时',
              message: '检测超时，请重试',
            });
          }
        }, 60000); // 60秒超时
      } catch (error) {
        setIsValidating(false);
        showAlert({
          type: 'error',
          title: '验证失败',
          message: error instanceof Error ? error.message : '未知错误',
        });
        throw error;
      }
    });
  };

  // 一键选中失效视频源（状态为 no_results 或 invalid）
  const handleSelectInvalidSources = useCallback(() => {
    const invalidKeys = validationResults
      .filter((r) => r.status === 'no_results' || r.status === 'invalid')
      .map((r) => r.key);

    if (invalidKeys.length === 0) {
      showAlert({
        type: 'warning',
        title: '没有失效的视频源',
        message: '当前没有检测到失效或无法搜索的视频源',
        timer: 3000,
      });
      return;
    }

    setSelectedSources(new Set(invalidKeys));
    showAlert({
      type: 'success',
      title: '已选中失效源',
      message: `已选中 ${invalidKeys.length} 个失效或无法搜索的视频源`,
      timer: 3000,
    });
  }, [validationResults, showAlert]);

  // 获取失效视频源数量
  const invalidSourceCount = useMemo(() => {
    return validationResults.filter(
      (r) => r.status === 'no_results' || r.status === 'invalid',
    ).length;
  }, [validationResults]);

  // 一键插入CSP模板
  const handleInsertCspTemplate = async () => {
    const cspTemplate = {
      name: 'CSP示例源（影视仓兼容）',
      key: `csp_demo_${Date.now()}`, // 使用时间戳避免重复key
      api: 'csp_AppYsV2',
      detail: JSON.stringify({
        jar: 'https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar;md5;a8b9c1d2e3f4',
        ext: 'https://raw.githubusercontent.com/FongMi/CatVodSpider/main/json/config.json',
        type: 3,
        searchable: 1,
        quickSearch: 1,
        filterable: 1,
      }),
      disabled: false,
      from: 'config',
    };

    try {
      await withLoading('insertCspTemplate', async () => {
        await callSourceApi({
          action: 'add',
          key: cspTemplate.key,
          name: cspTemplate.name,
          api: cspTemplate.api,
          detail: cspTemplate.detail,
        });
      });

      showAlert({
        type: 'success',
        title: 'CSP模板插入成功',
        message: '已成功插入CSP示例源，可用于验证CSP/jar功能',
        timer: 3000,
      });
    } catch (err) {
      showAlert({
        type: 'error',
        title: 'CSP模板插入失败',
        message: err instanceof Error ? err.message : '插入失败',
      });
    }
  };

  // 导出视频源
  const handleExportSources = (exportFormat: 'array' | 'config' = 'array') => {
    try {
      // 获取要导出的源（如果有选中则导出选中的，否则导出全部）
      const sourcesToExport =
        selectedSources.size > 0
          ? sources.filter((s) => selectedSources.has(s.key))
          : sources;

      if (sourcesToExport.length === 0) {
        showAlert({
          type: 'warning',
          title: '没有可导出的视频源',
          message: '请先添加视频源或选择要导出的视频源',
        });
        return;
      }

      let exportData: any;
      let filename: string;
      const now = new Date();
      const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);

      if (exportFormat === 'config') {
        // 配置文件格式: { api_site: { key: { name, api, detail, is_adult } } }
        const apiSiteObj: Record<
          string,
          {
            name: string;
            api: string;
            detail?: string;
            is_adult?: boolean;
          }
        > = {};

        sourcesToExport.forEach((source) => {
          apiSiteObj[source.key] = {
            name: source.name,
            api: source.api,
          };
          if (source.detail) {
            apiSiteObj[source.key].detail = source.detail;
          }
          if (source.is_adult) {
            apiSiteObj[source.key].is_adult = source.is_adult;
          }
        });

        exportData = {
          api_site: apiSiteObj,
        };
        filename = `config_${timestamp}.json`;
      } else {
        // 数组格式（用于导入功能）
        exportData = sourcesToExport.map((source) => ({
          name: source.name,
          key: source.key,
          api: source.api,
          detail: source.detail || '',
          disabled: source.disabled || false,
          is_adult: source.is_adult || false,
        }));
        filename = `video_sources_${timestamp}.json`;
      }

      // 创建下载
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const formatText =
        exportFormat === 'config' ? '配置文件格式' : '数组格式';
      showAlert({
        type: 'success',
        title: '导出成功',
        message: `已导出 ${sourcesToExport.length} 个视频源（${formatText}）到 ${filename}`,
        timer: 3000,
      });

      // 关闭模态框
      setImportExportModal({ isOpen: false, mode: 'export' });
    } catch (err) {
      showAlert({
        type: 'error',
        title: '导出失败',
        message: err instanceof Error ? err.message : '未知错误',
      });
    }
  };

  // 导入视频源
  const handleImportSources = async (
    file: File,
    onProgress?: (current: number, total: number) => void,
  ) => {
    try {
      const text = await file.text();
      const importData = JSON.parse(text);

      if (!Array.isArray(importData)) {
        throw new Error('JSON 格式错误：应为数组格式');
      }

      const result = {
        success: 0,
        failed: 0,
        skipped: 0,
        details: [] as Array<{
          name: string;
          key: string;
          status: 'success' | 'failed' | 'skipped';
          reason?: string;
        }>,
      };

      const total = importData.length;

      // 逐个导入，并更新进度
      for (let i = 0; i < importData.length; i++) {
        const item = importData[i];

        // 更新进度
        if (onProgress) {
          onProgress(i + 1, total);
        }
        try {
          // 验证必要字段
          if (!item.name || !item.key || !item.api) {
            result.failed++;
            result.details.push({
              name: item.name || '未知',
              key: item.key || '未知',
              status: 'failed',
              reason: '缺少必要字段（name、key 或 api）',
            });
            continue;
          }

          // 检查是否已存在
          const exists = sources.find((s) => s.key === item.key);
          if (exists) {
            result.skipped++;
            result.details.push({
              name: item.name,
              key: item.key,
              status: 'skipped',
              reason: '该 key 已存在，跳过导入',
            });
            continue;
          }

          // 导入
          await callSourceApi({
            action: 'add',
            key: item.key,
            name: item.name,
            api: item.api,
            detail: item.detail || '',
            is_adult: item.is_adult || false,
          });

          result.success++;
          result.details.push({
            name: item.name,
            key: item.key,
            status: 'success',
          });
        } catch (err) {
          result.failed++;
          result.details.push({
            name: item.name,
            key: item.key,
            status: 'failed',
            reason: err instanceof Error ? err.message : '导入失败',
          });
        }
      }

      // 显示结果
      setImportExportModal({
        isOpen: true,
        mode: 'result',
        result,
      });

      // 如果有成功导入的，刷新配置
      if (result.success > 0) {
        await refreshConfig();
      }
    } catch (err) {
      showAlert({
        type: 'error',
        title: '导入失败',
        message: err instanceof Error ? err.message : '文件解析失败',
      });
      setImportExportModal({ isOpen: false, mode: 'import' });
    }

    return {
      success: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };
  };

  // 获取有效性状态显示
  const getValidationStatus = (sourceKey: string) => {
    const result = validationResults.find((r) => r.key === sourceKey);
    if (!result) return null;

    switch (result.status) {
      case 'validating':
        return {
          text: '检测中',
          className:
            'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300',
          icon: '⟳',
          message: result.message,
        };
      case 'valid':
        return {
          text: '有效',
          className:
            'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300',
          icon: '✓',
          message: result.message,
        };
      case 'no_results':
        return {
          text: '无法搜索',
          className:
            'bg-yellow-100 dark:bg-yellow-900/20 text-yellow-800 dark:text-yellow-300',
          icon: '⚠',
          message: result.message,
        };
      case 'invalid':
        return {
          text: '无效',
          className:
            'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300',
          icon: '✗',
          message: result.message,
        };
      default:
        return null;
    }
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ source }: { source: DataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: source.key });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-2 py-4 text-center'>
          <input
            type='checkbox'
            checked={selectedSources.has(source.key)}
            onChange={(e) => handleSelectSource(source.key, e.target.checked)}
            className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
          />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          <div className='flex items-center space-x-2'>
            <span>{source.name}</span>
            {source.from === 'config' && (
              <span
                className='px-1.5 py-0.5 text-[10px] font-medium rounded bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300'
                title='系统预设源，不可删除'
              >
                预设
              </span>
            )}
          </div>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {source.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
          title={source.api}
        >
          {source.api}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
          title={source.detail || '-'}
        >
          {source.detail || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !source.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!source.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-center'>
          <button
            onClick={() => handleToggleAdult(source.key)}
            disabled={isLoading(`toggleAdult_${source.key}`)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
              source.is_adult
                ? 'bg-linear-to-r from-red-500 to-pink-500'
                : 'bg-gray-300 dark:bg-gray-600'
            } ${
              isLoading(`toggleAdult_${source.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : 'cursor-pointer hover:opacity-80'
            }`}
            title={source.is_adult ? '成人资源' : '普通资源'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                source.is_adult ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          {(() => {
            const status = getValidationStatus(source.key);
            if (!status) {
              return (
                <span className='px-2 py-1 text-xs rounded-full bg-gray-100 dark:bg-gray-900/20 text-gray-600 dark:text-gray-400'>
                  未检测
                </span>
              );
            }
            return (
              <span
                className={`px-2 py-1 text-xs rounded-full ${status.className}`}
                title={status.message}
              >
                {status.icon} {status.text}
              </span>
            );
          })()}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(source.key)}
            disabled={isLoading(`toggleSource_${source.key}`)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !source.disabled
                ? buttonStyles.roundedDanger
                : buttonStyles.roundedSuccess
            } transition-colors ${
              isLoading(`toggleSource_${source.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {!source.disabled ? '禁用' : '启用'}
          </button>
          {source.from !== 'config' && (
            <button
              onClick={() => handleDelete(source.key)}
              disabled={isLoading(`deleteSource_${source.key}`)}
              className={`${buttonStyles.roundedSecondary} ${
                isLoading(`deleteSource_${source.key}`)
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  };

  // 全选/取消全选
  const handleSelectAll = useCallback(
    (checked: boolean) => {
      if (checked) {
        const allKeys = sources.map((s) => s.key);
        setSelectedSources(new Set(allKeys));
      } else {
        setSelectedSources(new Set());
      }
    },
    [sources],
  );

  // 单个选择
  const handleSelectSource = useCallback((key: string, checked: boolean) => {
    setSelectedSources((prev) => {
      const newSelected = new Set(prev);
      if (checked) {
        newSelected.add(key);
      } else {
        newSelected.delete(key);
      }
      return newSelected;
    });
  }, []);

  // 批量操作
  const handleBatchOperation = async (
    action: 'batch_enable' | 'batch_disable' | 'batch_delete',
  ) => {
    if (selectedSources.size === 0) {
      showAlert({
        type: 'warning',
        title: '请先选择要操作的视频源',
        message: '请选择至少一个视频源',
      });
      return;
    }

    const keys = Array.from(selectedSources);
    let confirmMessage = '';
    let actionName = '';

    // 对于批量删除，检查哪些是可以删除的（from='custom'）
    if (action === 'batch_delete') {
      const deletableSources = sources.filter(
        (s) => selectedSources.has(s.key) && s.from === 'custom',
      );
      const undeletableSources = sources.filter(
        (s) => selectedSources.has(s.key) && s.from !== 'custom',
      );

      if (deletableSources.length === 0) {
        showAlert({
          type: 'warning',
          title: '无法删除',
          message:
            '❌ 选中的视频源都是系统预设源（from=config），无法删除。\n\n' +
            '💡 这些源来自「配置文件」标签页中的 JSON 配置。\n\n' +
            '如需删除，请：\n' +
            '1. 前往「配置文件」标签页\n' +
            '2. 修改或清空配置文件内容\n' +
            '3. 保存后即可删除对应的系统预设源\n\n' +
            '⚠️ 只有手动添加的自定义源可以直接删除。',
        });
        return;
      }

      if (undeletableSources.length > 0) {
        confirmMessage =
          `将删除 ${deletableSources.length} 个自定义源。\n\n` +
          `⚠️ 注意：以下 ${undeletableSources.length} 个系统预设源无法删除（需在配置文件中修改）：\n` +
          `${undeletableSources.map((s) => `• ${s.name}`).join('\n')}`;
      } else {
        confirmMessage = `确定要删除选中的 ${deletableSources.length} 个自定义视频源吗？\n\n此操作不可恢复！`;
      }
      actionName = '批量删除';
    } else {
      switch (action) {
        case 'batch_enable':
          confirmMessage = `确定要启用选中的 ${keys.length} 个视频源吗？`;
          actionName = '批量启用';
          break;
        case 'batch_disable':
          confirmMessage = `确定要禁用选中的 ${keys.length} 个视频源吗？`;
          actionName = '批量禁用';
          break;
      }
    }

    // 显示确认弹窗
    setConfirmModal({
      isOpen: true,
      title: '确认操作',
      message: confirmMessage,
      onConfirm: async () => {
        try {
          await withLoading(`batchSource_${action}`, () =>
            callSourceApi({ action, keys }),
          );

          // 对于删除操作，显示实际删除的数量
          if (action === 'batch_delete') {
            const deletableCount = sources.filter(
              (s) => selectedSources.has(s.key) && s.from === 'custom',
            ).length;
            const undeletableCount = sources.filter(
              (s) => selectedSources.has(s.key) && s.from !== 'custom',
            ).length;

            if (undeletableCount > 0) {
              showAlert({
                type: 'warning',
                title: `部分删除成功`,
                message:
                  `✅ 成功删除了 ${deletableCount} 个自定义视频源\n` +
                  `⚠️ 跳过了 ${undeletableCount} 个系统预设源\n\n` +
                  `💡 提示：系统预设源需要在「配置文件」中修改`,
                timer: 5000,
              });
            } else {
              showAlert({
                type: 'success',
                title: `${actionName}成功`,
                message: `✅ 成功删除了 ${deletableCount} 个自定义视频源`,
                timer: 2000,
              });
            }
          } else {
            showAlert({
              type: 'success',
              title: `${actionName}成功`,
              message: `${actionName}了 ${keys.length} 个视频源`,
              timer: 2000,
            });
          }

          // 重置选择状态
          setSelectedSources(new Set());
        } catch (err) {
          showAlert({
            type: 'error',
            title: `${actionName}失败`,
            message: err instanceof Error ? err.message : '操作失败',
          });
        }
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
      onCancel: () => {
        setConfirmModal({
          isOpen: false,
          title: '',
          message: '',
          onConfirm: () => {},
          onCancel: () => {},
        });
      },
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 说明提示区域 */}
      {sources.some((s) => s.from === 'config') && (
        <div className='bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4'>
          <div className='flex items-start space-x-3'>
            <div className='shrink-0 mt-0.5'>
              <svg
                className='w-5 h-5 text-blue-600 dark:text-blue-400'
                fill='currentColor'
                viewBox='0 0 20 20'
              >
                <path
                  fillRule='evenodd'
                  d='M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z'
                  clipRule='evenodd'
                />
              </svg>
            </div>
            <div className='flex-1'>
              <h4 className='text-sm font-medium text-blue-900 dark:text-blue-200 mb-1'>
                💡 关于系统预设源
              </h4>
              <p className='text-xs text-blue-800 dark:text-blue-300'>
                标记为「预设」的视频源来自「配置文件」标签页，无法直接删除。如需删除，请在「配置文件」中修改或清空
                JSON 配置后保存。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 添加视频源表单 */}
      <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          视频源列表
        </h4>
        <div className='flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-2'>
          {/* 批量操作按钮 - 移动端显示在下一行，PC端显示在左侧 */}
          {selectedSources.size > 0 && (
            <>
              <div className='flex flex-wrap items-center gap-3 order-2 sm:order-1'>
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  <span className='sm:hidden'>已选 {selectedSources.size}</span>
                  <span className='hidden sm:inline'>
                    已选择 {selectedSources.size} 个视频源
                  </span>
                </span>
                <button
                  onClick={() => handleBatchOperation('batch_enable')}
                  disabled={isLoading('batchSource_batch_enable')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_batch_enable')
                      ? buttonStyles.disabled
                      : buttonStyles.success
                  }`}
                >
                  {isLoading('batchSource_batch_enable')
                    ? '启用中...'
                    : '批量启用'}
                </button>
                <button
                  onClick={() => handleBatchOperation('batch_disable')}
                  disabled={isLoading('batchSource_batch_disable')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_batch_disable')
                      ? buttonStyles.disabled
                      : buttonStyles.warning
                  }`}
                >
                  {isLoading('batchSource_batch_disable')
                    ? '禁用中...'
                    : '批量禁用'}
                </button>
                <button
                  onClick={() => handleBatchOperation('batch_delete')}
                  disabled={isLoading('batchSource_batch_delete')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_batch_delete')
                      ? buttonStyles.disabled
                      : buttonStyles.danger
                  }`}
                >
                  {isLoading('batchSource_batch_delete')
                    ? '删除中...'
                    : '批量删除'}
                </button>
                <button
                  onClick={() => handleBatchMarkAdult(true)}
                  disabled={isLoading('batchSource_mark_adult')}
                  className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                    isLoading('batchSource_mark_adult')
                      ? 'bg-gray-400 cursor-not-allowed'
                      : 'bg-linear-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600 text-white'
                  }`}
                  title='将选中的视频源标记为成人资源'
                >
                  <span className='text-base'>🔞</span>
                  {isLoading('batchSource_mark_adult')
                    ? '标记中...'
                    : '标记成人'}
                </button>
                <button
                  onClick={() => handleBatchMarkAdult(false)}
                  disabled={isLoading('batchSource_unmark_adult')}
                  className={`px-3 py-1 text-sm ${
                    isLoading('batchSource_unmark_adult')
                      ? buttonStyles.disabled
                      : buttonStyles.secondary
                  }`}
                  title='将选中的视频源标记为普通资源'
                >
                  {isLoading('batchSource_unmark_adult')
                    ? '取消中...'
                    : '取消标记'}
                </button>
              </div>
              <div className='hidden sm:block w-px h-6 bg-gray-300 dark:bg-gray-600 order-2'></div>
            </>
          )}
          <div className='flex items-center gap-2 order-1 sm:order-2'>
            <button
              onClick={() =>
                setImportExportModal({ isOpen: true, mode: 'import' })
              }
              className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 bg-linear-to-r from-blue-600 to-cyan-500 hover:from-blue-700 hover:to-cyan-600 text-white'
              title='从 JSON 文件导入视频源'
            >
              <Upload className='w-4 h-4' />
              <span className='hidden sm:inline'>导入视频源</span>
              <span className='sm:hidden'>导入</span>
            </button>
            <button
              onClick={() =>
                setImportExportModal({ isOpen: true, mode: 'export' })
              }
              className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 bg-linear-to-r from-green-600 to-emerald-500 hover:from-green-700 hover:to-emerald-600 text-white'
              title={
                selectedSources.size > 0
                  ? `导出选中的 ${selectedSources.size} 个视频源`
                  : '导出所有视频源'
              }
            >
              <Download className='w-4 h-4' />
              <span className='hidden sm:inline'>
                {selectedSources.size > 0
                  ? `导出已选(${selectedSources.size})`
                  : '导出视频源'}
              </span>
              <span className='sm:hidden'>导出</span>
            </button>
            <button
              onClick={() => setShowValidationModal(true)}
              disabled={isValidating}
              className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                isValidating ? buttonStyles.disabled : buttonStyles.primary
              }`}
            >
              {isValidating ? (
                <>
                  <div className='w-3 h-3 border border-white border-t-transparent rounded-full animate-spin'></div>
                  <span>检测中...</span>
                </>
              ) : (
                '有效性检测'
              )}
            </button>
            {/* 选中失效源按钮 - 只在有检测结果且存在失效源时显示 */}
            {!isValidating && invalidSourceCount > 0 && (
              <button
                onClick={handleSelectInvalidSources}
                className='px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1.5 bg-linear-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white shadow-sm hover:shadow-md'
                title={`一键选中 ${invalidSourceCount} 个失效或无法搜索的视频源`}
              >
                <svg
                  className='w-4 h-4'
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
                <span className='hidden sm:inline'>
                  选中失效源({invalidSourceCount})
                </span>
                <span className='sm:hidden'>{invalidSourceCount}</span>
              </button>
            )}
            <button
              onClick={handleInsertCspTemplate}
              disabled={isLoading('insertCspTemplate')}
              className={`px-3 py-1 text-sm rounded-lg transition-colors flex items-center space-x-1 ${
                isLoading('insertCspTemplate')
                  ? buttonStyles.disabled
                  : buttonStyles.roundedPurple.replace(
                      'inline-flex items-center px-3 py-1.5 rounded-full text-xs',
                      'px-3 py-1 text-sm rounded-lg',
                    )
              }`}
              title='一键插入CSP模板源，用于快速验证CSP/jar功能'
            >
              {isLoading('insertCspTemplate') ? (
                <>
                  <div className='w-3 h-3 border border-white border-t-transparent rounded-full animate-spin'></div>
                  <span>插入中...</span>
                </>
              ) : (
                '插入CSP模板'
              )}
            </button>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className={
                showAddForm ? buttonStyles.secondary : buttonStyles.success
              }
            >
              {showAddForm ? '取消' : '添加视频源'}
            </button>
          </div>
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newSource.name}
              onChange={(e) => {
                const name = e.target.value;
                setNewSource((prev) => ({
                  ...prev,
                  name,
                  // 智能检测:如果名称以 AV-、成人、伦理 等开头,自动标记为成人资源
                  is_adult:
                    /^(AV-|成人|伦理|福利|里番|R18)/i.test(name) ||
                    prev.is_adult,
                }));
              }}
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newSource.key}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='API 地址'
              value={newSource.api}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, api: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Detail 地址（选填）'
              value={newSource.detail}
              onChange={(e) =>
                setNewSource((prev) => ({ ...prev, detail: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>

          {/* 成人资源标记 */}
          <div className='flex items-center justify-between p-3 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700'>
            <div className='flex items-center space-x-2'>
              <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                标记为成人资源
              </span>
              {newSource.is_adult && (
                <span className='px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'>
                  🔞 成人
                </span>
              )}
            </div>
            <button
              type='button'
              onClick={() =>
                setNewSource((prev) => ({ ...prev, is_adult: !prev.is_adult }))
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                newSource.is_adult
                  ? 'bg-linear-to-r from-red-500 to-pink-500'
                  : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  newSource.is_adult ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          <div className='flex justify-end'>
            <button
              onClick={handleAddSource}
              disabled={
                !newSource.name ||
                !newSource.key ||
                !newSource.api ||
                isLoading('addSource')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newSource.name ||
                !newSource.key ||
                !newSource.api ||
                isLoading('addSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addSource') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 视频源表格 */}
      <div
        className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
        data-table='source-list'
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-8' />
                <th className='w-12 px-2 py-3 text-center'>
                  <input
                    type='checkbox'
                    checked={selectAll}
                    onChange={(e) => handleSelectAll(e.target.checked)}
                    className='w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600'
                  />
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  API 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Detail 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  成人资源
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  有效性
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={sources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {sources.map((source) => (
                  <DraggableRow key={source.key} source={source} />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 有效性检测弹窗 */}
      {showValidationModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50'
            onClick={() => setShowValidationModal(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4'
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className='text-lg font-medium text-gray-900 dark:text-gray-100 mb-4'>
                视频源有效性检测
              </h3>
              <p className='text-sm text-gray-600 dark:text-gray-400 mb-4'>
                请输入检测用的搜索关键词
              </p>
              <div className='space-y-4'>
                <input
                  type='text'
                  placeholder='请输入搜索关键词'
                  value={searchKeyword}
                  onChange={(e) => setSearchKeyword(e.target.value)}
                  className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
                  onKeyPress={(e) =>
                    e.key === 'Enter' && handleValidateSources()
                  }
                />
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowValidationModal(false)}
                    className='px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors'
                  >
                    取消
                  </button>
                  <button
                    onClick={handleValidateSources}
                    disabled={!searchKeyword.trim()}
                    className={`px-4 py-2 ${
                      !searchKeyword.trim()
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    开始检测
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />

      {/* 导入导出模态框 */}
      {importExportModal.isOpen && (
        <ImportExportModal
          isOpen={importExportModal.isOpen}
          mode={importExportModal.mode}
          onClose={() =>
            setImportExportModal({ isOpen: false, mode: 'import' })
          }
          onImport={handleImportSources}
          onExport={handleExportSources}
          result={importExportModal.result}
        />
      )}

      {/* 批量操作确认弹窗 */}
      {confirmModal.isOpen &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={confirmModal.onCancel}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-4'>
                  <h3 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
                    {confirmModal.title}
                  </h3>
                  <button
                    onClick={confirmModal.onCancel}
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

                <div className='mb-6'>
                  <p className='text-sm text-gray-600 dark:text-gray-400 whitespace-pre-line'>
                    {confirmModal.message}
                  </p>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={confirmModal.onCancel}
                    className={`px-4 py-2 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={confirmModal.onConfirm}
                    disabled={
                      isLoading('batchSource_batch_enable') ||
                      isLoading('batchSource_batch_disable') ||
                      isLoading('batchSource_batch_delete')
                    }
                    className={`px-4 py-2 text-sm font-medium ${
                      isLoading('batchSource_batch_enable') ||
                      isLoading('batchSource_batch_disable') ||
                      isLoading('batchSource_batch_delete')
                        ? buttonStyles.disabled
                        : buttonStyles.primary
                    }`}
                  >
                    {isLoading('batchSource_batch_enable') ||
                    isLoading('batchSource_batch_disable') ||
                    isLoading('batchSource_batch_delete')
                      ? '操作中...'
                      : '确认'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
};

// 分类配置组件
const CategoryConfig = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [categories, setCategories] = useState<CustomCategory[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [newCategory, setNewCategory] = useState<CustomCategory>({
    name: '',
    type: 'movie',
    query: '',
    disabled: false,
    from: 'config',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.CustomCategories) {
      setCategories(config.CustomCategories);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 通用 API 请求
  const callCategoryApi = async (body: Record<string, any>) => {
    try {
      const resp = await fetch('/api/admin/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (query: string, type: 'movie' | 'tv') => {
    const target = categories.find((c) => c.query === query && c.type === type);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleCategory_${query}_${type}`, () =>
      callCategoryApi({ action, query, type }),
    ).catch(() => {
      console.error('操作失败', action, query, type);
    });
  };

  const handleDelete = (query: string, type: 'movie' | 'tv') => {
    withLoading(`deleteCategory_${query}_${type}`, () =>
      callCategoryApi({ action: 'delete', query, type }),
    ).catch(() => {
      console.error('操作失败', 'delete', query, type);
    });
  };

  const handleAddCategory = () => {
    if (!newCategory.name || !newCategory.query) return;
    withLoading('addCategory', async () => {
      await callCategoryApi({
        action: 'add',
        name: newCategory.name,
        type: newCategory.type,
        query: newCategory.query,
      });
      setNewCategory({
        name: '',
        type: 'movie',
        query: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newCategory);
    });
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === active.id,
    );
    const newIndex = categories.findIndex(
      (c) => `${c.query}:${c.type}` === over.id,
    );
    setCategories((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = categories.map((c) => `${c.query}:${c.type}`);
    withLoading('saveCategoryOrder', () =>
      callCategoryApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ category }: { category: CustomCategory }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: `${category.query}:${category.type}` });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...{ ...attributes, ...listeners }}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {category.name || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              category.type === 'movie'
                ? 'bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-300'
                : 'bg-purple-100 dark:bg-purple-900/20 text-purple-800 dark:text-purple-300'
            }`}
          >
            {category.type === 'movie' ? '电影' : '电视剧'}
          </span>
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
          title={category.query}
        >
          {category.query}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !category.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!category.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(category.query, category.type)}
            disabled={isLoading(
              `toggleCategory_${category.query}_${category.type}`,
            )}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !category.disabled
                ? buttonStyles.roundedDanger
                : buttonStyles.roundedSuccess
            } transition-colors ${
              isLoading(`toggleCategory_${category.query}_${category.type}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {!category.disabled ? '禁用' : '启用'}
          </button>
          {category.from !== 'config' && (
            <button
              onClick={() => handleDelete(category.query, category.type)}
              disabled={isLoading(
                `deleteCategory_${category.query}_${category.type}`,
              )}
              className={`${buttonStyles.roundedSecondary} ${
                isLoading(`deleteCategory_${category.query}_${category.type}`)
                  ? 'opacity-50 cursor-not-allowed'
                  : ''
              }`}
            >
              删除
            </button>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加分类表单 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          自定义分类列表
        </h4>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className={`px-3 py-1 text-sm rounded-lg transition-colors ${
            showAddForm ? buttonStyles.secondary : buttonStyles.success
          }`}
        >
          {showAddForm ? '取消' : '添加分类'}
        </button>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='分类名称'
              value={newCategory.name}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <select
              value={newCategory.type}
              onChange={(e) =>
                setNewCategory((prev) => ({
                  ...prev,
                  type: e.target.value as 'movie' | 'tv',
                }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            >
              <option value='movie'>电影</option>
              <option value='tv'>电视剧</option>
            </select>
            <input
              type='text'
              placeholder='搜索关键词'
              value={newCategory.query}
              onChange={(e) =>
                setNewCategory((prev) => ({ ...prev, query: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddCategory}
              disabled={
                !newCategory.name ||
                !newCategory.query ||
                isLoading('addCategory')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newCategory.name ||
                !newCategory.query ||
                isLoading('addCategory')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addCategory') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 分类表格 */}
      <div className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-8' />
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  分类名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  类型
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  搜索关键词
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={categories.map((c) => `${c.query}:${c.type}`)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {categories.map((category) => (
                  <DraggableRow
                    key={`${category.query}:${category.type}`}
                    category={category}
                  />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveCategoryOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveCategoryOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveCategoryOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 新增配置文件组件
const ConfigFileComponent = ({
  config,
  refreshConfig,
  storageMode,
  updateConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  storageMode: 'cloud' | 'local';
  updateConfig: (
    updater: (prev: AdminConfig | null) => AdminConfig | null,
  ) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [configContent, setConfigContent] = useState('');
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [lastCheckTime, setLastCheckTime] = useState<string>('');

  useEffect(() => {
    if (config?.ConfigFile) {
      setConfigContent(config.ConfigFile);
    }
    if (config?.ConfigSubscribtion) {
      setSubscriptionUrl(config.ConfigSubscribtion.URL);
      setAutoUpdate(config.ConfigSubscribtion.AutoUpdate);
      setLastCheckTime(config.ConfigSubscribtion.LastCheck || '');
    }
  }, [config]);

  // 拉取订阅配置
  const handleFetchConfig = async () => {
    if (!subscriptionUrl.trim()) {
      showError('请输入订阅URL', showAlert);
      return;
    }

    await withLoading('fetchConfig', async () => {
      try {
        const resp = await fetch('/api/admin/config_subscription/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: subscriptionUrl }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `拉取失败: ${resp.status}`);
        }

        const data = await resp.json();
        if (data.configContent) {
          setConfigContent(data.configContent);
          // 更新本地配置的最后检查时间
          const currentTime = new Date().toISOString();
          setLastCheckTime(currentTime);
          showSuccess('配置拉取成功', showAlert);
        } else {
          showError('拉取失败：未获取到配置内容', showAlert);
        }
      } catch (err) {
        showError(err instanceof Error ? err.message : '拉取失败', showAlert);
        throw err;
      }
    });
  };

  // 本地模式：解析配置文件并更新源配置
  const parseAndApplyConfigFile = (configFileContent: string) => {
    interface ConfigFileStruct {
      api_site?: {
        [key: string]: {
          key?: string;
          api: string;
          name: string;
          detail?: string;
          is_adult?: boolean;
        };
      };
      custom_category?: {
        name?: string;
        type: 'movie' | 'tv';
        query: string;
      }[];
      lives?: {
        [key: string]: { name: string; url: string; ua?: string; epg?: string };
      };
    }

    let parsed: ConfigFileStruct = {};
    try {
      if (configFileContent && configFileContent.trim()) {
        parsed = JSON.parse(configFileContent);
      }
    } catch {
      // 解析失败时使用空对象
    }

    updateConfig((prev) => {
      if (!prev) return prev;

      // 保留自定义源（from !== 'config'）
      const customSources = (prev.SourceConfig || []).filter(
        (s) => s.from !== 'config',
      );
      const customCategories = (prev.CustomCategories || []).filter(
        (c) => c.from !== 'config',
      );
      const customLives = (prev.LiveConfig || []).filter(
        (l) => l.from !== 'config',
      );

      // 从配置文件解析新的预设源
      const configSources = Object.entries(parsed.api_site || {}).map(
        ([key, site]) => ({
          key,
          name: site.name,
          api: site.api,
          detail: site.detail,
          is_adult: site.is_adult || false,
          from: 'config' as const,
          disabled: false,
        }),
      );

      const configCategories = (parsed.custom_category || []).map((cat) => ({
        name: cat.name || cat.query,
        type: cat.type,
        query: cat.query,
        from: 'config' as const,
        disabled: false,
      }));

      const configLives = Object.entries(parsed.lives || {}).map(
        ([key, live]) => ({
          key,
          name: live.name,
          url: live.url,
          ua: live.ua,
          epg: live.epg,
          channelNumber: 0,
          from: 'config' as const,
          disabled: false,
        }),
      );

      return {
        ...prev,
        ConfigFile: configFileContent,
        ConfigSubscribtion: {
          URL: subscriptionUrl,
          AutoUpdate: autoUpdate,
          LastCheck: lastCheckTime || new Date().toISOString(),
        },
        SourceConfig: [...configSources, ...customSources],
        CustomCategories: [...configCategories, ...customCategories],
        LiveConfig: [...configLives, ...customLives],
      };
    });
  };

  // 保存配置文件
  const handleSave = async () => {
    // 检查是否要清空配置
    const isEmpty = !configContent || !configContent.trim();

    if (isEmpty) {
      // 统计将被删除的系统预设源数量
      const configSources =
        config?.SourceConfig?.filter((s) => s.from === 'config') || [];

      if (configSources.length > 0) {
        // 需要用户确认清空操作
        const confirmed = confirm(
          `⚠️ 清空配置文件警告\n\n` +
            `你正在清空配置文件，这将会：\n` +
            `• 删除 ${configSources.length} 个系统预设视频源\n` +
            `• 保留所有自定义添加的视频源\n\n` +
            `确定要继续吗？`,
        );

        if (!confirmed) {
          return;
        }
      }
    }

    await withLoading('saveConfig', async () => {
      // 本地模式：直接解析并更新配置
      if (storageMode === 'local') {
        parseAndApplyConfigFile(configContent);
        if (
          isEmpty &&
          (config?.SourceConfig?.filter((s) => s.from === 'config').length ??
            0) > 0
        ) {
          showSuccess(
            '配置文件已清空，系统预设视频源已删除，自定义源已保留',
            showAlert,
          );
        } else {
          showSuccess('配置文件保存成功', showAlert);
        }
        return;
      }

      // 云端模式：调用 API
      try {
        const resp = await fetch('/api/admin/config_file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            configFile: configContent,
            subscriptionUrl,
            autoUpdate,
            lastCheckTime: lastCheckTime || new Date().toISOString(),
          }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `保存失败: ${resp.status}`);
        }

        if (
          isEmpty &&
          (config?.SourceConfig?.filter((s) => s.from === 'config').length ??
            0) > 0
        ) {
          showSuccess(
            '配置文件已清空，系统预设视频源已删除，自定义源已保留',
            showAlert,
          );
        } else {
          showSuccess('配置文件保存成功', showAlert);
        }

        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-4'>
      {/* 配置订阅区域 */}
      <div className='bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 shadow-sm'>
        <div className='flex items-center justify-between mb-6'>
          <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
            配置订阅
          </h3>
          <div className='text-sm text-gray-500 dark:text-gray-400 px-3 py-1.5 rounded-full'>
            最后更新:{' '}
            {lastCheckTime
              ? new Date(lastCheckTime).toLocaleString('zh-CN')
              : '从未更新'}
          </div>
        </div>

        <div className='space-y-6'>
          {/* 订阅URL输入 */}
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3'>
              订阅URL
            </label>
            <input
              type='url'
              value={subscriptionUrl}
              onChange={(e) => setSubscriptionUrl(e.target.value)}
              placeholder='https://example.com/config.json'
              disabled={false}
              className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all duration-200 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-2 text-xs text-gray-500 dark:text-gray-400'>
              输入配置文件的订阅地址，要求 JSON 格式，且使用 Base58 编码
            </p>
          </div>

          {/* 拉取配置按钮 */}
          <div className='pt-2'>
            <button
              onClick={handleFetchConfig}
              disabled={isLoading('fetchConfig') || !subscriptionUrl.trim()}
              className={`w-full px-6 py-3 rounded-lg font-medium transition-all duration-200 ${
                isLoading('fetchConfig') || !subscriptionUrl.trim()
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('fetchConfig') ? (
                <div className='flex items-center justify-center gap-2'>
                  <div className='w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin'></div>
                  拉取中…
                </div>
              ) : (
                '拉取配置'
              )}
            </button>
          </div>

          {/* 自动更新开关 */}
          <div className='flex items-center justify-between'>
            <div>
              <label className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                自动更新
              </label>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                启用后系统将定期自动拉取最新配置
              </p>
            </div>
            <button
              type='button'
              onClick={() => setAutoUpdate(!autoUpdate)}
              disabled={false}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                autoUpdate ? buttonStyles.toggleOn : buttonStyles.toggleOff
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full ${
                  buttonStyles.toggleThumb
                } transition-transform ${
                  autoUpdate
                    ? buttonStyles.toggleThumbOn
                    : buttonStyles.toggleThumbOff
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      {/* 配置文件编辑区域 */}
      <div className='space-y-4'>
        <div className='relative'>
          <textarea
            value={configContent}
            onChange={(e) => setConfigContent(e.target.value)}
            rows={20}
            placeholder='请输入配置文件内容（JSON 格式）...'
            disabled={false}
            className='w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed resize-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 hover:border-gray-400 dark:hover:border-gray-500'
            style={{
              fontFamily:
                'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
            }}
            spellCheck={false}
            data-gramm={false}
          />
        </div>

        <div className='flex items-center justify-between'>
          <div className='text-xs text-gray-500 dark:text-gray-400'>
            支持 JSON 格式，用于配置视频源和自定义分类
          </div>
          <button
            onClick={handleSave}
            disabled={isLoading('saveConfig')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isLoading('saveConfig')
                ? buttonStyles.disabled
                : buttonStyles.success
            }`}
          >
            {isLoading('saveConfig') ? '保存中…' : '保存'}
          </button>
        </div>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 新增站点配置组件
const SiteConfigComponent = ({
  config,
  refreshConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [siteSettings, setSiteSettings] = useState<SiteConfig>({
    SiteName: '',
    Announcement: '',
    SearchDownstreamMaxPage: 1,
    SiteInterfaceCacheTime: 7200,
    DoubanProxyType: 'cmliussss-cdn-tencent',
    DoubanProxy: '',
    DoubanImageProxyType: 'cmliussss-cdn-tencent',
    DoubanImageProxy: '',
    DisableYellowFilter: false,
    FluidSearch: true,
    LoginBackground: 'https://pan.yyds.nyc.mn/background.png',
  });

  // 豆瓣数据源相关状态
  const [isDoubanDropdownOpen, setIsDoubanDropdownOpen] = useState(false);
  const [isDoubanImageProxyDropdownOpen, setIsDoubanImageProxyDropdownOpen] =
    useState(false);

  // 豆瓣数据源选项
  const doubanDataSourceOptions = [
    { value: 'direct', label: '直连（服务器直接请求豆瓣）' },
    { value: 'cors-proxy-zwei', label: 'Cors Proxy By Zwei' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];

  // 豆瓣图片代理选项
  const doubanImageProxyTypeOptions = [
    { value: 'direct', label: '直连（浏览器直接请求豆瓣）' },
    { value: 'server', label: '服务器代理（由服务器代理请求豆瓣）' },
    { value: 'img3', label: '豆瓣官方精品 CDN（阿里云）' },
    {
      value: 'cmliussss-cdn-tencent',
      label: '豆瓣 CDN By CMLiussss（腾讯云）',
    },
    { value: 'cmliussss-cdn-ali', label: '豆瓣 CDN By CMLiussss（阿里云）' },
    { value: 'custom', label: '自定义代理' },
  ];

  // 获取感谢信息
  const getThanksInfo = (dataSource: string) => {
    switch (dataSource) {
      case 'cors-proxy-zwei':
        return {
          text: 'Thanks to @Zwei',
          url: 'https://github.com/bestzwei',
        };
      case 'cmliussss-cdn-tencent':
      case 'cmliussss-cdn-ali':
        return {
          text: 'Thanks to @CMLiussss',
          url: 'https://github.com/cmliu',
        };
      default:
        return null;
    }
  };

  useEffect(() => {
    if (config?.SiteConfig) {
      setSiteSettings({
        ...config.SiteConfig,
        DoubanProxyType:
          config.SiteConfig.DoubanProxyType || 'cmliussss-cdn-tencent',
        DoubanProxy: config.SiteConfig.DoubanProxy || '',
        DoubanImageProxyType:
          config.SiteConfig.DoubanImageProxyType || 'cmliussss-cdn-tencent',
        DoubanImageProxy: config.SiteConfig.DoubanImageProxy || '',
        DisableYellowFilter: config.SiteConfig.DisableYellowFilter || false,
        FluidSearch: config.SiteConfig.FluidSearch ?? true,
        LoginBackground:
          config.SiteConfig.LoginBackground ||
          'https://pan.yyds.nyc.mn/background.png',
      });
    }
  }, [config]);

  // 点击外部区域关闭下拉框
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-datasource"]')) {
          setIsDoubanDropdownOpen(false);
        }
      }
    };

    if (isDoubanDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanDropdownOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (isDoubanImageProxyDropdownOpen) {
        const target = event.target as Element;
        if (!target.closest('[data-dropdown="douban-image-proxy"]')) {
          setIsDoubanImageProxyDropdownOpen(false);
        }
      }
    };

    if (isDoubanImageProxyDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isDoubanImageProxyDropdownOpen]);

  // 处理豆瓣数据源变化
  const handleDoubanDataSourceChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanProxyType: value,
    }));
  };

  // 处理豆瓣图片代理变化
  const handleDoubanImageProxyChange = (value: string) => {
    setSiteSettings((prev) => ({
      ...prev,
      DoubanImageProxyType: value,
    }));
  };

  // 保存站点配置
  const handleSave = async () => {
    await withLoading('saveSiteConfig', async () => {
      try {
        const resp = await fetch('/api/admin/site', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...siteSettings }),
        });

        if (!resp.ok) {
          const data = await resp.json().catch(() => ({}));
          throw new Error(data.error || `保存失败: ${resp.status}`);
        }

        showSuccess('保存成功, 请刷新页面', showAlert);
        await refreshConfig();
      } catch (err) {
        showError(err instanceof Error ? err.message : '保存失败', showAlert);
        throw err;
      }
    });
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 站点名称 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点名称
        </label>
        <input
          type='text'
          value={siteSettings.SiteName}
          onChange={(e) =>
            setSiteSettings((prev) => ({ ...prev, SiteName: e.target.value }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站点公告 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点公告
        </label>
        <textarea
          value={siteSettings.Announcement}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              Announcement: e.target.value,
            }))
          }
          rows={3}
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 豆瓣数据源设置 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            豆瓣数据代理
          </label>
          <div className='relative' data-dropdown='douban-datasource'>
            {/* 自定义下拉选择框 */}
            <button
              type='button'
              onClick={() => setIsDoubanDropdownOpen(!isDoubanDropdownOpen)}
              className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
            >
              {
                doubanDataSourceOptions.find(
                  (option) => option.value === siteSettings.DoubanProxyType,
                )?.label
              }
            </button>

            {/* 下拉箭头 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                  isDoubanDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {/* 下拉选项列表 */}
            {isDoubanDropdownOpen && (
              <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                {doubanDataSourceOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      handleDoubanDataSourceChange(option.value);
                      setIsDoubanDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      siteSettings.DoubanProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            选择获取豆瓣数据的方式
          </p>

          {/* 感谢信息 */}
          {getThanksInfo(siteSettings.DoubanProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanProxyType)!.url,
                    '_blank',
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
        {siteSettings.DoubanProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              自定义代理服务器地址
            </p>
          </div>
        )}
      </div>

      {/* 豆瓣图片代理设置 */}
      <div className='space-y-3'>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            豆瓣图片代理
          </label>
          <div className='relative' data-dropdown='douban-image-proxy'>
            {/* 自定义下拉选择框 */}
            <button
              type='button'
              onClick={() =>
                setIsDoubanImageProxyDropdownOpen(
                  !isDoubanImageProxyDropdownOpen,
                )
              }
              className='w-full px-3 py-2.5 pr-10 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm hover:border-gray-400 dark:hover:border-gray-500 text-left'
            >
              {
                doubanImageProxyTypeOptions.find(
                  (option) =>
                    option.value === siteSettings.DoubanImageProxyType,
                )?.label
              }
            </button>

            {/* 下拉箭头 */}
            <div className='absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none'>
              <ChevronDown
                className={`w-4 h-4 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${
                  isDoubanImageProxyDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </div>

            {/* 下拉选项列表 */}
            {isDoubanImageProxyDropdownOpen && (
              <div className='absolute z-50 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto'>
                {doubanImageProxyTypeOptions.map((option) => (
                  <button
                    key={option.value}
                    type='button'
                    onClick={() => {
                      handleDoubanImageProxyChange(option.value);
                      setIsDoubanImageProxyDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2.5 text-left text-sm transition-colors duration-150 flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-700 ${
                      siteSettings.DoubanImageProxyType === option.value
                        ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                        : 'text-gray-900 dark:text-gray-100'
                    }`}
                  >
                    <span className='truncate'>{option.label}</span>
                    {siteSettings.DoubanImageProxyType === option.value && (
                      <Check className='w-4 h-4 text-green-600 dark:text-green-400 shrink-0 ml-2' />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            选择获取豆瓣图片的方式
          </p>

          {/* 感谢信息 */}
          {getThanksInfo(siteSettings.DoubanImageProxyType) && (
            <div className='mt-3'>
              <button
                type='button'
                onClick={() =>
                  window.open(
                    getThanksInfo(siteSettings.DoubanImageProxyType)!.url,
                    '_blank',
                  )
                }
                className='flex items-center justify-center gap-1.5 w-full px-3 text-xs text-gray-500 dark:text-gray-400 cursor-pointer'
              >
                <span className='font-medium'>
                  {getThanksInfo(siteSettings.DoubanImageProxyType)!.text}
                </span>
                <ExternalLink className='w-3.5 opacity-70' />
              </button>
            </div>
          )}
        </div>

        {/* 豆瓣代理地址设置 - 仅在选择自定义代理时显示 */}
        {siteSettings.DoubanImageProxyType === 'custom' && (
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              豆瓣图片代理地址
            </label>
            <input
              type='text'
              placeholder='例如: https://proxy.example.com/fetch?url='
              value={siteSettings.DoubanImageProxy}
              onChange={(e) =>
                setSiteSettings((prev) => ({
                  ...prev,
                  DoubanImageProxy: e.target.value,
                }))
              }
              className='w-full px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400 shadow-sm hover:border-gray-400 dark:hover:border-gray-500'
            />
            <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              自定义图片代理服务器地址
            </p>
          </div>
        )}
      </div>

      {/* 搜索接口可拉取最大页数 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          搜索接口可拉取最大页数
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SearchDownstreamMaxPage}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SearchDownstreamMaxPage: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 站点接口缓存时间 */}
      <div>
        <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
          站点接口缓存时间（秒）
        </label>
        <input
          type='number'
          min={1}
          value={siteSettings.SiteInterfaceCacheTime}
          onChange={(e) =>
            setSiteSettings((prev) => ({
              ...prev,
              SiteInterfaceCacheTime: Number(e.target.value),
            }))
          }
          className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-green-500 focus:border-transparent'
        />
      </div>

      {/* 成人内容过滤 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            启用成人内容过滤
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                DisableYellowFilter: !prev.DisableYellowFilter,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              !siteSettings.DisableYellowFilter
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                !siteSettings.DisableYellowFilter
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          开启后将过滤标记为成人资源的视频源和包含敏感关键词的内容。关闭后显示所有内容。
        </p>
      </div>

      {/* 流式搜索 */}
      <div>
        <div className='flex items-center justify-between'>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
            启用流式搜索
          </label>
          <button
            type='button'
            onClick={() =>
              setSiteSettings((prev) => ({
                ...prev,
                FluidSearch: !prev.FluidSearch,
              }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
              siteSettings.FluidSearch
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full ${
                buttonStyles.toggleThumb
              } transition-transform ${
                siteSettings.FluidSearch
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          启用后搜索结果将实时流式返回，提升用户体验。
        </p>
      </div>

      {/* 登录页面背景图设置 */}
      <div className='space-y-4 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700'>
        <div className='flex items-center gap-2'>
          <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
            🖼️ 登录页面背景设置
          </h4>
        </div>
        <p className='text-xs text-gray-500 dark:text-gray-400 -mt-2'>
          设置登录页面的背景图片。支持本地图片路径（如
          /background.png）或外部图片直链。留空则使用默认动态背景。
        </p>
        <div>
          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
            背景图片地址
          </label>
          <input
            type='text'
            placeholder='例如: /background.png 或 https://example.com/bg.jpg'
            value={siteSettings.LoginBackground}
            onChange={(e) =>
              setSiteSettings((prev) => ({
                ...prev,
                LoginBackground: e.target.value,
              }))
            }
            className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all duration-200 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400'
          />
        </div>
        {/* 背景图预览 */}
        {siteSettings.LoginBackground && (
          <div className='mt-3'>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
              背景预览
            </label>
            <div className='relative w-full h-32 rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600'>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={siteSettings.LoginBackground}
                alt='背景预览'
                className='w-full h-full object-cover'
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className='absolute inset-0 bg-black/30 flex items-center justify-center'>
                <span className='text-white text-sm font-medium px-3 py-1 bg-black/50 rounded-lg'>
                  登录背景预览
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className='flex justify-end'>
        <button
          onClick={handleSave}
          disabled={isLoading('saveSiteConfig')}
          className={`px-4 py-2 ${
            isLoading('saveSiteConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          } rounded-lg transition-colors`}
        >
          {isLoading('saveSiteConfig') ? '保存中…' : '保存'}
        </button>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 直播源配置组件
const LiveSourceConfig = ({
  config,
  refreshConfig,
  storageMode,
  updateConfig,
}: {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
  storageMode: 'cloud' | 'local';
  updateConfig: (
    updater: (prev: AdminConfig | null) => AdminConfig | null,
  ) => void;
}) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [liveSources, setLiveSources] = useState<LiveDataSource[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingLiveSource, setEditingLiveSource] =
    useState<LiveDataSource | null>(null);
  const [orderChanged, setOrderChanged] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newLiveSource, setNewLiveSource] = useState<LiveDataSource>({
    name: '',
    key: '',
    url: '',
    ua: '',
    epg: '',
    disabled: false,
    from: 'custom',
  });

  // dnd-kit 传感器
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 轻微位移即可触发
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 150, // 长按 150ms 后触发，避免与滚动冲突
        tolerance: 5,
      },
    }),
  );

  // 初始化
  useEffect(() => {
    if (config?.LiveConfig) {
      setLiveSources(config.LiveConfig);
      // 进入时重置 orderChanged
      setOrderChanged(false);
    }
  }, [config]);

  // 本地模式下直接更新配置
  const updateLiveConfigLocally = (
    action: string,
    payload: Record<string, any>,
  ) => {
    updateConfig((prev) => {
      if (!prev) return prev;
      const sources = [...(prev.LiveConfig || [])];

      switch (action) {
        case 'add': {
          const newSource: LiveDataSource = {
            key: payload.key,
            name: payload.name,
            url: payload.url,
            ua: payload.ua || '',
            epg: payload.epg || '',
            disabled: false,
            from: 'custom',
            channelNumber: 0,
          };
          sources.push(newSource);
          break;
        }
        case 'delete': {
          const idx = sources.findIndex((s) => s.key === payload.key);
          if (idx !== -1) sources.splice(idx, 1);
          break;
        }
        case 'enable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = false;
          break;
        }
        case 'disable': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) source.disabled = true;
          break;
        }
        case 'update': {
          const source = sources.find((s) => s.key === payload.key);
          if (source) {
            source.name = payload.name ?? source.name;
            source.url = payload.url ?? source.url;
            source.ua = payload.ua ?? source.ua;
            source.epg = payload.epg ?? source.epg;
          }
          break;
        }
        case 'sort': {
          if (payload.order && Array.isArray(payload.order)) {
            const orderMap = new Map(
              payload.order.map((key: string, idx: number) => [key, idx]),
            );
            sources.sort((a, b) => {
              const aIdx = orderMap.get(a.key) ?? 999;
              const bIdx = orderMap.get(b.key) ?? 999;
              return aIdx - bIdx;
            });
          }
          break;
        }
      }

      return { ...prev, LiveConfig: sources };
    });
  };

  // 通用 API 请求
  const callLiveSourceApi = async (body: Record<string, any>) => {
    // 本地模式：直接更新配置，不调用 API
    if (storageMode === 'local') {
      updateLiveConfigLocally(body.action, body);
      showAlert({
        type: 'success',
        title: '操作成功',
        message: '配置已保存到本地',
        timer: 2000,
      });
      return;
    }

    try {
      const resp = await fetch('/api/admin/live', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body }),
      });

      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `操作失败: ${resp.status}`);
      }

      // 成功后刷新配置
      await refreshConfig();
    } catch (err) {
      showError(err instanceof Error ? err.message : '操作失败', showAlert);
      throw err; // 向上抛出方便调用处判断
    }
  };

  const handleToggleEnable = (key: string) => {
    const target = liveSources.find((s) => s.key === key);
    if (!target) return;
    const action = target.disabled ? 'enable' : 'disable';
    withLoading(`toggleLiveSource_${key}`, () =>
      callLiveSourceApi({ action, key }),
    ).catch(() => {
      console.error('操作失败', action, key);
    });
  };

  const handleDelete = (key: string) => {
    withLoading(`deleteLiveSource_${key}`, () =>
      callLiveSourceApi({ action: 'delete', key }),
    ).catch(() => {
      console.error('操作失败', 'delete', key);
    });
  };

  // 刷新直播源
  const handleRefreshLiveSources = async () => {
    if (isRefreshing) return;

    await withLoading('refreshLiveSources', async () => {
      setIsRefreshing(true);
      try {
        const response = await fetch('/api/admin/live/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `刷新失败: ${response.status}`);
        }

        // 刷新成功后重新获取配置
        await refreshConfig();
        showAlert({
          type: 'success',
          title: '刷新成功',
          message: '直播源已刷新',
          timer: 2000,
        });
      } catch (err) {
        showError(err instanceof Error ? err.message : '刷新失败', showAlert);
        throw err;
      } finally {
        setIsRefreshing(false);
      }
    });
  };

  const handleAddLiveSource = () => {
    if (!newLiveSource.name || !newLiveSource.key || !newLiveSource.url) return;
    withLoading('addLiveSource', async () => {
      await callLiveSourceApi({
        action: 'add',
        key: newLiveSource.key,
        name: newLiveSource.name,
        url: newLiveSource.url,
        ua: newLiveSource.ua,
        epg: newLiveSource.epg,
      });
      setNewLiveSource({
        name: '',
        key: '',
        url: '',
        epg: '',
        ua: '',
        disabled: false,
        from: 'custom',
      });
      setShowAddForm(false);
    }).catch(() => {
      console.error('操作失败', 'add', newLiveSource);
    });
  };

  const handleEditLiveSource = () => {
    if (!editingLiveSource || !editingLiveSource.name || !editingLiveSource.url)
      return;
    withLoading('editLiveSource', async () => {
      await callLiveSourceApi({
        action: 'edit',
        key: editingLiveSource.key,
        name: editingLiveSource.name,
        url: editingLiveSource.url,
        ua: editingLiveSource.ua,
        epg: editingLiveSource.epg,
      });
      setEditingLiveSource(null);
    }).catch(() => {
      console.error('操作失败', 'edit', editingLiveSource);
    });
  };

  const handleCancelEdit = () => {
    setEditingLiveSource(null);
  };

  const handleDragEnd = (event: any) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = liveSources.findIndex((s) => s.key === active.id);
    const newIndex = liveSources.findIndex((s) => s.key === over.id);
    setLiveSources((prev) => arrayMove(prev, oldIndex, newIndex));
    setOrderChanged(true);
  };

  const handleSaveOrder = () => {
    const order = liveSources.map((s) => s.key);
    withLoading('saveLiveSourceOrder', () =>
      callLiveSourceApi({ action: 'sort', order }),
    )
      .then(() => {
        setOrderChanged(false);
      })
      .catch(() => {
        console.error('操作失败', 'sort', order);
      });
  };

  // 可拖拽行封装 (dnd-kit)
  const DraggableRow = ({ liveSource }: { liveSource: LiveDataSource }) => {
    const { attributes, listeners, setNodeRef, transform, transition } =
      useSortable({ id: liveSource.key });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    } as React.CSSProperties;

    return (
      <tr
        ref={setNodeRef}
        style={style}
        className='hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors select-none'
      >
        <td
          className='px-2 py-4 cursor-grab text-gray-400'
          style={{ touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={16} />
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {liveSource.name}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100'>
          {liveSource.key}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-48 truncate'
          title={liveSource.url}
        >
          {liveSource.url}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
          title={liveSource.epg || '-'}
        >
          {liveSource.epg || '-'}
        </td>
        <td
          className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 max-w-32 truncate'
          title={liveSource.ua || '-'}
        >
          {liveSource.ua || '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-center'>
          {liveSource.channelNumber && liveSource.channelNumber > 0
            ? liveSource.channelNumber
            : '-'}
        </td>
        <td className='px-6 py-4 whitespace-nowrap max-w-4'>
          <span
            className={`px-2 py-1 text-xs rounded-full ${
              !liveSource.disabled
                ? 'bg-green-100 dark:bg-green-900/20 text-green-800 dark:text-green-300'
                : 'bg-red-100 dark:bg-red-900/20 text-red-800 dark:text-red-300'
            }`}
          >
            {!liveSource.disabled ? '启用中' : '已禁用'}
          </span>
        </td>
        <td className='px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-2'>
          <button
            onClick={() => handleToggleEnable(liveSource.key)}
            disabled={isLoading(`toggleLiveSource_${liveSource.key}`)}
            className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium ${
              !liveSource.disabled
                ? buttonStyles.roundedDanger
                : buttonStyles.roundedSuccess
            } transition-colors ${
              isLoading(`toggleLiveSource_${liveSource.key}`)
                ? 'opacity-50 cursor-not-allowed'
                : ''
            }`}
          >
            {!liveSource.disabled ? '禁用' : '启用'}
          </button>
          {liveSource.from !== 'config' && (
            <>
              <button
                onClick={() => setEditingLiveSource(liveSource)}
                disabled={isLoading(`editLiveSource_${liveSource.key}`)}
                className={`${buttonStyles.roundedPrimary} ${
                  isLoading(`editLiveSource_${liveSource.key}`)
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                编辑
              </button>
              <button
                onClick={() => handleDelete(liveSource.key)}
                disabled={isLoading(`deleteLiveSource_${liveSource.key}`)}
                className={`${buttonStyles.roundedSecondary} ${
                  isLoading(`deleteLiveSource_${liveSource.key}`)
                    ? 'opacity-50 cursor-not-allowed'
                    : ''
                }`}
              >
                删除
              </button>
            </>
          )}
        </td>
      </tr>
    );
  };

  if (!config) {
    return (
      <div className='text-center text-gray-500 dark:text-gray-400'>
        加载中...
      </div>
    );
  }

  return (
    <div className='space-y-6'>
      {/* 添加直播源表单 */}
      <div className='flex items-center justify-between'>
        <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
          直播源列表
        </h4>
        <div className='flex items-center space-x-2'>
          <button
            onClick={handleRefreshLiveSources}
            disabled={isRefreshing || isLoading('refreshLiveSources')}
            className={`px-3 py-1.5 text-sm font-medium flex items-center space-x-2 ${
              isRefreshing || isLoading('refreshLiveSources')
                ? 'bg-gray-400 dark:bg-gray-600 cursor-not-allowed text-white rounded-lg'
                : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-700 text-white rounded-lg transition-colors'
            }`}
          >
            <span>
              {isRefreshing || isLoading('refreshLiveSources')
                ? '刷新中...'
                : '刷新直播源'}
            </span>
          </button>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className={
              showAddForm ? buttonStyles.secondary : buttonStyles.success
            }
          >
            {showAddForm ? '取消' : '添加直播源'}
          </button>
        </div>
      </div>

      {showAddForm && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <input
              type='text'
              placeholder='名称'
              value={newLiveSource.name}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, name: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='Key'
              value={newLiveSource.key}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, key: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='M3U 地址'
              value={newLiveSource.url}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, url: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='节目单地址（选填）'
              value={newLiveSource.epg}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, epg: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
            <input
              type='text'
              placeholder='自定义 UA（选填）'
              value={newLiveSource.ua}
              onChange={(e) =>
                setNewLiveSource((prev) => ({ ...prev, ua: e.target.value }))
              }
              className='px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
            />
          </div>
          <div className='flex justify-end'>
            <button
              onClick={handleAddLiveSource}
              disabled={
                !newLiveSource.name ||
                !newLiveSource.key ||
                !newLiveSource.url ||
                isLoading('addLiveSource')
              }
              className={`w-full sm:w-auto px-4 py-2 ${
                !newLiveSource.name ||
                !newLiveSource.key ||
                !newLiveSource.url ||
                isLoading('addLiveSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('addLiveSource') ? '添加中...' : '添加'}
            </button>
          </div>
        </div>
      )}

      {/* 编辑直播源表单 */}
      {editingLiveSource && (
        <div className='p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-4'>
          <div className='flex items-center justify-between'>
            <h5 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              编辑直播源: {editingLiveSource.name}
            </h5>
            <button
              onClick={handleCancelEdit}
              className='text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
            >
              ✕
            </button>
          </div>
          <div className='grid grid-cols-1 sm:grid-cols-2 gap-4'>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                名称
              </label>
              <input
                type='text'
                value={editingLiveSource.name}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, name: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                Key (不可编辑)
              </label>
              <input
                type='text'
                value={editingLiveSource.key}
                disabled
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                M3U 地址
              </label>
              <input
                type='text'
                value={editingLiveSource.url}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, url: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                节目单地址（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.epg}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, epg: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
            <div>
              <label className='block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1'>
                自定义 UA（选填）
              </label>
              <input
                type='text'
                value={editingLiveSource.ua}
                onChange={(e) =>
                  setEditingLiveSource((prev) =>
                    prev ? { ...prev, ua: e.target.value } : null,
                  )
                }
                className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100'
              />
            </div>
          </div>
          <div className='flex justify-end space-x-2'>
            <button
              onClick={handleCancelEdit}
              className={buttonStyles.secondary}
            >
              取消
            </button>
            <button
              onClick={handleEditLiveSource}
              disabled={
                !editingLiveSource.name ||
                !editingLiveSource.url ||
                isLoading('editLiveSource')
              }
              className={`${
                !editingLiveSource.name ||
                !editingLiveSource.url ||
                isLoading('editLiveSource')
                  ? buttonStyles.disabled
                  : buttonStyles.success
              }`}
            >
              {isLoading('editLiveSource') ? '保存中...' : '保存'}
            </button>
          </div>
        </div>
      )}

      {/* 直播源表格 */}
      <div
        className='border border-gray-200 dark:border-gray-700 rounded-lg max-h-112 overflow-y-auto overflow-x-auto relative'
        data-table='live-source-list'
      >
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          autoScroll={false}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <table className='min-w-full divide-y divide-gray-200 dark:divide-gray-700'>
            <thead className='bg-gray-50 dark:bg-gray-900 sticky top-0 z-10'>
              <tr>
                <th className='w-8' />
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  名称
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  Key
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  M3U 地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  节目单地址
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  自定义 UA
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  频道数
                </th>
                <th className='px-6 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  状态
                </th>
                <th className='px-6 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider'>
                  操作
                </th>
              </tr>
            </thead>
            <SortableContext
              items={liveSources.map((s) => s.key)}
              strategy={verticalListSortingStrategy}
            >
              <tbody className='divide-y divide-gray-200 dark:divide-gray-700'>
                {liveSources.map((liveSource) => (
                  <DraggableRow key={liveSource.key} liveSource={liveSource} />
                ))}
              </tbody>
            </SortableContext>
          </table>
        </DndContext>
      </div>

      {/* 保存排序按钮 */}
      {orderChanged && (
        <div className='flex justify-end'>
          <button
            onClick={handleSaveOrder}
            disabled={isLoading('saveLiveSourceOrder')}
            className={`px-3 py-1.5 text-sm ${
              isLoading('saveLiveSourceOrder')
                ? buttonStyles.disabled
                : buttonStyles.primary
            }`}
          >
            {isLoading('saveLiveSourceOrder') ? '保存中...' : '保存排序'}
          </button>
        </div>
      )}

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

// 弹幕配置组件
interface DanmuConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

interface DanmuNodeFormState {
  name: string;
  url: string;
  token: string;
}

interface DanmuNodeHealthState {
  status: 'idle' | 'testing' | 'ok' | 'error';
  latency?: number;
  error?: string;
}

interface DanmuSettingsState {
  enabled: boolean;
  serverUrl: string;
  token: string;
  platform: string;
  sourceOrder: string;
  mergeSourcePairs: string;
  bilibiliCookie: string;
  convertTopBottomToScroll: boolean;
  convertColor: 'default' | 'white' | 'color';
  danmuLimit: number;
  blockedWords: string;
  danmuOutputFormat: 'json' | 'xml';
  simplifiedTraditional: 'default' | 'simplified' | 'traditional';
  customNodes: DanmuCustomNode[];
}

const DANMU_CUSTOM_NODE_STORAGE_KEY = 'decotv:danmu:custom-nodes';
const MAX_CUSTOM_DANMU_NODE_COUNT = 64;

const RECOMMENDED_DANMU_SERVER = {
  name: '官方推荐/稳定节点',
  url: 'https://danmu.katelya.eu.org',
  token: 'decotv',
  badge: '官方推荐',
};

const DEPLOYMENT_GUIDE_URL = 'https://github.com/huangxd-/danmu_api';

const DEMO_DANMU_SERVERS = [RECOMMENDED_DANMU_SERVER];

const SOURCE_OPTIONS = [
  { value: '360', label: '360搜索' },
  { value: 'vod', label: 'VOD采集' },
  { value: 'tmdb', label: 'TMDB' },
  { value: 'douban', label: '豆瓣' },
  { value: 'tencent', label: '腾讯视频' },
  { value: 'youku', label: '优酷' },
  { value: 'iqiyi', label: '爱奇艺' },
  { value: 'imgo', label: '芒果TV' },
  { value: 'bilibili', label: '哔哩哔哩' },
  { value: 'migu', label: '咪咕视频' },
  { value: 'sohu', label: '搜狐视频' },
  { value: 'leshi', label: '乐视' },
  { value: 'xigua', label: '西瓜视频' },
  { value: 'renren', label: '人人视频' },
  { value: 'hanjutv', label: '韩剧TV' },
  { value: 'bahamut', label: '巴哈姆特' },
  { value: 'dandan', label: '弹弹play' },
  { value: 'animeko', label: 'Animeko' },
  { value: 'custom', label: '自定义源' },
];

const PLATFORM_OPTIONS = [
  { value: 'qiyi', label: '爱奇艺' },
  { value: 'bilibili1', label: '哔哩哔哩' },
  { value: 'imgo', label: '芒果TV' },
  { value: 'youku', label: '优酷' },
  { value: 'qq', label: '腾讯视频' },
  { value: 'migu', label: '咪咕' },
  { value: 'sohu', label: '搜狐' },
  { value: 'leshi', label: '乐视' },
  { value: 'xigua', label: '西瓜' },
  { value: 'renren', label: '人人' },
  { value: 'hanjutv', label: '韩剧TV' },
  { value: 'bahamut', label: '巴哈姆特' },
  { value: 'dandan', label: '弹弹play' },
  { value: 'animeko', label: 'Animeko' },
  { value: 'custom', label: '自定义' },
];

const DanmuConfigComponent = ({ config, refreshConfig }: DanmuConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();

  const [danmuSettings, setDanmuSettings] = useState<DanmuSettingsState>({
    enabled: false,
    serverUrl: RECOMMENDED_DANMU_SERVER.url,
    token: RECOMMENDED_DANMU_SERVER.token,
    platform: '',
    sourceOrder: '',
    mergeSourcePairs: '',
    bilibiliCookie: '',
    convertTopBottomToScroll: false,
    convertColor: 'default' as 'default' | 'white' | 'color',
    danmuLimit: 0,
    blockedWords: '',
    danmuOutputFormat: 'json' as 'json' | 'xml',
    simplifiedTraditional: 'default' as
      | 'default'
      | 'simplified'
      | 'traditional',
    customNodes: [],
  });

  const [testResult, setTestResult] = useState<{
    success?: boolean;
    latency?: number;
    searchAvailable?: boolean;
    searchResultCount?: number;
    error?: string;
  } | null>(null);

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isNodeModalOpen, setIsNodeModalOpen] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [nodeForm, setNodeForm] = useState<DanmuNodeFormState>({
    name: '',
    url: '',
    token: '',
  });
  const [nodeHealthMap, setNodeHealthMap] = useState<
    Record<string, DanmuNodeHealthState>
  >({});

  const normalizeServerUrl = useCallback((value: string) => {
    return value.trim().replace(/\/+$/, '');
  }, []);

  const createNodeId = useCallback(() => {
    if (
      typeof crypto !== 'undefined' &&
      typeof crypto.randomUUID === 'function'
    ) {
      return crypto.randomUUID();
    }
    return `node_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  }, []);

  // 统一过滤与规范化节点数据，避免脏数据写入配置。
  const sanitizeCustomNodes = useCallback(
    (value: unknown): DanmuCustomNode[] => {
      if (!Array.isArray(value)) {
        return [];
      }

      const now = Date.now();
      const nodes: DanmuCustomNode[] = [];
      for (const item of value) {
        if (!item || typeof item !== 'object') {
          continue;
        }

        const raw = item as Partial<DanmuCustomNode>;
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        const url =
          typeof raw.url === 'string' ? normalizeServerUrl(raw.url) : '';
        if (!name || !url) {
          continue;
        }

        const token = typeof raw.token === 'string' ? raw.token.trim() : '';
        const createdAt =
          typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
            ? raw.createdAt
            : now;
        const updatedAt =
          typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
            ? raw.updatedAt
            : now;
        const id =
          typeof raw.id === 'string' && raw.id.trim()
            ? raw.id.trim()
            : `node_${createdAt}_${nodes.length}`;

        nodes.push({ id, name, url, token, createdAt, updatedAt });
        if (nodes.length >= MAX_CUSTOM_DANMU_NODE_COUNT) {
          break;
        }
      }

      return nodes;
    },
    [normalizeServerUrl],
  );

  const loadCustomNodesFromStorage = useCallback((): DanmuCustomNode[] => {
    if (typeof window === 'undefined') {
      return [];
    }
    try {
      const raw = window.localStorage.getItem(DANMU_CUSTOM_NODE_STORAGE_KEY);
      if (!raw) {
        return [];
      }
      return sanitizeCustomNodes(JSON.parse(raw));
    } catch {
      return [];
    }
  }, [sanitizeCustomNodes]);

  const persistCustomNodesToStorage = useCallback(
    (nodes: DanmuCustomNode[]) => {
      if (typeof window === 'undefined') {
        return;
      }
      try {
        window.localStorage.setItem(
          DANMU_CUSTOM_NODE_STORAGE_KEY,
          JSON.stringify(nodes),
        );
      } catch {
        // localStorage 异常不影响主流程。
      }
    },
    [],
  );

  useEffect(() => {
    if (config?.DanmuConfig) {
      const configCustomNodes = sanitizeCustomNodes(
        config.DanmuConfig.customNodes,
      );
      const customNodes =
        configCustomNodes.length > 0
          ? configCustomNodes
          : loadCustomNodesFromStorage();
      setDanmuSettings({
        enabled: config.DanmuConfig.enabled ?? false,
        serverUrl: normalizeServerUrl(config.DanmuConfig.serverUrl ?? ''),
        token: config.DanmuConfig.token ?? '',
        platform: config.DanmuConfig.platform ?? '',
        sourceOrder: config.DanmuConfig.sourceOrder ?? '',
        mergeSourcePairs: config.DanmuConfig.mergeSourcePairs ?? '',
        bilibiliCookie: config.DanmuConfig.bilibiliCookie ?? '',
        convertTopBottomToScroll:
          config.DanmuConfig.convertTopBottomToScroll ?? false,
        convertColor: config.DanmuConfig.convertColor ?? 'default',
        danmuLimit: config.DanmuConfig.danmuLimit ?? 0,
        blockedWords: config.DanmuConfig.blockedWords ?? '',
        danmuOutputFormat: config.DanmuConfig.danmuOutputFormat ?? 'json',
        simplifiedTraditional:
          config.DanmuConfig.simplifiedTraditional ?? 'default',
        customNodes,
      });
      return;
    }
    const fallbackNodes = loadCustomNodesFromStorage();
    if (fallbackNodes.length > 0) {
      setDanmuSettings((prev) => ({
        ...prev,
        customNodes: fallbackNodes,
      }));
    }
  }, [
    config,
    loadCustomNodesFromStorage,
    normalizeServerUrl,
    sanitizeCustomNodes,
  ]);

  useEffect(() => {
    persistCustomNodesToStorage(danmuSettings.customNodes);
  }, [danmuSettings.customNodes, persistCustomNodesToStorage]);

  // 构建实际 API 地址（baseUrl + token 拼接）
  const getFullServerUrl = (
    serverUrl = danmuSettings.serverUrl,
    token = danmuSettings.token,
  ) => {
    const base = normalizeServerUrl(serverUrl);
    if (!base) return '';
    const safeToken = token.trim();
    if (safeToken) {
      return `${base}/${safeToken}`;
    }
    return base;
  };

  const persistDanmuSettings = useCallback(
    async (nextSettings: DanmuSettingsState, successMessage: string) => {
      const resp = await fetch('/api/admin/danmu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(nextSettings),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error || '保存失败');
      }
      persistCustomNodesToStorage(nextSettings.customNodes);
      await refreshConfig();
      setDanmuSettings(nextSettings);
      showSuccess(successMessage, showAlert);
    },
    [persistCustomNodesToStorage, refreshConfig, showAlert],
  );

  const handleSave = async () => {
    await withLoading('saveDanmuConfig', async () => {
      try {
        await persistDanmuSettings(danmuSettings, '弹幕配置保存成功');
      } catch (err) {
        showError(`保存弹幕配置失败: ${(err as Error).message}`, showAlert);
      }
    });
  };

  const handleTest = async () => {
    const url = getFullServerUrl();
    if (!url) {
      showError('请先填写弹幕服务器地址', showAlert);
      return;
    }
    setTestResult(null);
    await withLoading('testDanmuServer', async () => {
      try {
        const resp = await fetch('/api/admin/danmu/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: url }),
        });
        const data = await resp.json();
        setTestResult(data);
      } catch (err) {
        setTestResult({
          success: false,
          error: (err as Error).message,
        });
      }
    });
  };

  const handleSelectDemoServer = (server: { url: string; token?: string }) => {
    setDanmuSettings((prev) => ({
      ...prev,
      serverUrl: normalizeServerUrl(server.url),
      token: server.token ?? prev.token,
    }));
    setTestResult(null);
  };

  const isNodeSelected = (node: DanmuCustomNode) => {
    return (
      normalizeServerUrl(danmuSettings.serverUrl) ===
        normalizeServerUrl(node.url) &&
      danmuSettings.token.trim() === node.token.trim()
    );
  };

  const openAddNodeModal = () => {
    setEditingNodeId(null);
    setNodeForm({ name: '', url: '', token: '' });
    setIsNodeModalOpen(true);
  };

  const openEditNodeModal = (node: DanmuCustomNode) => {
    setEditingNodeId(node.id);
    setNodeForm({
      name: node.name,
      url: node.url,
      token: node.token,
    });
    setIsNodeModalOpen(true);
  };

  const closeNodeModal = () => {
    setIsNodeModalOpen(false);
    setEditingNodeId(null);
    setNodeForm({ name: '', url: '', token: '' });
  };

  const handleSubmitNode = () => {
    const name = nodeForm.name.trim();
    const url = normalizeServerUrl(nodeForm.url);
    const token = nodeForm.token.trim();

    if (!name || !url) {
      showError('节点名称和服务地址不能为空', showAlert);
      return;
    }

    if (
      !editingNodeId &&
      danmuSettings.customNodes.length >= MAX_CUSTOM_DANMU_NODE_COUNT
    ) {
      showError(
        `最多仅支持 ${MAX_CUSTOM_DANMU_NODE_COUNT} 个自定义节点`,
        showAlert,
      );
      return;
    }

    const now = Date.now();
    setDanmuSettings((prev) => {
      if (editingNodeId) {
        return {
          ...prev,
          customNodes: prev.customNodes.map((item) =>
            item.id === editingNodeId
              ? { ...item, name, url, token, updatedAt: now }
              : item,
          ),
        };
      }

      const nextNode: DanmuCustomNode = {
        id: createNodeId(),
        name,
        url,
        token,
        createdAt: now,
        updatedAt: now,
      };
      return {
        ...prev,
        customNodes: [nextNode, ...prev.customNodes],
      };
    });

    if (editingNodeId) {
      setNodeHealthMap((prev) => {
        const next = { ...prev };
        delete next[editingNodeId];
        return next;
      });
    }

    setTestResult(null);
    closeNodeModal();
    showSuccess(editingNodeId ? '节点更新成功' : '节点添加成功', showAlert);
  };

  const handleDeleteNode = (node: DanmuCustomNode) => {
    if (!window.confirm(`确认删除节点「${node.name}」吗？`)) {
      return;
    }

    setDanmuSettings((prev) => ({
      ...prev,
      customNodes: prev.customNodes.filter((item) => item.id !== node.id),
    }));
    setNodeHealthMap((prev) => {
      const next = { ...prev };
      delete next[node.id];
      return next;
    });
    showSuccess('节点已删除', showAlert);
  };

  const handleApplyNode = async (node: DanmuCustomNode) => {
    const nextSettings: DanmuSettingsState = {
      ...danmuSettings,
      enabled: true,
      serverUrl: node.url,
      token: node.token,
    };

    await withLoading(`applyDanmuNode_${node.id}`, async () => {
      try {
        await persistDanmuSettings(nextSettings, `已应用节点：${node.name}`);
        setTestResult(null);
      } catch (err) {
        showError(`应用节点失败: ${(err as Error).message}`, showAlert);
      }
    });
  };

  const handleTestNode = async (node: DanmuCustomNode) => {
    const fullUrl = getFullServerUrl(node.url, node.token);
    if (!fullUrl) {
      showError('节点地址不合法', showAlert);
      return;
    }

    setNodeHealthMap((prev) => ({
      ...prev,
      [node.id]: { status: 'testing' },
    }));

    await withLoading(`testDanmuNode_${node.id}`, async () => {
      try {
        const resp = await fetch('/api/admin/danmu/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverUrl: fullUrl }),
        });
        const data = (await resp.json()) as {
          success?: boolean;
          latency?: number;
          error?: string;
        };

        if (data.success) {
          setNodeHealthMap((prev) => ({
            ...prev,
            [node.id]: {
              status: 'ok',
              latency:
                typeof data.latency === 'number' &&
                Number.isFinite(data.latency)
                  ? data.latency
                  : undefined,
            },
          }));
          return;
        }

        setNodeHealthMap((prev) => ({
          ...prev,
          [node.id]: {
            status: 'error',
            error: data.error || '连接失败',
          },
        }));
      } catch (err) {
        setNodeHealthMap((prev) => ({
          ...prev,
          [node.id]: {
            status: 'error',
            error: (err as Error).message || '连接失败',
          },
        }));
      }
    });
  };

  const toggleSourceOrder = (source: string) => {
    setDanmuSettings((prev) => {
      const current = prev.sourceOrder
        ? prev.sourceOrder
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const idx = current.indexOf(source);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(source);
      }
      return { ...prev, sourceOrder: current.join(',') };
    });
  };

  const togglePlatform = (platform: string) => {
    setDanmuSettings((prev) => {
      const current = prev.platform
        ? prev.platform
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
      const idx = current.indexOf(platform);
      if (idx >= 0) {
        current.splice(idx, 1);
      } else {
        current.push(platform);
      }
      return { ...prev, platform: current.join(',') };
    });
  };

  const selectedSources = danmuSettings.sourceOrder
    ? danmuSettings.sourceOrder
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const selectedPlatforms = danmuSettings.platform
    ? danmuSettings.platform
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const customNodes = danmuSettings.customNodes;

  const getNodeHealthView = (nodeId: string) => {
    const health = nodeHealthMap[nodeId];
    if (!health || health.status === 'idle') {
      return (
        <span className='inline-flex rounded-full bg-gray-100 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300 px-2 py-0.5 text-[11px]'>
          未测试
        </span>
      );
    }
    if (health.status === 'testing') {
      return (
        <span className='inline-flex rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 text-[11px]'>
          测试中...
        </span>
      );
    }
    if (health.status === 'ok') {
      return (
        <span className='inline-flex rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px]'>
          {typeof health.latency === 'number' ? `${health.latency}ms` : '可用'}
        </span>
      );
    }
    return (
      <span
        className='inline-flex rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 px-2 py-0.5 text-[11px]'
        title={health.error || '连接失败'}
      >
        不可用
      </span>
    );
  };

  return (
    <div className='space-y-6'>
      {/* 顶部状态提示 */}
      <div
        className={`rounded-lg border p-4 ${
          danmuSettings.enabled
            ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
        }`}
      >
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-3'>
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                danmuSettings.enabled
                  ? 'bg-emerald-500 animate-pulse'
                  : 'bg-gray-400'
              }`}
            />
            <div>
              <p className='text-sm font-medium text-gray-900 dark:text-gray-100'>
                {danmuSettings.enabled
                  ? '自定义弹幕服务已启用'
                  : '使用内置弹弹play弹幕服务'}
              </p>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-0.5'>
                {danmuSettings.enabled
                  ? danmuSettings.serverUrl
                    ? `服务器: ${getFullServerUrl()}`
                    : '请配置弹幕服务器地址'
                  : '当前使用 Docker 镜像内置的弹弹play API 提供弹幕'}
              </p>
            </div>
          </div>
          <button
            onClick={() =>
              setDanmuSettings((prev) => ({ ...prev, enabled: !prev.enabled }))
            }
            className={`relative inline-flex h-7 w-13 items-center rounded-full transition-colors ${
              danmuSettings.enabled
                ? buttonStyles.toggleOn
                : buttonStyles.toggleOff
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full transition-transform ${
                buttonStyles.toggleThumb
              } ${
                danmuSettings.enabled
                  ? buttonStyles.toggleThumbOn
                  : buttonStyles.toggleThumbOff
              }`}
            />
          </button>
        </div>
      </div>

      {/* 服务器配置区域 */}
      {danmuSettings.enabled && (
        <div className='space-y-6'>
          {/* 仅当使用内置演示站（或未配置自定义地址）时显示警告 */}
          {(!danmuSettings.serverUrl ||
            DEMO_DANMU_SERVERS.some(
              (s) =>
                normalizeServerUrl(s.url) ===
                normalizeServerUrl(danmuSettings.serverUrl),
            )) && (
            <div className='rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/15 p-4'>
              <div className='flex items-start gap-2'>
                <AlertTriangle className='w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5' />
                <div className='space-y-1'>
                  <p className='text-sm font-medium text-amber-900 dark:text-amber-200'>
                    内置演示站仅供测试，极其不稳定，强烈建议用户自行部署。
                  </p>
                  <p className='text-xs text-amber-700 dark:text-amber-300 flex flex-wrap items-center gap-1.5'>
                    自部署教程:
                    <a
                      href={DEPLOYMENT_GUIDE_URL}
                      target='_blank'
                      rel='noopener noreferrer'
                      className='inline-flex items-center gap-1 font-medium underline hover:text-amber-900 dark:hover:text-amber-100'
                    >
                      huangxd-/danmu_api
                      <ExternalLink className='w-3 h-3' />
                    </a>
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 服务器地址 & Token */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-blue-500 rounded-full'></span>
                服务器连接
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                配置 LogVar 弹幕 API 服务器地址和访问令牌
              </p>
            </div>
            <div className='p-4 space-y-4'>
              {/* 服务器地址 */}
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  服务器地址
                </label>
                <div className='flex gap-2'>
                  <input
                    type='text'
                    value={danmuSettings.serverUrl}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        serverUrl: e.target.value,
                      }))
                    }
                    placeholder='如 http://192.168.1.7:9321 或 https://your-domain.com'
                    className='flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder-gray-400 dark:placeholder-gray-500'
                  />
                  <button
                    onClick={handleTest}
                    disabled={
                      isLoading('testDanmuServer') || !danmuSettings.serverUrl
                    }
                    className={`shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                      isLoading('testDanmuServer') || !danmuSettings.serverUrl
                        ? buttonStyles.disabled
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm hover:shadow-md'
                    }`}
                  >
                    {isLoading('testDanmuServer') ? (
                      <svg
                        className='w-4 h-4 animate-spin'
                        viewBox='0 0 24 24'
                        fill='none'
                      >
                        <circle
                          className='opacity-25'
                          cx='12'
                          cy='12'
                          r='10'
                          stroke='currentColor'
                          strokeWidth='4'
                        />
                        <path
                          className='opacity-75'
                          fill='currentColor'
                          d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                        />
                      </svg>
                    ) : (
                      <svg
                        className='w-4 h-4'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth='2'
                          d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                    )}
                    {isLoading('testDanmuServer') ? '测试中...' : '连通测试'}
                  </button>
                </div>
              </div>

              {/* Token */}
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  API Token
                  <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                    官方稳定节点默认 decotv，留空则不携带 token
                  </span>
                </label>
                <input
                  type='text'
                  value={danmuSettings.token}
                  onChange={(e) =>
                    setDanmuSettings((prev) => ({
                      ...prev,
                      token: e.target.value,
                    }))
                  }
                  placeholder='decotv'
                  className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500'
                />
              </div>

              {/* 拼接后完整地址显示 */}
              {danmuSettings.serverUrl && (
                <div className='bg-gray-50 dark:bg-gray-900/30 rounded-lg p-3 border border-gray-100 dark:border-gray-700/50'>
                  <p className='text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    完整 API 端点
                  </p>
                  <p className='text-sm font-mono text-gray-700 dark:text-gray-300 break-all'>
                    {getFullServerUrl()}
                  </p>
                </div>
              )}

              {/* 连通测试结果 */}
              {testResult && (
                <div
                  className={`rounded-lg border p-3 ${
                    testResult.success
                      ? 'bg-emerald-50 dark:bg-emerald-900/10 border-emerald-200 dark:border-emerald-800'
                      : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                  }`}
                >
                  <div className='flex items-start gap-2'>
                    {testResult.success ? (
                      <CheckCircle className='w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5' />
                    ) : (
                      <AlertCircle className='w-5 h-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5' />
                    )}
                    <div className='text-sm'>
                      <p
                        className={`font-medium ${testResult.success ? 'text-emerald-800 dark:text-emerald-300' : 'text-red-800 dark:text-red-300'}`}
                      >
                        {testResult.success ? '服务器连接成功' : '连接失败'}
                      </p>
                      {testResult.success && (
                        <div className='mt-1 space-y-0.5 text-emerald-700 dark:text-emerald-400'>
                          <p>延迟: {testResult.latency}ms</p>
                          <p>
                            搜索接口:
                            {testResult.searchAvailable
                              ? ` 可用（测试返回 ${testResult.searchResultCount} 条结果）`
                              : ' 不可用'}
                          </p>
                        </div>
                      )}
                      {testResult.error && (
                        <p className='mt-1 text-red-600 dark:text-red-400'>
                          {testResult.error}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 推荐节点快速选择 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-purple-500 rounded-full'></span>
                推荐节点（含稳定源）
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                已内置官方推荐稳定节点；历史演示站通常不稳定，建议优先使用自建服务。
              </p>
            </div>
            <div className='p-4'>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2'>
                {DEMO_DANMU_SERVERS.map((server) => {
                  const isSelected = danmuSettings.serverUrl === server.url;
                  return (
                    <button
                      key={server.url}
                      onClick={() => handleSelectDemoServer(server)}
                      className={`text-left p-3 rounded-lg border-2 transition-all ${
                        isSelected
                          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                          : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 bg-white dark:bg-gray-800'
                      }`}
                    >
                      <p
                        className={`text-sm font-medium ${
                          isSelected
                            ? 'text-purple-700 dark:text-purple-300'
                            : 'text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        {server.name}
                      </p>
                      {server.badge && (
                        <div className='mt-1'>
                          <span className='inline-flex rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 text-[11px] font-medium'>
                            {server.badge}
                          </span>
                        </div>
                      )}
                      <p className='text-xs font-mono text-gray-500 dark:text-gray-400 mt-0.5 truncate'>
                        {server.url}
                      </p>
                      {server.token && (
                        <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                          Token:{' '}
                          <span className='font-mono'>{server.token}</span>
                        </p>
                      )}
                      {isSelected && (
                        <div className='flex items-center gap-1 mt-1'>
                          <Check className='w-3 h-3 text-purple-500' />
                          <span className='text-xs text-purple-600 dark:text-purple-400'>
                            已选择
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between gap-3'>
              <div>
                <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                  <span className='w-1 h-4 bg-emerald-500 rounded-full'></span>
                  自定义节点库
                </h4>
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                  管理多个弹幕节点，支持添加、编辑、删除、延迟测试和一键应用
                </p>
              </div>
              <button
                type='button'
                onClick={openAddNodeModal}
                className={buttonStyles.primarySmall}
              >
                添加节点
              </button>
            </div>
            <div className='p-4'>
              {customNodes.length === 0 ? (
                <div className='rounded-lg border border-dashed border-gray-300 dark:border-gray-700 p-6 text-center text-sm text-gray-500 dark:text-gray-400'>
                  暂无自定义节点，点击右上角“添加节点”
                </div>
              ) : (
                <div className='space-y-2'>
                  {customNodes.map((node) => {
                    const selected = isNodeSelected(node);
                    const testLoadingKey = `testDanmuNode_${node.id}`;
                    const applyLoadingKey = `applyDanmuNode_${node.id}`;
                    return (
                      <div
                        key={node.id}
                        className={`rounded-lg border p-3 transition-all ${
                          selected
                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/60 dark:bg-emerald-900/20'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900/20'
                        }`}
                      >
                        <div className='flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between'>
                          <div className='min-w-0 flex-1'>
                            <div className='flex items-center gap-2'>
                              <p className='text-sm font-medium text-gray-800 dark:text-gray-100 truncate'>
                                {node.name}
                              </p>
                              {selected && (
                                <span className='inline-flex rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 text-[11px]'>
                                  当前使用
                                </span>
                              )}
                            </div>
                            <p className='mt-1 text-xs font-mono text-gray-500 dark:text-gray-400 break-all'>
                              {node.url}
                            </p>
                            {node.token && (
                              <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                                Token:{' '}
                                <span className='font-mono'>{node.token}</span>
                              </p>
                            )}
                          </div>
                          <div className='flex flex-wrap items-center gap-2'>
                            {getNodeHealthView(node.id)}
                            <button
                              type='button'
                              onClick={() => handleTestNode(node)}
                              disabled={isLoading(testLoadingKey)}
                              className={`px-2 py-1 text-xs rounded-md ${
                                isLoading(testLoadingKey)
                                  ? buttonStyles.disabledSmall
                                  : buttonStyles.secondarySmall
                              }`}
                            >
                              {isLoading(testLoadingKey)
                                ? '测试中...'
                                : '测试延迟'}
                            </button>
                            <button
                              type='button'
                              onClick={() => handleApplyNode(node)}
                              disabled={isLoading(applyLoadingKey)}
                              className={`px-2 py-1 text-xs rounded-md ${
                                isLoading(applyLoadingKey)
                                  ? buttonStyles.disabledSmall
                                  : buttonStyles.successSmall
                              }`}
                            >
                              {isLoading(applyLoadingKey)
                                ? '应用中...'
                                : '使用此节点'}
                            </button>
                            <button
                              type='button'
                              onClick={() => openEditNodeModal(node)}
                              className={buttonStyles.primarySmall}
                            >
                              编辑
                            </button>
                            <button
                              type='button'
                              onClick={() => handleDeleteNode(node)}
                              className={buttonStyles.dangerSmall}
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 弹幕来源平台优先级 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-amber-500 rounded-full'></span>
                弹幕来源平台优先级
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                选择并排列弹幕优先匹配的视频平台，留空则自动匹配
              </p>
            </div>
            <div className='p-4'>
              <div className='flex flex-wrap gap-2'>
                {PLATFORM_OPTIONS.map((opt) => {
                  const isActive = selectedPlatforms.includes(opt.value);
                  const order = selectedPlatforms.indexOf(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => togglePlatform(opt.value)}
                      className={`relative inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200 ring-2 ring-amber-300 dark:ring-amber-700'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {isActive && (
                        <span className='mr-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-white text-[10px] font-bold'>
                          {order + 1}
                        </span>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {selectedPlatforms.length > 0 && (
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-2'>
                  当前优先级: {selectedPlatforms.join(' > ')}
                </p>
              )}
            </div>
          </div>

          {/* 采集源配置 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
              <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                <span className='w-1 h-4 bg-cyan-500 rounded-full'></span>
                采集源排序
              </h4>
              <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
                选择启用的采集源并按优先级排列，未选择则使用服务器默认配置
              </p>
            </div>
            <div className='p-4'>
              <div className='flex flex-wrap gap-2'>
                {SOURCE_OPTIONS.map((opt) => {
                  const isActive = selectedSources.includes(opt.value);
                  const order = selectedSources.indexOf(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => toggleSourceOrder(opt.value)}
                      className={`relative inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                        isActive
                          ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200 ring-2 ring-cyan-300 dark:ring-cyan-700'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700/40 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      }`}
                    >
                      {isActive && (
                        <span className='mr-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-cyan-500 text-white text-[10px] font-bold'>
                          {order + 1}
                        </span>
                      )}
                      {opt.label}
                    </button>
                  );
                })}
              </div>
              {selectedSources.length > 0 && (
                <p className='text-xs text-gray-500 dark:text-gray-400 mt-2'>
                  当前排序: {selectedSources.join(' > ')}
                </p>
              )}
            </div>
          </div>

          {/* 高级配置折叠区 */}
          <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className='w-full p-4 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50 hover:bg-gray-100/50 dark:hover:bg-gray-700/50 transition-colors'
            >
              <div className='flex items-center gap-2'>
                <span className='w-1 h-4 bg-gray-400 rounded-full'></span>
                <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100'>
                  高级配置
                </h4>
                <span className='text-xs text-gray-400 dark:text-gray-500'>
                  弹幕格式、颜色转换、数量限制、屏蔽词等
                </span>
              </div>
              <div className='text-gray-500 dark:text-gray-400'>
                {showAdvanced ? (
                  <ChevronUp size={16} />
                ) : (
                  <ChevronDown size={16} />
                )}
              </div>
            </button>

            {showAdvanced && (
              <div className='p-4 space-y-4 border-t border-gray-100 dark:border-gray-700/50'>
                {/* 弹幕输出格式 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    弹幕输出格式
                  </label>
                  <div className='flex gap-3'>
                    {[
                      { value: 'json', label: 'JSON' },
                      { value: 'xml', label: 'XML (Bilibili 标准)' },
                    ].map((fmt) => (
                      <label
                        key={fmt.value}
                        className={`cursor-pointer flex items-center gap-2 px-4 py-2 rounded-lg border-2 transition-all ${
                          danmuSettings.danmuOutputFormat === fmt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type='radio'
                          name='danmuOutputFormat'
                          value={fmt.value}
                          checked={
                            danmuSettings.danmuOutputFormat === fmt.value
                          }
                          onChange={(e) =>
                            setDanmuSettings((prev) => ({
                              ...prev,
                              danmuOutputFormat: e.target.value as
                                | 'json'
                                | 'xml',
                            }))
                          }
                          className='sr-only'
                        />
                        <span className='text-sm font-medium'>{fmt.label}</span>
                        {danmuSettings.danmuOutputFormat === fmt.value && (
                          <Check className='w-4 h-4 text-blue-500' />
                        )}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 弹幕颜色转换 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    弹幕颜色转换
                  </label>
                  <div className='flex flex-wrap gap-2'>
                    {[
                      { value: 'default', label: '不转换' },
                      { value: 'white', label: '全部转白色' },
                      { value: 'color', label: '白色转随机彩色' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`cursor-pointer px-3 py-1.5 rounded-lg border-2 text-sm transition-all ${
                          danmuSettings.convertColor === opt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type='radio'
                          name='convertColor'
                          value={opt.value}
                          checked={danmuSettings.convertColor === opt.value}
                          onChange={(e) =>
                            setDanmuSettings((prev) => ({
                              ...prev,
                              convertColor: e.target.value as
                                | 'default'
                                | 'white'
                                | 'color',
                            }))
                          }
                          className='sr-only'
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 简繁转换 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    弹幕简繁体转换
                  </label>
                  <div className='flex flex-wrap gap-2'>
                    {[
                      { value: 'default', label: '不转换' },
                      { value: 'simplified', label: '繁体转简体' },
                      { value: 'traditional', label: '简体转繁体' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className={`cursor-pointer px-3 py-1.5 rounded-lg border-2 text-sm transition-all ${
                          danmuSettings.simplifiedTraditional === opt.value
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                            : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-200'
                        }`}
                      >
                        <input
                          type='radio'
                          name='simplifiedTraditional'
                          value={opt.value}
                          checked={
                            danmuSettings.simplifiedTraditional === opt.value
                          }
                          onChange={(e) =>
                            setDanmuSettings((prev) => ({
                              ...prev,
                              simplifiedTraditional: e.target.value as
                                | 'default'
                                | 'simplified'
                                | 'traditional',
                            }))
                          }
                          className='sr-only'
                        />
                        {opt.label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* 顶部/底部弹幕转浮动 */}
                <div className='flex items-center justify-between'>
                  <div>
                    <p className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                      顶部/底部弹幕转浮动
                    </p>
                    <p className='text-xs text-gray-500 dark:text-gray-400'>
                      部分播放器不支持顶部/底部弹幕时启用
                    </p>
                  </div>
                  <button
                    onClick={() =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        convertTopBottomToScroll:
                          !prev.convertTopBottomToScroll,
                      }))
                    }
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      danmuSettings.convertTopBottomToScroll
                        ? buttonStyles.toggleOn
                        : buttonStyles.toggleOff
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full transition-transform ${
                        buttonStyles.toggleThumb
                      } ${
                        danmuSettings.convertTopBottomToScroll
                          ? 'translate-x-6'
                          : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {/* 弹幕数量限制 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    弹幕数量限制
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      单位: 千条 (0 = 不限制)
                    </span>
                  </label>
                  <input
                    type='number'
                    min={0}
                    max={100}
                    value={danmuSettings.danmuLimit}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        danmuLimit: parseInt(e.target.value) || 0,
                      }))
                    }
                    className='w-32 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'
                  />
                </div>

                {/* 源合并配置 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    源合并配置
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      格式: 源1&源2,源3&源4 （用 & 合并，用 , 分组）
                    </span>
                  </label>
                  <input
                    type='text'
                    value={danmuSettings.mergeSourcePairs}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        mergeSourcePairs: e.target.value,
                      }))
                    }
                    placeholder='如 imgo&iqiyi,dandan&bahamut&animeko'
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500'
                  />
                </div>

                {/* B站 Cookie */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    哔哩哔哩 Cookie
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      填入后可获取完整弹幕和港澳台内容
                    </span>
                  </label>
                  <textarea
                    value={danmuSettings.bilibiliCookie}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        bilibiliCookie: e.target.value,
                      }))
                    }
                    placeholder='SESSDATA=xxx; bili_jct=xxx'
                    rows={2}
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500 resize-none'
                  />
                </div>

                {/* 弹幕屏蔽词 */}
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                    弹幕屏蔽词
                    <span className='text-xs text-gray-400 dark:text-gray-500 font-normal ml-2'>
                      支持正则表达式，用逗号分隔
                    </span>
                  </label>
                  <textarea
                    value={danmuSettings.blockedWords}
                    onChange={(e) =>
                      setDanmuSettings((prev) => ({
                        ...prev,
                        blockedWords: e.target.value,
                      }))
                    }
                    placeholder='/.{20,}/,/签到|打卡|前排/'
                    rows={3}
                    className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500 resize-none'
                  />
                </div>
              </div>
            )}
          </div>

          {/* 保存按钮 */}
          <div className='flex items-center justify-end gap-3 pt-2'>
            <button
              onClick={handleSave}
              disabled={isLoading('saveDanmuConfig')}
              className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
                isLoading('saveDanmuConfig')
                  ? buttonStyles.disabled
                  : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md'
              }`}
            >
              {isLoading('saveDanmuConfig') ? (
                <svg
                  className='w-4 h-4 animate-spin'
                  viewBox='0 0 24 24'
                  fill='none'
                >
                  <circle
                    className='opacity-25'
                    cx='12'
                    cy='12'
                    r='10'
                    stroke='currentColor'
                    strokeWidth='4'
                  />
                  <path
                    className='opacity-75'
                    fill='currentColor'
                    d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                  />
                </svg>
              ) : (
                <Check className='w-4 h-4' />
              )}
              {isLoading('saveDanmuConfig') ? '保存中...' : '保存配置'}
            </button>
          </div>
        </div>
      )}

      {/* 保存按钮 - 当弹幕服务关闭时也需要保存 */}
      {!danmuSettings.enabled && (
        <div className='flex items-center justify-end gap-3 pt-2'>
          <button
            onClick={handleSave}
            disabled={isLoading('saveDanmuConfig')}
            className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-all flex items-center gap-2 ${
              isLoading('saveDanmuConfig')
                ? buttonStyles.disabled
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm hover:shadow-md'
            }`}
          >
            {isLoading('saveDanmuConfig') ? (
              <svg
                className='w-4 h-4 animate-spin'
                viewBox='0 0 24 24'
                fill='none'
              >
                <circle
                  className='opacity-25'
                  cx='12'
                  cy='12'
                  r='10'
                  stroke='currentColor'
                  strokeWidth='4'
                />
                <path
                  className='opacity-75'
                  fill='currentColor'
                  d='M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z'
                />
              </svg>
            ) : (
              <Check className='w-4 h-4' />
            )}
            {isLoading('saveDanmuConfig') ? '保存中...' : '保存配置'}
          </button>
        </div>
      )}

      {isNodeModalOpen && (
        <div
          className='fixed inset-0 z-1002 flex items-center justify-center bg-black/60 p-4'
          onClick={closeNodeModal}
        >
          <div
            className='w-full max-w-lg rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl'
            onClick={(e) => e.stopPropagation()}
          >
            <div className='flex items-center justify-between border-b border-gray-100 dark:border-gray-700 px-5 py-4'>
              <h5 className='text-base font-semibold text-gray-900 dark:text-gray-100'>
                {editingNodeId ? '编辑自定义节点' : '添加自定义节点'}
              </h5>
              <button
                type='button'
                onClick={closeNodeModal}
                className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
              >
                关闭
              </button>
            </div>
            <div className='space-y-4 px-5 py-4'>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  节点名称
                </label>
                <input
                  type='text'
                  value={nodeForm.name}
                  onChange={(e) =>
                    setNodeForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  placeholder='例如：家庭节点 / 海外节点'
                  className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  服务地址
                </label>
                <input
                  type='text'
                  value={nodeForm.url}
                  onChange={(e) =>
                    setNodeForm((prev) => ({ ...prev, url: e.target.value }))
                  }
                  placeholder='https://danmu.example.com'
                  className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                />
              </div>
              <div>
                <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
                  API Token
                </label>
                <input
                  type='text'
                  value={nodeForm.token}
                  onChange={(e) =>
                    setNodeForm((prev) => ({ ...prev, token: e.target.value }))
                  }
                  placeholder='可留空'
                  className='w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'
                />
              </div>
            </div>
            <div className='flex items-center justify-end gap-2 border-t border-gray-100 dark:border-gray-700 px-5 py-4'>
              <button
                type='button'
                onClick={closeNodeModal}
                className={buttonStyles.secondarySmall}
              >
                取消
              </button>
              <button
                type='button'
                onClick={handleSubmitNode}
                className={buttonStyles.primarySmall}
              >
                {editingNodeId ? '保存修改' : '添加节点'}
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

interface PanSouConfigProps {
  config: AdminConfig | null;
  refreshConfig: () => Promise<void>;
}

interface PanSouSettingsState {
  serverUrl: string;
  token: string;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
const PanSouConfigComponent = ({
  config,
  refreshConfig,
}: PanSouConfigProps) => {
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();

  const normalizeServerUrl = useCallback((value: string) => {
    return value.trim().replace(/\/+$/, '');
  }, []);

  const [settings, setSettings] = useState<PanSouSettingsState>({
    serverUrl: normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL),
    token: '',
  });
  const [testResult, setTestResult] = useState<{
    success?: boolean;
    latency?: number;
    healthStatus?: number;
    searchStatus?: number;
    searchResultCount?: number;
    error?: string;
  } | null>(null);

  const activePanSouNode = useMemo(() => {
    const nodes = config?.PanSouConfig?.nodes || [];
    if (!Array.isArray(nodes) || nodes.length === 0) {
      return null;
    }
    return (
      nodes.find((node) => node.id === config?.PanSouConfig?.activeNodeId) ||
      nodes[0]
    );
  }, [config]);

  useEffect(() => {
    setSettings({
      serverUrl:
        normalizeServerUrl(activePanSouNode?.serverUrl || '') ||
        normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL),
      token: activePanSouNode?.token || '',
    });
  }, [activePanSouNode, normalizeServerUrl]);

  const handleSave = async () => {
    const serverUrl = normalizeServerUrl(settings.serverUrl);
    if (!serverUrl) {
      showError('请先填写 PanSou 服务地址', showAlert);
      return;
    }

    await withLoading('savePanSouConfig', async () => {
      try {
        const response = await fetch('/api/admin/pansou', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverUrl,
            token: settings.token.trim(),
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data.error || '保存失败');
        }
        await refreshConfig();
        showSuccess('PanSou 配置保存成功', showAlert);
      } catch (error) {
        showError(
          `保存 PanSou 配置失败: ${error instanceof Error ? error.message : '未知错误'}`,
          showAlert,
        );
      }
    });
  };

  const handleTest = async () => {
    const serverUrl = normalizeServerUrl(settings.serverUrl);
    if (!serverUrl) {
      showError('请先填写 PanSou 服务地址', showAlert);
      return;
    }

    setTestResult(null);
    await withLoading('testPanSouServer', async () => {
      try {
        const response = await fetch('/api/admin/pansou/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverUrl,
            token: settings.token.trim(),
          }),
        });
        const data = (await response.json().catch(() => ({}))) as {
          success?: boolean;
          latency?: number;
          healthStatus?: number;
          searchStatus?: number;
          searchResultCount?: number;
          error?: string;
        };
        setTestResult(data);
      } catch (error) {
        setTestResult({
          success: false,
          error: error instanceof Error ? error.message : '网络请求失败',
        });
      }
    });
  };

  const handleUseDemoServer = () => {
    setSettings((prev) => ({
      ...prev,
      serverUrl: normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL),
    }));
    setTestResult(null);
  };

  const currentServerUrl = normalizeServerUrl(settings.serverUrl);
  const isDemoSelected =
    currentServerUrl === normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL);

  return (
    <div className='space-y-6'>
      <div className='rounded-lg border border-cyan-200 dark:border-cyan-900/60 bg-cyan-50 dark:bg-cyan-900/10 p-4'>
        <div className='flex items-center justify-between gap-3'>
          <div className='space-y-1'>
            <p className='text-sm font-semibold text-cyan-900 dark:text-cyan-200'>
              当前 PanSou 节点
            </p>
            <p className='text-xs text-cyan-700 dark:text-cyan-300 break-all'>
              {currentServerUrl || '未配置'}
            </p>
            <p className='text-xs text-cyan-700/90 dark:text-cyan-300/90'>
              支持对接第三方 PanSou 服务
            </p>
          </div>
          <button
            type='button'
            onClick={handleUseDemoServer}
            className={buttonStyles.secondarySmall}
          >
            使用演示节点
          </button>
        </div>
      </div>

      <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
        <div className='p-4 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
          <h4 className='text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
            <span className='w-1 h-4 bg-cyan-500 rounded-full'></span>
            服务连接
          </h4>
          <p className='text-xs text-gray-500 dark:text-gray-400 mt-1'>
            DecoTV 会将 /api/pansou/search 请求转发到此服务节点
          </p>
        </div>

        <div className='p-4 space-y-4'>
          <div>
            <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'>
              服务地址（URL）
            </label>
            <div className='flex gap-2'>
              <input
                type='text'
                value={settings.serverUrl}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    serverUrl: event.target.value,
                  }))
                }
                placeholder='例如: https://pansou.example.com'
                className='flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all placeholder-gray-400 dark:placeholder-gray-500'
              />
              <button
                type='button'
                onClick={handleTest}
                disabled={isLoading('testPanSouServer') || !currentServerUrl}
                className={`shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                  isLoading('testPanSouServer') || !currentServerUrl
                    ? buttonStyles.disabled
                    : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm hover:shadow-md'
                }`}
              >
                {isLoading('testPanSouServer') ? '测试中...' : '连通性测试'}
              </button>
            </div>
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
              value={settings.token}
              onChange={(event) =>
                setSettings((prev) => ({
                  ...prev,
                  token: event.target.value,
                }))
              }
              placeholder='留空表示不携带 Authorization'
              className='w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900/50 text-gray-900 dark:text-gray-100 text-sm focus:ring-2 focus:ring-cyan-500/20 focus:border-cyan-500 transition-all font-mono placeholder-gray-400 dark:placeholder-gray-500'
            />
          </div>

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
                  <p>延迟: {testResult.latency}ms</p>
                  <p>健康检查状态: {testResult.healthStatus}</p>
                  <p>搜索接口状态: {testResult.searchStatus}</p>
                  <p>测试返回结果数: {testResult.searchResultCount ?? 0}</p>
                </div>
              ) : (
                <p className='mt-1 text-xs text-red-700 dark:text-red-400'>
                  {testResult.error || '连接异常，请检查地址与鉴权配置'}
                </p>
              )}
            </div>
          )}

          <div className='rounded-lg border border-gray-100 dark:border-gray-700/50 bg-gray-50 dark:bg-gray-900/30 p-3'>
            <p className='text-xs text-gray-600 dark:text-gray-400'>
              默认演示地址：{normalizeServerUrl(DEFAULT_PANSOU_SERVER_URL)}
            </p>
            {isDemoSelected && (
              <p className='text-xs text-cyan-600 dark:text-cyan-400 mt-1'>
                当前已选中演示节点
              </p>
            )}
          </div>
        </div>
      </div>

      <div className='flex justify-end'>
        <button
          type='button'
          onClick={handleSave}
          disabled={isLoading('savePanSouConfig')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            isLoading('savePanSouConfig')
              ? buttonStyles.disabled
              : buttonStyles.success
          }`}
        >
          {isLoading('savePanSouConfig') ? '保存中...' : '保存配置'}
        </button>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />
    </div>
  );
};

function AdminPageClient() {
  const router = useRouter();
  const { alertModal, showAlert, hideAlert } = useAlertModal();
  const { isLoading, withLoading } = useLoadingState();
  const [config, setConfig] = useState<AdminConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState<'owner' | 'admin' | null>(null);
  const [storageMode, setStorageMode] = useState<'cloud' | 'local'>('cloud'); // 存储模式
  const [showResetConfigModal, setShowResetConfigModal] = useState(false);
  const [expandedTabs, setExpandedTabs] = useState<{ [key: string]: boolean }>({
    userConfig: false,
    videoSource: false,
    liveSource: false,
    tvboxConfig: false,
    siteConfig: false,
    categoryConfig: false,
    configFile: false,
    danmuConfig: false,
    pansouConfig: false,
    dataMigration: false,
  });

  // TVBox 配置相关状态
  const [tvboxFormat, setTvboxFormat] = useState<'json' | 'base64'>('json');
  const [tvboxMode, setTvboxMode] = useState<
    'standard' | 'safe' | 'yingshicang' | 'fast'
  >('fast');
  const [diagnosisResult, setDiagnosisResult] = useState<any>(null);
  const [isDiagnosing, setIsDiagnosing] = useState(false);

  // JAR 状态监控相关状态
  const [jarStatus, setJarStatus] = useState<any>(null);
  const [isRefreshingJar, setIsRefreshingJar] = useState(false);
  const [isCheckingJar, setIsCheckingJar] = useState(false);

  // localStorage 键名常量
  const LOCAL_CONFIG_KEY = 'decotv_admin_config';

  // 从 localStorage 读取配置
  const loadLocalConfig = useCallback((): AdminConfig | null => {
    try {
      const stored = localStorage.getItem(LOCAL_CONFIG_KEY);
      if (stored) {
        return JSON.parse(stored) as AdminConfig;
      }
    } catch (e) {
      console.error('读取本地配置失败:', e);
    }
    return null;
  }, []);

  // 保存配置到 localStorage
  const saveLocalConfig = useCallback((configToSave: AdminConfig) => {
    try {
      localStorage.setItem(LOCAL_CONFIG_KEY, JSON.stringify(configToSave));
      return true;
    } catch (e) {
      console.error('保存本地配置失败:', e);
      return false;
    }
  }, []);

  // 获取管理员配置
  // showLoading 用于控制是否在请求期间显示整体加载骨架。
  const fetchConfig = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) {
          setLoading(true);
        }

        const response = await fetch(`/api/admin/config`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(`获取配置失败: ${data.error || response.statusText}`);
        }

        // 检查存储模式
        const mode = data.storageMode || 'cloud';
        setStorageMode(mode);

        let finalConfig = data.Config;

        // 如果是本地模式，尝试从 localStorage 读取并合并配置
        if (mode === 'local') {
          const localConfig = loadLocalConfig();
          if (localConfig) {
            // 用 localStorage 中的配置覆盖 API 返回的默认配置
            finalConfig = localConfig;
          }
        }

        setConfig(finalConfig);
        setRole(data.Role);
        // 成功时清除之前的错误状态
        setError(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '获取配置失败';
        console.error('Admin config fetch error:', err);
        showError(msg, showAlert);
        setError(msg);
      } finally {
        if (showLoading) {
          setLoading(false);
        }
      }
    },
    [loadLocalConfig],
  );

  const refreshConfigAfterMutation = useCallback(async () => {
    await fetchConfig();
    router.refresh();
  }, [fetchConfig, router]);

  // 同步配置到后端内存（本地模式专用）
  const syncConfigToBackend = useCallback(async (configToSync: AdminConfig) => {
    try {
      const response = await fetch('/api/admin/config/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: configToSync }),
      });
      if (!response.ok) {
        console.warn('同步配置到后端失败');
      } else {
        console.log('[本地模式] 配置已同步到后端内存');
      }
    } catch (e) {
      console.warn('同步配置到后端失败:', e);
    }
  }, []);

  // 当配置变化且是本地模式时，自动同步到 localStorage 和后端
  useEffect(() => {
    if (storageMode === 'local' && config) {
      saveLocalConfig(config);
      // 同时同步到后端内存，确保搜索和播放功能正常工作
      syncConfigToBackend(config);
    }
  }, [config, storageMode, saveLocalConfig, syncConfigToBackend]);

  // 直接更新配置（用于本地模式下的子组件）
  const updateConfig = useCallback(
    (updater: (prev: AdminConfig | null) => AdminConfig | null) => {
      setConfig(updater);
    },
    [],
  );

  useEffect(() => {
    // 首次加载时显示骨架
    fetchConfig(true);
  }, [fetchConfig]);

  // 切换标签展开状态
  const toggleTab = (tabKey: string) => {
    setExpandedTabs((prev) => ({
      ...prev,
      [tabKey]: !prev[tabKey],
    }));
  };

  // TVBox 配置相关函数
  const getTvboxConfigUrl = () => {
    // 优先使用显式配置的公网基址，避免出现 0.0.0.0、localhost 等不可用地址
    const envBase = (process.env.NEXT_PUBLIC_SITE_BASE || '')
      .trim()
      .replace(/\/$/, '');
    let baseUrl = envBase;
    if (!baseUrl) {
      if (typeof window !== 'undefined') {
        baseUrl = window.location.origin;
      } else {
        baseUrl = '';
      }
    }
    // 始终附带 format 参数，确保 JSON 时为 ?format=json
    const modeParam = tvboxMode !== 'standard' ? `&mode=${tvboxMode}` : '';
    return `${baseUrl}/api/tvbox/config?format=${tvboxFormat}${modeParam}`;
  };

  const handleTvboxCopy = async () => {
    try {
      const url = getTvboxConfigUrl();
      await navigator.clipboard.writeText(url);
      showSuccess('复制成功！订阅地址已复制到剪贴板', showAlert);
    } catch {
      showError('复制失败，请手动复制地址', showAlert);
    }
  };

  // 连通性体检功能
  const handleDiagnosis = async () => {
    setIsDiagnosing(true);
    try {
      const response = await fetch('/api/tvbox/diagnose');
      const result = await response.json();
      setDiagnosisResult(result);

      if (result.pass) {
        showAlert({
          type: 'success',
          title: '🟢 配置健康检查通过',
          message: '配置可正常访问，JSON格式有效，连通性良好',
          timer: 3000,
        });
      } else {
        const issues = result.issues.join('；');
        showAlert({
          type: 'error',
          title: '🔴 配置健康检查失败',
          message: `发现问题：${issues}`,
        });
      }
    } catch (error) {
      showAlert({
        type: 'error',
        title: '体检失败',
        message: error instanceof Error ? error.message : '网络错误',
      });
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleTvboxTest = async () => {
    try {
      const url = getTvboxConfigUrl();
      const response = await fetch(url);
      if (response.ok) {
        showSuccess('配置测试成功！订阅地址可正常访问', showAlert);
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (err) {
      showError(
        `配置测试失败: ${err instanceof Error ? err.message : '网络错误'}`,
        showAlert,
      );
    }
  };

  // JAR 状态相关函数
  const handleCheckJarStatus = async () => {
    setIsCheckingJar(true);
    try {
      const response = await fetch('/api/tvbox/spider-status');
      const result = await response.json();
      setJarStatus(result);

      if (result.success && result.fresh_status.success) {
        showAlert({
          type: 'success',
          title: '🟢 JAR 状态正常',
          message: `源: ${result.fresh_status.source
            .split('/')
            .pop()}, 大小: ${Math.round(result.fresh_status.size / 1024)}KB`,
          timer: 3000,
        });
      } else {
        showAlert({
          type: 'warning',
          title: '⚠️ JAR 状态异常',
          message: result.fresh_status.is_fallback
            ? '正在使用内置备用JAR'
            : '远程JAR获取失败',
        });
      }
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'JAR 状态检查失败',
        message: error instanceof Error ? error.message : '网络错误',
      });
    } finally {
      setIsCheckingJar(false);
    }
  };

  const handleRefreshJar = async () => {
    setIsRefreshingJar(true);
    try {
      const response = await fetch('/api/tvbox/spider-status', {
        method: 'POST',
      });
      const result = await response.json();

      if (result.success) {
        setJarStatus(result);
        if (result.jar_status.success) {
          showAlert({
            type: 'success',
            title: '🎉 JAR 刷新成功',
            message: `已获取新的JAR文件，尝试了 ${result.jar_status.tried_sources} 个源`,
            timer: 3000,
          });
        } else {
          showAlert({
            type: 'warning',
            title: '⚠️ JAR 刷新完成',
            message: '远程源暂时不可用，正在使用内置备用JAR',
          });
        }
      } else {
        throw new Error(result.error || 'JAR 刷新失败');
      }
    } catch (error) {
      showAlert({
        type: 'error',
        title: 'JAR 刷新失败',
        message: error instanceof Error ? error.message : '网络错误',
      });
    } finally {
      setIsRefreshingJar(false);
    }
  };

  // 新增: 重置配置处理函数
  const handleResetConfig = () => {
    setShowResetConfigModal(true);
  };

  const handleConfirmResetConfig = async () => {
    await withLoading('resetConfig', async () => {
      try {
        const response = await fetch(`/api/admin/reset`);
        if (!response.ok) {
          throw new Error(`重置失败: ${response.status}`);
        }
        showSuccess('重置成功，请刷新页面！', showAlert);
        await refreshConfigAfterMutation();
        setShowResetConfigModal(false);
      } catch (err) {
        showError(err instanceof Error ? err.message : '重置失败', showAlert);
        throw err;
      }
    });
  };

  if (loading) {
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理员设置
            </h1>
            <div className='space-y-4'>
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className='h-20 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse'
                />
              ))}
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    // 显示错误信息，而不是返回空白
    return (
      <PageLayout activePath='/admin'>
        <div className='px-2 sm:px-10 py-4 sm:py-8'>
          <div className='max-w-[95%] mx-auto'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100 mb-8'>
              管理员设置
            </h1>
            <div className='p-6 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800'>
              <div className='flex items-start gap-3'>
                <AlertCircle className='w-6 h-6 text-red-600 dark:text-red-400 shrink-0 mt-0.5' />
                <div className='flex-1'>
                  <h3 className='text-lg font-semibold text-red-800 dark:text-red-300 mb-2'>
                    加载失败
                  </h3>
                  <p className='text-red-700 dark:text-red-400 mb-4'>{error}</p>
                  <div className='text-sm text-red-600 dark:text-red-500 mb-4'>
                    <p className='mb-2'>可能的原因：</p>
                    <ul className='list-disc list-inside space-y-1'>
                      <li>数据库连接失败（请检查 Redis/Upstash 配置）</li>
                      <li>权限不足（需要 owner 或 admin 角色）</li>
                      <li>网络连接问题</li>
                    </ul>
                  </div>
                  <button
                    onClick={() => {
                      setError(null);
                      fetchConfig(true);
                    }}
                    className={buttonStyles.danger}
                  >
                    重试
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/admin'>
      <div className='px-2 sm:px-10 py-4 sm:py-8'>
        <div className='max-w-[95%] mx-auto'>
          {/* 本地模式警告提示 */}
          {storageMode === 'local' && (
            <div className='mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800'>
              <div className='flex items-start gap-3'>
                <AlertTriangle className='w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5' />
                <div className='flex-1'>
                  <h4 className='text-sm font-semibold text-yellow-800 dark:text-yellow-300 mb-1'>
                    本地存储模式
                  </h4>
                  <p className='text-sm text-yellow-700 dark:text-yellow-400'>
                    未检测到云端数据库（Redis/Upstash），当前配置将仅保存在您的浏览器缓存中。
                    <span className='font-medium'>
                      清除浏览器数据后配置将丢失。
                    </span>
                    如需持久化存储，请配置 Redis 或 Upstash 数据库。
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* 标题 + 重置配置按钮 */}
          <div className='flex items-center gap-2 mb-8'>
            <h1 className='text-2xl font-bold text-gray-900 dark:text-gray-100'>
              管理员设置
            </h1>
            {config && role === 'owner' && (
              <button
                onClick={handleResetConfig}
                className={`px-3 py-1 text-xs rounded-md transition-colors ${buttonStyles.dangerSmall}`}
              >
                重置配置
              </button>
            )}
          </div>

          {/* 配置文件标签 - 仅站长可见 */}
          {role === 'owner' && (
            <CollapsibleTab
              title='配置文件'
              icon={
                <FileText
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.configFile}
              onToggle={() => toggleTab('configFile')}
            >
              <ConfigFileComponent
                config={config}
                refreshConfig={refreshConfigAfterMutation}
                storageMode={storageMode}
                updateConfig={updateConfig}
              />
            </CollapsibleTab>
          )}

          {/* 站点配置标签 */}
          <CollapsibleTab
            title='站点配置'
            icon={
              <Settings
                size={20}
                className='text-gray-600 dark:text-gray-400'
              />
            }
            isExpanded={expandedTabs.siteConfig}
            onToggle={() => toggleTab('siteConfig')}
          >
            <SiteConfigComponent
              config={config}
              refreshConfig={refreshConfigAfterMutation}
            />
          </CollapsibleTab>

          <div className='space-y-4'>
            {/* 用户配置标签 */}
            <CollapsibleTab
              title='用户配置'
              icon={
                <Users size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.userConfig}
              onToggle={() => toggleTab('userConfig')}
            >
              <UserConfig
                config={config}
                role={role}
                refreshConfig={refreshConfigAfterMutation}
              />
            </CollapsibleTab>

            {/* 视频源配置标签 */}
            <CollapsibleTab
              title='视频源配置'
              icon={
                <Video size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.videoSource}
              onToggle={() => toggleTab('videoSource')}
            >
              <VideoSourceConfig
                config={config}
                refreshConfig={refreshConfigAfterMutation}
                storageMode={storageMode}
                updateConfig={updateConfig}
              />
            </CollapsibleTab>

            {/* 直播源配置标签 */}
            <CollapsibleTab
              title='直播源配置'
              icon={
                <Tv size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.liveSource}
              onToggle={() => toggleTab('liveSource')}
            >
              <LiveSourceConfig
                config={config}
                refreshConfig={refreshConfigAfterMutation}
                storageMode={storageMode}
                updateConfig={updateConfig}
              />
            </CollapsibleTab>

            {/* TVbox 配置 */}
            <CollapsibleTab
              title='TVbox配置'
              icon={
                <Package
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.tvboxConfig}
              onToggle={() => toggleTab('tvboxConfig')}
            >
              <div className='space-y-6 p-2 sm:p-4'>
                {/* 顶部：订阅链接生成器 (核心功能) */}
                <div className='bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden'>
                  <div className='p-5 border-b border-gray-100 dark:border-gray-700/50 bg-gray-50/50 dark:bg-gray-800/50'>
                    <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
                      <span className='text-xl'>🔗</span> 订阅链接生成器
                    </h3>
                    <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
                      支持标准 TVBox、猫影视、EasyBox 等主流播放器
                    </p>
                  </div>

                  <div className='p-5 space-y-6'>
                    {/* 链接输入框区域 */}
                    <div className='flex flex-col sm:flex-row gap-3'>
                      <div className='relative grow'>
                        <input
                          type='text'
                          readOnly
                          className='w-full pl-4 pr-10 py-3 rounded-lg bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-700 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all font-mono text-sm'
                          value={getTvboxConfigUrl()}
                        />
                        <div className='absolute right-3 top-1/2 -translate-y-1/2 text-gray-400'>
                          <svg
                            className='w-5 h-5'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1'
                            />
                          </svg>
                        </div>
                      </div>
                      <div className='flex gap-2 shrink-0'>
                        <button
                          onClick={handleTvboxCopy}
                          className='flex-1 sm:flex-none px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all shadow-sm hover:shadow-md font-medium flex items-center justify-center gap-2'
                        >
                          <svg
                            className='w-4 h-4'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3'
                            />
                          </svg>
                          复制
                        </button>
                        <button
                          onClick={handleTvboxTest}
                          className='flex-1 sm:flex-none px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-all shadow-sm hover:shadow-md font-medium flex items-center justify-center gap-2'
                        >
                          <svg
                            className='w-4 h-4'
                            fill='none'
                            stroke='currentColor'
                            viewBox='0 0 24 24'
                          >
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z'
                            />
                            <path
                              strokeLinecap='round'
                              strokeLinejoin='round'
                              strokeWidth='2'
                              d='M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                            />
                          </svg>
                          测试
                        </button>
                      </div>
                    </div>

                    <div className='grid grid-cols-1 lg:grid-cols-12 gap-6'>
                      {/* 左侧：格式选择 */}
                      <div className='lg:col-span-4 space-y-3'>
                        <label className='text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                          <span className='w-1 h-4 bg-blue-500 rounded-full'></span>
                          输出格式
                        </label>
                        <div className='grid grid-cols-2 gap-3'>
                          {[
                            { value: 'json', label: 'JSON', icon: '{}' },
                            { value: 'base64', label: 'Base64', icon: 'B64' },
                          ].map((fmt) => (
                            <label
                              key={fmt.value}
                              className={`cursor-pointer relative flex flex-col items-center justify-center p-3 rounded-xl border-2 transition-all ${
                                tvboxFormat === fmt.value
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                                  : 'border-gray-200 dark:border-gray-700 hover:border-blue-200 dark:hover:border-blue-800 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                              }`}
                            >
                              <input
                                type='radio'
                                name='tvboxFormat'
                                value={fmt.value}
                                checked={tvboxFormat === fmt.value}
                                onChange={(e) =>
                                  setTvboxFormat(
                                    e.target.value as 'json' | 'base64',
                                  )
                                }
                                className='sr-only'
                              />
                              <span className='text-lg font-bold font-mono mb-1'>
                                {fmt.icon}
                              </span>
                              <span className='text-xs font-medium'>
                                {fmt.label}
                              </span>
                              {tvboxFormat === fmt.value && (
                                <div className='absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full'></div>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>

                      {/* 右侧：模式选择 */}
                      <div className='lg:col-span-8 space-y-3'>
                        <label className='text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                          <span className='w-1 h-4 bg-purple-500 rounded-full'></span>
                          配置模式
                        </label>
                        <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                          {[
                            {
                              id: 'standard',
                              name: '标准模式',
                              desc: '完整功能，兼容性好',
                              icon: '📱',
                            },
                            {
                              id: 'yingshicang',
                              name: '影视仓优化',
                              desc: '修复JAR兼容问题',
                              icon: '🔥',
                              highlight: true,
                            },
                            {
                              id: 'fast',
                              name: '快速切换',
                              desc: '优化SSL与卡顿',
                              icon: '⚡',
                              highlight: true,
                            },
                            {
                              id: 'safe',
                              name: '兼容模式',
                              desc: '仅基础字段，极简',
                              icon: '🛡️',
                            },
                          ].map((mode) => (
                            <label
                              key={mode.id}
                              className={`cursor-pointer relative flex items-start p-3 rounded-xl border transition-all ${
                                tvboxMode === mode.id
                                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 ring-1 ring-purple-500'
                                  : 'border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 bg-white dark:bg-gray-800'
                              }`}
                            >
                              <input
                                type='radio'
                                name='tvboxMode'
                                value={mode.id}
                                checked={tvboxMode === mode.id}
                                onChange={(e) =>
                                  setTvboxMode(e.target.value as any)
                                }
                                className='sr-only'
                              />
                              <div className='text-2xl mr-3 mt-1'>
                                {mode.icon}
                              </div>
                              <div className='flex-1 min-w-0'>
                                <div
                                  className={`text-sm font-semibold ${
                                    tvboxMode === mode.id
                                      ? 'text-purple-700 dark:text-purple-300'
                                      : 'text-gray-900 dark:text-gray-100'
                                  }`}
                                >
                                  {mode.name}
                                </div>
                                <div className='text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate'>
                                  {mode.desc}
                                </div>
                              </div>
                              {tvboxMode === mode.id && (
                                <div className='absolute top-3 right-3 text-purple-500'>
                                  <svg
                                    className='w-5 h-5'
                                    fill='currentColor'
                                    viewBox='0 0 20 20'
                                  >
                                    <path
                                      fillRule='evenodd'
                                      d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                                      clipRule='evenodd'
                                    />
                                  </svg>
                                </div>
                              )}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 中部：成人内容过滤 (保持原有风格但微调) */}
                <div className='bg-linear-to-br from-pink-50 to-rose-50 dark:from-pink-900/10 dark:to-rose-900/10 rounded-xl border border-pink-100 dark:border-pink-800/30 p-1'>
                  <div className='bg-white/50 dark:bg-gray-800/50 rounded-lg p-4 backdrop-blur-sm'>
                    <div className='flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4'>
                      <div className='flex items-center gap-3'>
                        <div className='w-10 h-10 rounded-full bg-linear-to-br from-pink-500 to-rose-500 flex items-center justify-center text-white shadow-lg shadow-pink-500/30'>
                          🔒
                        </div>
                        <div>
                          <h4 className='text-sm font-bold text-gray-900 dark:text-gray-100'>
                            成人内容过滤
                          </h4>
                          <p className='text-xs text-gray-500 dark:text-gray-400'>
                            无需修改配置，通过 URL 参数灵活控制
                          </p>
                        </div>
                      </div>
                      <a
                        href='https://github.com/Decohererk/DecoTV/blob/main/docs/%E6%88%90%E4%BA%BA%E5%86%85%E5%AE%B9%E8%BF%87%E6%BB%A4%E4%BD%BF%E7%94%A8%E6%8C%87%E5%8D%97.md'
                        target='_blank'
                        rel='noopener noreferrer'
                        className='text-xs text-pink-600 dark:text-pink-400 hover:underline flex items-center gap-1'
                      >
                        查看完整指南{' '}
                        <svg
                          className='w-3 h-3'
                          fill='none'
                          stroke='currentColor'
                          viewBox='0 0 24 24'
                        >
                          <path
                            strokeLinecap='round'
                            strokeLinejoin='round'
                            strokeWidth='2'
                            d='M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14'
                          />
                        </svg>
                      </a>
                    </div>

                    <div className='grid grid-cols-1 sm:grid-cols-2 gap-3'>
                      <button
                        onClick={() => {
                          const baseUrl = getTvboxConfigUrl().split('?')[0];
                          navigator.clipboard.writeText(baseUrl);
                          showSuccess(
                            '已复制家庭安全模式链接（默认过滤成人内容）',
                            showAlert,
                          );
                        }}
                        className='group flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-green-400 dark:hover:border-green-600 hover:shadow-sm transition-all'
                      >
                        <div className='flex items-center gap-3'>
                          <span className='text-xl bg-green-100 dark:bg-green-900/30 p-1.5 rounded-md'>
                            🏠
                          </span>
                          <div className='text-left'>
                            <div className='text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-green-600 dark:group-hover:text-green-400 transition-colors'>
                              家庭安全模式
                            </div>
                            <div className='text-xs text-gray-500 dark:text-gray-400'>
                              过滤所有成人内容
                            </div>
                          </div>
                        </div>
                        <span className='text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-500'>
                          默认
                        </span>
                      </button>

                      <button
                        onClick={() => {
                          const baseUrl = getTvboxConfigUrl().split('?')[0];
                          const fullUrl = `${baseUrl}?filter=off`;
                          navigator.clipboard.writeText(fullUrl);
                          showSuccess(
                            '已复制完整内容模式链接（显示所有内容）',
                            showAlert,
                          );
                        }}
                        className='group flex items-center justify-between p-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-rose-400 dark:hover:border-rose-600 hover:shadow-sm transition-all'
                      >
                        <div className='flex items-center gap-3'>
                          <span className='text-xl bg-rose-100 dark:bg-rose-900/30 p-1.5 rounded-md'>
                            🔓
                          </span>
                          <div className='text-left'>
                            <div className='text-sm font-semibold text-gray-800 dark:text-gray-200 group-hover:text-rose-600 dark:group-hover:text-rose-400 transition-colors'>
                              完整内容模式
                            </div>
                            <div className='text-xs text-gray-500 dark:text-gray-400'>
                              显示所有内容资源
                            </div>
                          </div>
                        </div>
                        <span className='text-xs font-mono bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded text-gray-500'>
                          ?filter=off
                        </span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* 底部：诊断与工具箱 */}
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4'>
                  {/* 连通性体检 */}
                  <div className='bg-gray-50 dark:bg-gray-900/30 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col'>
                    <div className='flex items-center justify-between mb-4'>
                      <h4 className='text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                        🩺 连通性体检
                      </h4>
                      <button
                        onClick={handleDiagnosis}
                        disabled={isDiagnosing}
                        className={`text-xs px-3 py-1.5 rounded-full transition-colors ${
                          isDiagnosing
                            ? 'bg-gray-200 text-gray-500'
                            : 'bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                        }`}
                      >
                        {isDiagnosing ? '检测中...' : '开始检测'}
                      </button>
                    </div>

                    <div className='flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 min-h-20'>
                      {diagnosisResult ? (
                        <div className='flex items-start gap-3'>
                          <div
                            className={`mt-0.5 ${
                              diagnosisResult.pass
                                ? 'text-green-500'
                                : 'text-red-500'
                            }`}
                          >
                            {diagnosisResult.pass ? (
                              <svg
                                className='w-5 h-5'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth='2'
                                  d='M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                                />
                              </svg>
                            ) : (
                              <svg
                                className='w-5 h-5'
                                fill='none'
                                stroke='currentColor'
                                viewBox='0 0 24 24'
                              >
                                <path
                                  strokeLinecap='round'
                                  strokeLinejoin='round'
                                  strokeWidth='2'
                                  d='M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                                />
                              </svg>
                            )}
                          </div>
                          <div className='flex-1'>
                            <div
                              className={`text-sm font-medium ${
                                diagnosisResult.pass
                                  ? 'text-green-600 dark:text-green-400'
                                  : 'text-red-600 dark:text-red-400'
                              }`}
                            >
                              {diagnosisResult.pass
                                ? '配置接口正常'
                                : '配置接口异常'}
                            </div>
                            <div className='text-xs text-gray-500 mt-1 space-y-0.5'>
                              <div>状态码: {diagnosisResult.status}</div>
                              <div>类型: {diagnosisResult.contentType}</div>
                              {diagnosisResult.issues?.length > 0 && (
                                <div className='text-red-500 mt-1'>
                                  {diagnosisResult.issues[0]}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className='h-full flex items-center justify-center text-xs text-gray-400'>
                          点击检测按钮检查接口连通性
                        </div>
                      )}
                    </div>
                  </div>

                  {/* JAR 状态监控 */}
                  <div className='bg-gray-50 dark:bg-gray-900/30 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex flex-col'>
                    <div className='flex items-center justify-between mb-4'>
                      <h4 className='text-sm font-bold text-gray-700 dark:text-gray-300 flex items-center gap-2'>
                        📦 JAR 状态
                      </h4>
                      <div className='flex gap-2'>
                        <button
                          onClick={handleCheckJarStatus}
                          disabled={isCheckingJar}
                          className='text-xs px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors'
                          title='检查状态'
                        >
                          {isCheckingJar ? '...' : '🔍'}
                        </button>
                        <button
                          onClick={handleRefreshJar}
                          disabled={isRefreshingJar}
                          className='text-xs px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-orange-600'
                          title='强制刷新'
                        >
                          {isRefreshingJar ? '...' : '🔄'}
                        </button>
                      </div>
                    </div>

                    <div className='flex-1 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-3 min-h-20'>
                      {jarStatus ? (
                        <div className='flex items-start gap-3'>
                          <div
                            className={`mt-0.5 ${
                              jarStatus.fresh_status?.success
                                ? 'text-green-500'
                                : 'text-yellow-500'
                            }`}
                          >
                            {jarStatus.fresh_status?.success ? '🟢' : '🟡'}
                          </div>
                          <div className='flex-1 min-w-0'>
                            <div className='text-sm font-medium text-gray-800 dark:text-gray-200 truncate'>
                              {jarStatus.fresh_status?.source
                                ?.split('/')
                                .pop() || '未知源'}
                            </div>
                            <div className='text-xs text-gray-500 mt-1 flex gap-2'>
                              <span>
                                {jarStatus.fresh_status?.size
                                  ? Math.round(
                                      jarStatus.fresh_status.size / 1024,
                                    ) + 'KB'
                                  : '-'}
                              </span>
                              <span className='truncate max-w-20'>
                                {jarStatus.fresh_status?.md5?.substring(0, 6)}
                                ...
                              </span>
                            </div>
                            {jarStatus.fresh_status?.is_fallback && (
                              <div className='text-xs text-yellow-600 mt-1'>
                                ⚠️ 使用备用源
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className='h-full flex items-center justify-center text-xs text-gray-400'>
                          暂无状态数据
                        </div>
                      )}
                    </div>

                    <div className='mt-3 grid grid-cols-2 gap-2'>
                      <button
                        onClick={() =>
                          window.open('/api/tvbox/jar-diagnostic', '_blank')
                        }
                        className='px-2 py-1.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors text-center'
                      >
                        🔬 深度诊断
                      </button>
                      <button
                        onClick={() =>
                          window.open('/api/tvbox/jar-test', '_blank')
                        }
                        className='px-2 py-1.5 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded text-xs font-medium hover:bg-teal-200 dark:hover:bg-teal-900/50 transition-colors text-center'
                      >
                        ⚡ 快速测试
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </CollapsibleTab>

            {/* 弹幕配置标签 */}
            <CollapsibleTab
              title='弹幕配置'
              icon={
                <MessageSquareText
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.danmuConfig}
              onToggle={() => toggleTab('danmuConfig')}
            >
              <DanmuConfigComponent
                config={config}
                refreshConfig={refreshConfigAfterMutation}
              />
            </CollapsibleTab>

            <CollapsibleTab
              title='PanSou 配置'
              icon={
                <Cloud size={20} className='text-gray-600 dark:text-gray-400' />
              }
              isExpanded={expandedTabs.pansouConfig}
              onToggle={() => toggleTab('pansouConfig')}
            >
              <PanSouConfigPanel
                config={config}
                refreshConfig={refreshConfigAfterMutation}
              />
            </CollapsibleTab>

            {/* 分类配置标签 */}
            <CollapsibleTab
              title='分类配置'
              icon={
                <FolderOpen
                  size={20}
                  className='text-gray-600 dark:text-gray-400'
                />
              }
              isExpanded={expandedTabs.categoryConfig}
              onToggle={() => toggleTab('categoryConfig')}
            >
              <CategoryConfig
                config={config}
                refreshConfig={refreshConfigAfterMutation}
              />
            </CollapsibleTab>

            {/* 数据迁移标签 - 仅站长可见 */}
            {role === 'owner' && (
              <CollapsibleTab
                title='数据迁移'
                icon={
                  <Database
                    size={20}
                    className='text-gray-600 dark:text-gray-400'
                  />
                }
                isExpanded={expandedTabs.dataMigration}
                onToggle={() => toggleTab('dataMigration')}
              >
                <DataMigration onRefreshConfig={refreshConfigAfterMutation} />
              </CollapsibleTab>
            )}
          </div>
        </div>
      </div>

      {/* 通用弹窗组件 */}
      <AlertModal
        isOpen={alertModal.isOpen}
        onClose={hideAlert}
        type={alertModal.type}
        title={alertModal.title}
        message={alertModal.message}
        timer={alertModal.timer}
        showConfirm={alertModal.showConfirm}
      />

      {/* 重置配置确认弹窗 */}
      {showResetConfigModal &&
        createPortal(
          <div
            className='fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4'
            onClick={() => setShowResetConfigModal(false)}
          >
            <div
              className='bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full'
              onClick={(e) => e.stopPropagation()}
            >
              <div className='p-6'>
                <div className='flex items-center justify-between mb-6'>
                  <h3 className='text-xl font-semibold text-gray-900 dark:text-gray-100'>
                    确认重置配置
                  </h3>
                  <button
                    onClick={() => setShowResetConfigModal(false)}
                    className='text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors'
                  >
                    <svg
                      className='w-6 h-6'
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

                <div className='mb-6'>
                  <div className='bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 mb-4'>
                    <div className='flex items-center space-x-2 mb-2'>
                      <svg
                        className='w-5 h-5 text-yellow-600 dark:text-yellow-400'
                        fill='none'
                        stroke='currentColor'
                        viewBox='0 0 24 24'
                      >
                        <path
                          strokeLinecap='round'
                          strokeLinejoin='round'
                          strokeWidth={2}
                          d='M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                        />
                      </svg>
                      <span className='text-sm font-medium text-yellow-800 dark:text-yellow-300'>
                        ⚠️ 危险操作警告
                      </span>
                    </div>
                    <p className='text-sm text-yellow-700 dark:text-yellow-400'>
                      此操作将重置用户封禁和管理员设置、自定义视频源，站点配置将重置为默认值，是否继续？
                    </p>
                  </div>
                </div>

                {/* 操作按钮 */}
                <div className='flex justify-end space-x-3'>
                  <button
                    onClick={() => setShowResetConfigModal(false)}
                    className={`px-6 py-2.5 text-sm font-medium ${buttonStyles.secondary}`}
                  >
                    取消
                  </button>
                  <button
                    onClick={handleConfirmResetConfig}
                    disabled={isLoading('resetConfig')}
                    className={`px-6 py-2.5 text-sm font-medium ${
                      isLoading('resetConfig')
                        ? buttonStyles.disabled
                        : buttonStyles.danger
                    }`}
                  >
                    {isLoading('resetConfig') ? '重置中...' : '确认重置'}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </PageLayout>
  );
}

export default function AdminPage() {
  return (
    <Suspense>
      <AdminPageClient />
    </Suspense>
  );
}
