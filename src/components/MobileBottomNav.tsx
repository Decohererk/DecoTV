/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  Cat,
  Cloud,
  Clover,
  Film,
  Home,
  Radio,
  Search,
  Star,
  Tv,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ComponentType, useCallback, useEffect, useRef, useState } from 'react';

import SourceBrowserIcon from './icons/SourceBrowserIcon';

// 简单的 className 合并函数
function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

interface NavItem {
  icon: ComponentType<{ className?: string }>;
  label: string;
  href: string;
  // 选中状态的渐变色配置
  activeGradient: string;
  // 选中状态的文字/图标颜色
  activeTextColor: string;
  // 悬浮状态的背景色
  hoverBg: string;
}

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
}

/**
 * 移动端底部导航栏 - 悬浮胶囊风格
 * 与 PC 端顶部导航保持一致的设计语言
 */
const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);

  // 当前激活路径：优先使用传入的 activePath，否则回退到浏览器地址
  const currentActive = activePath ?? pathname;

  // 导航项配置 - 包含渐变色映射
  const [navItems, setNavItems] = useState<NavItem[]>([
    {
      icon: Home,
      label: '首页',
      href: '/',
      activeGradient: 'bg-linear-to-r from-violet-500 to-purple-600',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-violet-500/20',
    },
    {
      icon: Search,
      label: '搜索',
      href: '/search',
      activeGradient: 'bg-linear-to-r from-blue-500 to-cyan-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-blue-500/20',
    },
    {
      icon: SourceBrowserIcon,
      label: '源浏览器',
      href: '/source-browser',
      activeGradient: 'bg-linear-to-r from-emerald-500 to-teal-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-emerald-500/20',
    },
    {
      icon: Cloud,
      label: '网盘',
      href: '/netdisk',
      activeGradient: 'bg-linear-to-r from-sky-500 to-teal-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-sky-500/20',
    },
    {
      icon: Film,
      label: '电影',
      href: '/douban?type=movie',
      activeGradient: 'bg-linear-to-r from-pink-500 to-rose-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-pink-500/20',
    },
    {
      icon: Tv,
      label: '剧集',
      href: '/douban?type=tv',
      activeGradient: 'bg-linear-to-r from-purple-500 to-indigo-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-purple-500/20',
    },
    {
      icon: Cat,
      label: '动漫',
      href: '/douban?type=anime',
      activeGradient: 'bg-linear-to-r from-emerald-400 to-teal-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-emerald-500/20',
    },
    {
      icon: Clover,
      label: '综艺',
      href: '/douban?type=show',
      activeGradient: 'bg-linear-to-r from-amber-400 to-orange-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-amber-500/20',
    },
    {
      icon: Radio,
      label: '直播',
      href: '/live',
      activeGradient: 'bg-linear-to-r from-red-500 to-pink-500',
      activeTextColor: 'text-white',
      hoverBg: 'hover:bg-red-500/20',
    },
  ]);

  // 动态添加自定义分类
  useEffect(() => {
    const runtimeConfig = (window as any).RUNTIME_CONFIG;
    if (runtimeConfig?.CUSTOM_CATEGORIES?.length > 0) {
      setNavItems((prevItems) => {
        // 防止重复添加
        if (prevItems.some((item) => item.label === '自定义')) return prevItems;
        return [
          ...prevItems,
          {
            icon: Star,
            label: '自定义',
            href: '/douban?type=custom',
            activeGradient: 'bg-linear-to-r from-yellow-400 to-amber-500',
            activeTextColor: 'text-white',
            hoverBg: 'hover:bg-yellow-500/20',
          },
        ];
      });
    }
  }, []);

  // 判断是否激活
  const isActive = useCallback(
    (href: string) => {
      const typeMatch = href.match(/type=([^&]+)/)?.[1];
      const decodedActive = decodeURIComponent(currentActive);
      const decodedItemHref = decodeURIComponent(href);

      // 精确匹配
      if (decodedActive === decodedItemHref) return true;

      // 首页特殊处理
      if (href === '/' && decodedActive === '/') return true;

      // 搜索页特殊处理
      if (href === '/search' && decodedActive.startsWith('/search'))
        return true;

      // 网盘页特殊处理
      if (href === '/netdisk' && decodedActive.startsWith('/netdisk'))
        return true;

      // 直播页特殊处理
      if (href === '/live' && decodedActive.startsWith('/live')) return true;

      // 豆瓣分类匹配
      if (
        typeMatch &&
        decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`)
      ) {
        return true;
      }

      return false;
    },
    [currentActive],
  );

  // 滚动到激活项
  const scrollToActiveItem = useCallback(() => {
    const activeIndex = navItems.findIndex((item) => isActive(item.href));
    if (activeIndex === -1) return;

    const activeItem = itemRefs.current[activeIndex];
    if (activeItem) {
      activeItem.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [navItems, isActive]);

  // 路径变化时滚动到激活项
  useEffect(() => {
    const timer = setTimeout(scrollToActiveItem, 100);
    return () => clearTimeout(timer);
  }, [currentActive, scrollToActiveItem]);

  return (
    <nav
      className={cn(
        'md:hidden fixed z-600',
        // 悬浮居中定位
        'left-1/2 -translate-x-1/2',
        // 尺寸限制
        'w-auto max-w-[92vw]',
        // 外观样式 - 磨砂玻璃胶囊 (亮色/暗色自适应)
        'rounded-full',
        'bg-white/92 dark:bg-black/90',
        'backdrop-blur-[6px]',
        'border border-black/5 dark:border-white/10',
        'shadow-lg shadow-black/8 dark:shadow-xl dark:shadow-black/35',
      )}
      style={{
        // 距离底部安全区
        bottom: 'calc(1rem + env(safe-area-inset-bottom))',
      }}
    >
      {/* 横向滚动容器 */}
      <div
        ref={scrollContainerRef}
        className={cn(
          'flex items-center gap-1 px-2 py-2',
          'overflow-x-auto',
          'scroll-smooth',
        )}
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* 隐藏 Webkit 滚动条 */}
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>

        {navItems.map((item, index) => {
          const active = isActive(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              ref={(el) => {
                itemRefs.current[index] = el;
              }}
              className={cn(
                // 基础样式
                'shrink-0 inline-flex items-center gap-1.5',
                'rounded-full px-3.5 py-2',
                'text-sm font-medium',
                'transition-all duration-300 ease-out',
                'focus:outline-none focus:ring-2 focus:ring-white/30',
                // 点击反馈
                'active:scale-95',
                // 激活状态 (扁平化传入，不使用数组)
                active && item.activeGradient,
                active && item.activeTextColor,
                active && 'shadow-lg',
                active && 'scale-105',
                // 非激活状态 (亮色/暗色自适应)
                !active && 'text-gray-600 dark:text-gray-400',
                !active && item.hoverBg,
                !active && 'hover:text-gray-900 dark:hover:text-white',
              )}
            >
              <Icon
                className={cn(
                  'w-4 h-4 shrink-0',
                  'transition-transform duration-300',
                  active && 'drop-shadow-sm',
                )}
              />
              <span className='whitespace-nowrap'>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default MobileBottomNav;
