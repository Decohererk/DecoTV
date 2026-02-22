/**
 * TopNavbar - PC 端顶部导航栏 (乐观 UI 版)
 *
 * 核心设计理念：Optimistic Navigation (乐观导航)
 * - 点击瞬间 (0ms) Tab 立即高亮，不等待路由切换完成
 * - 进度条同步启动，用户感知到"正在切换"
 * - 后台异步加载数据，UI 已经响应完毕
 *
 * 性能优化策略：
 * 1. useState 本地状态：activeTabKey 由点击事件直接更新，无需等待 URL 变化
 * 2. FastLink + NProgress：进度条在 onClick 第一行同步启动
 * 3. useEffect 同步：监听 searchParams 作为后备，防止浏览器后退按钮状态不一致
 * 4. React.memo：防止父组件重绘导致不必要的渲染
 * 5. CSS contain: layout paint：渲染隔离，防止背景层变化触发重排
 */

/* eslint-disable no-undef */

'use client';

/// <reference lib="dom" />

import {
  Cat,
  Cloud,
  Clover,
  Film,
  Home,
  Radio,
  Search,
  Tv,
} from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  memo,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import FastLink from './FastLink';
import SourceBrowserIcon from './icons/SourceBrowserIcon';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

/**
 * 导航项配置
 * - key: 唯一标识符，用于 activeTabKey 状态匹配
 * - 使用静态配置避免每次渲染重建数组
 */
const NAV_ITEMS = [
  {
    key: 'home',
    href: '/',
    icon: Home,
    label: '首页',
    chip: 'chip-home',
    type: 'exact',
    openInNewTab: false, // 首页不需要新标签页
  },
  {
    key: 'search',
    href: '/search',
    icon: Search,
    label: '搜索',
    chip: 'chip-search',
    type: 'exact',
    openInNewTab: false, // 搜索不需要新标签页
  },
  {
    key: 'source-browser',
    href: '/source-browser',
    icon: SourceBrowserIcon,
    label: '源浏览器',
    chip: 'chip-source-browser',
    type: 'exact',
    openInNewTab: false,
  },
  {
    key: 'netdisk',
    href: '/netdisk',
    icon: Cloud,
    label: '网盘',
    chip: 'chip-netdisk',
    type: 'exact',
    openInNewTab: false,
  },
  {
    key: 'movie',
    href: '/douban?type=movie',
    icon: Film,
    label: '电影',
    chip: 'chip-movie',
    type: 'douban',
    doubanType: 'movie',
    openInNewTab: false,
  },
  {
    key: 'tv',
    href: '/douban?type=tv',
    icon: Tv,
    label: '剧集',
    chip: 'chip-tv',
    type: 'douban',
    doubanType: 'tv',
    openInNewTab: false,
  },
  {
    key: 'anime',
    href: '/douban?type=anime',
    icon: Cat,
    label: '动漫',
    chip: 'chip-anime',
    type: 'douban',
    doubanType: 'anime',
    openInNewTab: false,
  },
  {
    key: 'show',
    href: '/douban?type=show',
    icon: Clover,
    label: '综艺',
    chip: 'chip-show',
    type: 'douban',
    doubanType: 'show',
    openInNewTab: false,
  },
  {
    key: 'live',
    href: '/live',
    icon: Radio,
    label: '直播',
    chip: 'chip-live',
    type: 'exact',
    openInNewTab: false,
  },
] as const;

/**
 * 根据 pathname 和 searchParams 计算当前应该高亮的 Tab key
 * 用于初始化状态和浏览器后退时的同步
 */
function computeActiveKey(pathname: string, type: string | null): string {
  // 优先检查 douban 类型页面
  if (pathname.startsWith('/douban') && type) {
    return type; // 'movie' | 'tv' | 'anime' | 'show'
  }

  // 精确路径匹配
  switch (pathname) {
    case '/':
      return 'home';
    case '/search':
      return 'search';
    case '/netdisk':
      return 'netdisk';
    case '/source-browser':
      return 'source-browser';
    case '/live':
      return 'live';
    default:
      // 未匹配到任何导航项，返回空字符串（不高亮任何 Tab）
      return '';
  }
}

function TopNavbar() {
  const { siteName } = useSite();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 缓存当前 type 参数
  const currentType = useMemo(() => searchParams.get('type'), [searchParams]);

  /**
   * 【核心】本地激活状态 - 实现乐观 UI
   *
   * 为什么需要本地状态？
   * - 依赖 URL (useSearchParams) 判断高亮需要等待路由切换完成
   * - 路由切换可能需要 100-500ms（数据加载）
   * - 用户点击后 300ms+ 才看到 Tab 变色，感觉"卡顿"
   *
   * 本地状态方案：
   * - 点击时立即 setActiveTabKey(newKey)
   * - Tab 变色时间 < 16ms（一帧内完成）
   * - 用户感知延迟接近 0ms
   */
  const [activeTabKey, setActiveTabKey] = useState(() =>
    computeActiveKey(pathname, currentType),
  );

  /**
   * 后备同步机制
   *
   * 场景：用户点击浏览器后退/前进按钮
   * - 此时 URL 变化了，但 onClick 未触发
   * - 需要根据新的 URL 同步 activeTabKey
   *
   * 为什么不直接用 URL 作为真相源？
   * - URL 更新是异步的（需要等待 history.pushState）
   * - 本地状态更新是同步的（React setState）
   * - 先用本地状态实现"即时反馈"，再用 URL 作为"最终校正"
   */
  useEffect(() => {
    const newKey = computeActiveKey(pathname, currentType);
    // 仅当 URL 导致的 key 变化时才同步（避免覆盖乐观更新）
    setActiveTabKey(newKey);
  }, [pathname, currentType]);

  /**
   * 创建点击处理器
   *
   * 为什么用 useCallback + itemKey 参数？
   * - 每个 Tab 需要独立的点击处理器
   * - 使用闭包捕获 itemKey，避免内联函数导致的重渲染
   */
  const handleTabClick = useCallback((itemKey: string) => {
    return (_e: MouseEvent<HTMLAnchorElement>) => {
      // 【关键】立即更新本地状态
      // - 这是 onClick 的第一个副作用
      // - React 会在当前微任务中批处理状态更新
      // - Tab 变色在下一帧（16ms 内）渲染完成
      setActiveTabKey(itemKey);

      // 注意：NProgress.start() 已在 FastLink 内部处理
      // 不需要在这里重复调用
    };
  }, []);

  return (
    <header
      className='hidden md:block fixed top-0 left-0 right-0 z-900'
      style={{
        // CSS 渲染隔离：防止背景层变化触发导航栏重排
        contain: 'layout paint',
      }}
    >
      <div className='mx-auto max-w-7xl px-4'>
        {/* PC 端保留 backdrop-blur 磨砂玻璃效果 */}
        <div className='mt-2 rounded-2xl border border-white/10 bg-white/85 dark:bg-gray-900/85 md:bg-white/45 md:dark:bg-gray-900/55 shadow-[0_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-12px_rgba(15,23,42,0.45)] backdrop-blur-none md:backdrop-blur-sm'>
          <nav className='flex items-center justify-between h-14 px-3'>
            {/* Left: Logo */}
            <div className='flex items-center gap-2 min-w-0'>
              {/* 
                禁用 Next.js 原生 prefetch - 使用 UnifiedCache 系统替代
                原因：我们现在有更高级的多级缓存策略，不需要框架层面的预加载
                参考：LunaTV 竞品分析 - Cache-First 架构
              */}
              <FastLink
                href='/'
                prefetch={false}
                useTransitionNav
                onClick={handleTabClick('home')}
                className='shrink-0 select-none hover:opacity-90 transition-opacity'
              >
                <span className='text-xl font-black tracking-tight deco-brand'>
                  {siteName || 'DecoTV'}
                </span>
              </FastLink>
            </div>

            {/* Center: Navigation Items */}
            <div className='flex items-center justify-center gap-2 flex-wrap'>
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const openInNewTab = item.openInNewTab;

                // 【关键】使用本地状态判断激活，而非 URL
                // 这是"乐观 UI"的核心：点击即变色，不等 URL
                const active = activeTabKey === item.key;
                const activeRingClass =
                  item.key === 'source-browser'
                    ? 'ring-2 ring-emerald-400/70'
                    : 'ring-2 ring-purple-400/60';

                return (
                  <FastLink
                    key={item.key}
                    href={item.href}
                    prefetch={false}
                    useTransitionNav={!openInNewTab}
                    onClick={
                      openInNewTab ? undefined : handleTabClick(item.key)
                    }
                    target={openInNewTab ? '_blank' : undefined}
                    rel={openInNewTab ? 'noopener noreferrer' : undefined}
                    className={`inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm hover:opacity-90 transition-all glass-chip chip-glow chip-theme ${item.chip} ${
                      active ? activeRingClass : ''
                    }`}
                  >
                    <Icon className='h-4 w-4' />
                    <span>{item.label}</span>
                  </FastLink>
                );
              })}
            </div>

            {/* Right: Theme + User */}
            <div className='flex items-center gap-2'>
              <ThemeToggle />
              <UserMenu />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}

// React.memo: 防止父组件重绘导致不必要的渲染
export default memo(TopNavbar);
