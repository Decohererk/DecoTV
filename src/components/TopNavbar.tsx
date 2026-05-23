/* eslint-disable no-undef */

'use client';

/// <reference lib="dom" />

import {
  Cat,
  Cloud,
  Clover,
  Film,
  Home,
  Library,
  Radio,
  Search,
  Tv,
} from 'lucide-react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  ComponentType,
  memo,
  MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import FastLink from './FastLink';
import SourceBrowserIcon from './icons/SourceBrowserIcon';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface NavItem {
  key: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
  chip: string;
  type: 'exact' | 'douban';
  doubanType?: string;
  openInNewTab: boolean;
}

const BASE_NAV_ITEMS: NavItem[] = [
  {
    key: 'home',
    href: '/',
    icon: Home,
    label: '\u9996\u9875',
    chip: 'chip-home',
    type: 'exact',
    openInNewTab: false,
  },
  {
    key: 'search',
    href: '/search',
    icon: Search,
    label: '\u641c\u7d22',
    chip: 'chip-search',
    type: 'exact',
    openInNewTab: false,
  },
  {
    key: 'source-browser',
    href: '/source-browser',
    icon: SourceBrowserIcon,
    label: '\u6e90\u6d4f\u89c8\u5668',
    chip: 'chip-source-browser',
    type: 'exact',
    openInNewTab: false,
  },
  {
    key: 'netdisk',
    href: '/netdisk',
    icon: Cloud,
    label: '\u7f51\u76d8',
    chip: 'chip-netdisk',
    type: 'exact',
    openInNewTab: false,
  },
  {
    key: 'movie',
    href: '/douban?type=movie',
    icon: Film,
    label: '\u7535\u5f71',
    chip: 'chip-movie',
    type: 'douban',
    doubanType: 'movie',
    openInNewTab: false,
  },
  {
    key: 'tv',
    href: '/douban?type=tv',
    icon: Tv,
    label: '\u5267\u96c6',
    chip: 'chip-tv',
    type: 'douban',
    doubanType: 'tv',
    openInNewTab: false,
  },
  {
    key: 'anime',
    href: '/douban?type=anime',
    icon: Cat,
    label: '\u52a8\u6f2b',
    chip: 'chip-anime',
    type: 'douban',
    doubanType: 'anime',
    openInNewTab: false,
  },
  {
    key: 'show',
    href: '/douban?type=show',
    icon: Clover,
    label: '\u7efc\u827a',
    chip: 'chip-show',
    type: 'douban',
    doubanType: 'show',
    openInNewTab: false,
  },
  {
    key: 'live',
    href: '/live',
    icon: Radio,
    label: '\u76f4\u64ad',
    chip: 'chip-live',
    type: 'exact',
    openInNewTab: false,
  },
];

function computeActiveKey(pathname: string, type: string | null): string {
  if (pathname.startsWith('/douban') && type) {
    return type;
  }

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
    case '/my-library':
      return 'my-library';
    default:
      return '';
  }
}

function TopNavbar() {
  const { siteName } = useSite();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const currentType = useMemo(() => searchParams.get('type'), [searchParams]);
  const navScrollRef = useRef<HTMLDivElement>(null);
  const navItemRefs = useRef<Record<string, HTMLAnchorElement | null>>({});
  const didInitialAlignRef = useRef(false);

  const [activeTabKey, setActiveTabKey] = useState(() =>
    computeActiveKey(pathname, currentType),
  );
  const [navItems, setNavItems] = useState<NavItem[]>([...BASE_NAV_ITEMS]);
  const [isNavOverflowing, setIsNavOverflowing] = useState(false);
  const [showLeftMask, setShowLeftMask] = useState(false);
  const [showRightMask, setShowRightMask] = useState(false);

  useEffect(() => {
    const runtimeConfig = window.RUNTIME_CONFIG;
    if (!runtimeConfig?.PRIVATE_LIBRARY_ENABLED) return;

    setNavItems((prev) => {
      if (prev.some((item) => item.key === 'my-library')) {
        return prev;
      }

      return [
        ...prev,
        {
          key: 'my-library',
          href: '/my-library',
          icon: Library,
          label: '我的影库',
          chip: 'chip-netdisk',
          type: 'exact',
          openInNewTab: false,
        },
      ] as NavItem[];
    });
  }, []);

  useEffect(() => {
    const newKey = computeActiveKey(pathname, currentType);
    setActiveTabKey(newKey);
  }, [pathname, currentType]);

  const updateScrollMask = useCallback(() => {
    const container = navScrollRef.current;
    if (!container) {
      setIsNavOverflowing(false);
      setShowLeftMask(false);
      setShowRightMask(false);
      return;
    }

    const maxScrollLeft = Math.max(
      0,
      container.scrollWidth - container.clientWidth,
    );
    const nextOverflowing = maxScrollLeft > 2;

    const nextLeft = container.scrollLeft > 2;
    const nextRight = maxScrollLeft - container.scrollLeft > 2;

    setIsNavOverflowing((prev) =>
      prev === nextOverflowing ? prev : nextOverflowing,
    );
    setShowLeftMask((prev) => (prev === nextLeft ? prev : nextLeft));
    setShowRightMask((prev) => (prev === nextRight ? prev : nextRight));
  }, []);

  const alignActiveTab = useCallback(
    (behavior: ScrollBehavior) => {
      if (!activeTabKey) return;

      const container = navScrollRef.current;
      const target = navItemRefs.current[activeTabKey];
      if (!container || !target) return;

      const targetCenter = target.offsetLeft + target.offsetWidth / 2;
      const nextLeft = targetCenter - container.clientWidth / 2;
      const maxScrollLeft = Math.max(
        0,
        container.scrollWidth - container.clientWidth,
      );
      const clampedLeft = Math.min(Math.max(nextLeft, 0), maxScrollLeft);

      container.scrollTo({
        left: clampedLeft,
        behavior,
      });
    },
    [activeTabKey],
  );

  useEffect(() => {
    const container = navScrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      updateScrollMask();
    };

    const handleResize = () => {
      updateScrollMask();
      alignActiveTab('auto');
    };

    handleResize();
    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleResize);

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);
    };
  }, [alignActiveTab, updateScrollMask]);

  useEffect(() => {
    const behavior: ScrollBehavior = didInitialAlignRef.current
      ? 'smooth'
      : 'auto';
    didInitialAlignRef.current = true;

    const frame = window.requestAnimationFrame(() => {
      alignActiveTab(behavior);
      updateScrollMask();
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [activeTabKey, alignActiveTab, updateScrollMask]);

  const handleTabClick = useCallback((itemKey: string) => {
    return (_e: MouseEvent<HTMLAnchorElement>) => {
      setActiveTabKey(itemKey);
    };
  }, []);

  return (
    <header
      className='hidden md:block fixed top-0 left-0 right-0 z-900'
      style={{
        contain: 'layout paint',
      }}
    >
      <div className='mx-auto max-w-7xl px-4'>
        <div className='mt-2 rounded-2xl border border-white/10 bg-white/85 dark:bg-gray-900/85 md:bg-white/45 md:dark:bg-gray-900/55 shadow-[0_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-12px_rgba(15,23,42,0.45)] backdrop-blur-none md:backdrop-blur-sm'>
          <nav className='flex h-14 items-center gap-2 px-3 lg:gap-3'>
            <div className='flex shrink-0 items-center gap-2 min-w-0'>
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

            <div className='relative min-w-0 flex-1'>
              <div
                className={`pointer-events-none absolute inset-y-0 left-0 z-10 w-6 rounded-l-2xl bg-linear-to-r from-white/95 to-transparent dark:from-gray-900/95 transition-opacity duration-200 ${
                  showLeftMask ? 'opacity-100' : 'opacity-0'
                }`}
              />
              <div
                className={`pointer-events-none absolute inset-y-0 right-0 z-10 w-6 rounded-r-2xl bg-linear-to-l from-white/95 to-transparent dark:from-gray-900/95 transition-opacity duration-200 ${
                  showRightMask ? 'opacity-100' : 'opacity-0'
                }`}
              />

              <div
                ref={navScrollRef}
                className={`flex items-center gap-2 overflow-x-auto px-2 py-0.5 scroll-smooth whitespace-nowrap [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${
                  isNavOverflowing ? 'justify-start' : 'justify-center'
                }`}
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const openInNewTab = item.openInNewTab;
                  const active = activeTabKey === item.key;
                  const activeRingClass =
                    item.key === 'source-browser'
                      ? 'ring-2 ring-emerald-400/70'
                      : 'ring-2 ring-purple-400/60';

                  return (
                    <FastLink
                      key={item.key}
                      ref={(element) => {
                        navItemRefs.current[item.key] = element;
                      }}
                      href={item.href}
                      prefetch={false}
                      useTransitionNav={!openInNewTab}
                      onClick={
                        openInNewTab ? undefined : handleTabClick(item.key)
                      }
                      target={openInNewTab ? '_blank' : undefined}
                      rel={openInNewTab ? 'noopener noreferrer' : undefined}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] lg:gap-2 lg:px-4 lg:text-sm hover:opacity-90 transition-all glass-chip chip-glow chip-theme ${item.chip} ${
                        active ? activeRingClass : ''
                      }`}
                    >
                      <Icon className='h-4 w-4' />
                      <span>{item.label}</span>
                    </FastLink>
                  );
                })}
              </div>
            </div>

            <div className='flex shrink-0 items-center gap-2'>
              <ThemeToggle />
              <UserMenu />
            </div>
          </nav>
        </div>
      </div>
    </header>
  );
}

export default memo(TopNavbar);
