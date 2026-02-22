'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { CURRENT_VERSION } from '@/lib/version';
import {
  checkForUpdates,
  UpdateStatus,
  VersionCheckResult,
} from '@/lib/version_check';

import { useSite } from '@/components/SiteProvider';
import { ThemeToggle } from '@/components/ThemeToggle';

// 状态指示器光点组件
function StatusIndicator({ status }: { status: UpdateStatus }) {
  // 根据状态返回不同颜色的光点
  const getIndicatorStyle = () => {
    switch (status) {
      case UpdateStatus.NO_UPDATE:
        // 绿色光点 - 最新版本
        return {
          bgColor: 'bg-emerald-500',
          glowColor: 'shadow-emerald-500/50',
          pulseColor: 'bg-emerald-400',
        };
      case UpdateStatus.HAS_UPDATE:
        // 橙色光点 - 有更新
        return {
          bgColor: 'bg-orange-500',
          glowColor: 'shadow-orange-500/50',
          pulseColor: 'bg-orange-400',
        };
      case UpdateStatus.FETCH_FAILED:
        // 红色光点 - 检测失败
        return {
          bgColor: 'bg-red-500',
          glowColor: 'shadow-red-500/50',
          pulseColor: 'bg-red-400',
        };
      case UpdateStatus.CHECKING:
      default:
        // 灰色光点 - 检测中
        return {
          bgColor: 'bg-gray-400',
          glowColor: 'shadow-gray-400/50',
          pulseColor: 'bg-gray-300',
        };
    }
  };

  const style = getIndicatorStyle();

  return (
    <span className='relative flex h-2.5 w-2.5'>
      {/* 脉冲动画 */}
      {status !== UpdateStatus.CHECKING && (
        <span
          className={`animate-ping absolute inline-flex h-full w-full rounded-full ${style.pulseColor} opacity-75`}
        />
      )}
      {/* 核心光点 */}
      <span
        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${style.bgColor} shadow-lg ${style.glowColor}`}
      />
    </span>
  );
}

// 版本显示组件
function VersionDisplay() {
  const [checkResult, setCheckResult] = useState<VersionCheckResult | null>(
    null,
  );
  const [status, setStatus] = useState<UpdateStatus>(UpdateStatus.CHECKING);

  useEffect(() => {
    const doCheck = async () => {
      try {
        const result = await checkForUpdates();
        setCheckResult(result);
        setStatus(result.status);
      } catch {
        setStatus(UpdateStatus.FETCH_FAILED);
      }
    };

    doCheck();
  }, []);

  // 获取状态文字
  const getStatusText = () => {
    switch (status) {
      case UpdateStatus.NO_UPDATE:
        return '当前为最新版本';
      case UpdateStatus.HAS_UPDATE:
        return '有新版本可用';
      case UpdateStatus.FETCH_FAILED:
        return '检测失败';
      case UpdateStatus.CHECKING:
      default:
        return '检测中...';
    }
  };

  // 获取状态文字颜色
  const getStatusTextColor = () => {
    switch (status) {
      case UpdateStatus.NO_UPDATE:
        return 'text-emerald-600 dark:text-emerald-400';
      case UpdateStatus.HAS_UPDATE:
        return 'text-orange-600 dark:text-orange-400';
      case UpdateStatus.FETCH_FAILED:
        return 'text-red-500 dark:text-red-400';
      default:
        return 'text-gray-500 dark:text-gray-400';
    }
  };

  return (
    <button
      onClick={() =>
        window.open(
          (process.env.NEXT_PUBLIC_REPO_URL as string) ||
            (process.env.NEXT_PUBLIC_UPDATE_REPO
              ? `https://github.com/${process.env.NEXT_PUBLIC_UPDATE_REPO}`
              : 'https://github.com/Decohererk/DecoTV'),
          '_blank',
        )
      }
      className='absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 transition-all duration-300 cursor-pointer hover:scale-105 group'
      title={
        checkResult?.formattedLocalTime
          ? `本地版本: ${checkResult.formattedLocalTime}${
              checkResult?.formattedRemoteTime
                ? `\n远程版本: ${checkResult.formattedRemoteTime}`
                : ''
            }`
          : '点击查看仓库'
      }
    >
      {/* 版本号带光点指示器 */}
      <span className='relative font-mono font-medium'>
        v{CURRENT_VERSION}
        {/* 右上角光点 */}
        <span className='absolute -top-1 -right-3'>
          <StatusIndicator status={status} />
        </span>
      </span>

      {/* 状态文字 */}
      <span
        className={`font-semibold text-xs ml-2 transition-colors ${getStatusTextColor()}`}
      >
        {getStatusText()}
      </span>
    </button>
  );
}

function LoginPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [shouldAskUsername, setShouldAskUsername] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);
  // 默认使用图片直链
  const [loginBackground, setLoginBackground] = useState<string>(
    'https://pan.yyds.nyc.mn/background.png',
  );

  const { siteName } = useSite();

  // 在客户端挂载后设置配置
  useEffect(() => {
    // 从服务端获取配置
    fetch('/api/server-config')
      .then((res) => res.json())
      .then((data) => {
        const storageType = data.StorageType;
        setShouldAskUsername(!!storageType && storageType !== 'localstorage');
        setRegistrationEnabled(
          data.EnableRegistration && storageType !== 'localstorage',
        );
        // 设置登录背景图（如果服务器返回空，则使用默认值）
        setLoginBackground(
          data.LoginBackground || 'https://pan.yyds.nyc.mn/background.png',
        );
      })
      .catch(() => {
        // 失败时使用默认值
        setShouldAskUsername(false);
        setRegistrationEnabled(false);
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (!password || (shouldAskUsername && !username)) return;

    try {
      setLoading(true);
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          password,
          ...(shouldAskUsername ? { username } : {}),
        }),
      });

      if (res.ok) {
        const redirect = searchParams.get('redirect') || '/';
        router.replace(redirect);
      } else if (res.status === 401) {
        setError('密码错误');
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? '服务器错误');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className='relative min-h-screen flex items-center justify-center px-4 overflow-hidden login-bg'>
      {/* 自定义背景图 */}
      {loginBackground && (
        <>
          {/* 隐藏的 img 标签用于预加载和检测加载失败 */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={loginBackground}
            alt=''
            className='hidden'
            onError={() => setLoginBackground('')}
          />
          <div
            className='absolute inset-0 z-0'
            style={{
              backgroundImage: `url(${loginBackground})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          >
            {/* 背景遮罩层，提升文字可读性 */}
            <div className='absolute inset-0 bg-black/40 dark:bg-black/60' />
          </div>
        </>
      )}

      {/* Animated background gradient - 仅在没有自定义背景时显示 */}
      {!loginBackground && (
        <>
          <div className='absolute inset-0 bg-linear-to-br from-purple-900/20 via-blue-900/20 to-pink-900/20 dark:from-purple-900/40 dark:via-blue-900/40 dark:to-pink-900/40 animate-gradient-shift'></div>

          {/* Floating orbs */}
          <div className='absolute top-1/4 left-1/4 w-32 h-32 bg-purple-500/30 rounded-full blur-xl animate-float-slow'></div>
          <div className='absolute top-3/4 right-1/4 w-24 h-24 bg-blue-500/30 rounded-full blur-xl animate-float-slower'></div>
          <div className='absolute bottom-1/4 left-1/3 w-20 h-20 bg-pink-500/30 rounded-full blur-xl animate-float'></div>
        </>
      )}

      <div className='absolute top-4 right-4 z-20'>
        <ThemeToggle />
      </div>

      <div className='relative z-10 w-full max-w-md rounded-3xl bg-linear-to-b from-white/90 via-white/70 to-white/40 dark:from-zinc-900/90 dark:via-zinc-900/70 dark:to-zinc-900/40 backdrop-blur-xl shadow-2xl p-10 dark:border dark:border-zinc-800 login-card'>
        <h1 className='tracking-tight text-center text-4xl font-extrabold mb-8 bg-clip-text neon-text neon-flicker'>
          {siteName}
        </h1>
        <form onSubmit={handleSubmit} className='space-y-8'>
          {shouldAskUsername && (
            <div>
              <label htmlFor='username' className='sr-only'>
                用户名
              </label>
              <input
                id='username'
                type='text'
                autoComplete='username'
                className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-purple-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur transition-all duration-300 hover:ring-purple-400 focus:shadow-lg focus:shadow-purple-500/25 login-input'
                placeholder='输入用户名'
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          )}

          <div>
            <label htmlFor='password' className='sr-only'>
              密码
            </label>
            <input
              id='password'
              type='password'
              autoComplete='current-password'
              className='block w-full rounded-lg border-0 py-3 px-4 text-gray-900 dark:text-gray-100 shadow-sm ring-1 ring-white/60 dark:ring-white/20 placeholder:text-gray-500 dark:placeholder:text-gray-400 focus:ring-2 focus:ring-purple-500 focus:outline-none sm:text-base bg-white/60 dark:bg-zinc-800/60 backdrop-blur transition-all duration-300 hover:ring-purple-400 focus:shadow-lg focus:shadow-purple-500/25 login-input'
              placeholder='输入访问密码'
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className='text-sm text-red-600 dark:text-red-400'>{error}</p>
          )}

          {/* 登录按钮 */}
          <button
            type='submit'
            disabled={!password || loading || (shouldAskUsername && !username)}
            className='inline-flex w-full justify-center rounded-lg bg-linear-to-r from-purple-600 via-fuchsia-600 to-pink-600 py-3 text-base font-semibold text-white shadow-lg transition-all duration-300 hover:brightness-110 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-50 neon-pulse login-button'
          >
            {loading ? '登录中...' : '登录'}
          </button>

          {/* 注册链接 */}
          {registrationEnabled && (
            <div className='text-center'>
              <Link
                href='/register'
                className='text-sm text-purple-600 dark:text-purple-400 hover:text-purple-700 dark:hover:text-purple-300 transition-colors'
              >
                没有账号？立即注册
              </Link>
            </div>
          )}
        </form>
      </div>

      {/* 版本信息显示 */}
      <VersionDisplay />
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <LoginPageClient />
    </Suspense>
  );
}
