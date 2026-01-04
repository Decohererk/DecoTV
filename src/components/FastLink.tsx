/* eslint-disable no-undef */

'use client';

/// <reference lib="dom" />

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AnchorHTMLAttributes,
  CSSProperties,
  forwardRef,
  MouseEvent,
  ReactNode,
  useCallback,
  useMemo,
  useTransition,
} from 'react';

/**
 * FastLink - 极简导航组件
 *
 * 核心设计：
 * - 消除移动端 300ms 触摸延迟（touch-action: manipulation）
 * - 使用 useTransition 实现非阻塞导航
 * - 配合 useCachedData 实现真正的 0ms 缓存优先加载
 *
 * 注意：不再手动触发 NProgress，缓存系统足够快
 */

interface FastLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  href: string;
  children: ReactNode;
  forceRefresh?: boolean;
  useTransitionNav?: boolean;
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  prefetch?: boolean;
}

const ZERO_LATENCY_STYLES: CSSProperties = {
  touchAction: 'manipulation',
  WebkitTapHighlightColor: 'transparent',
};

const FastLink = forwardRef<HTMLAnchorElement, FastLinkProps>(
  (
    {
      href,
      children,
      forceRefresh = false,
      useTransitionNav = false,
      prefetch = true,
      onClick,
      className,
      style,
      ...rest
    },
    ref,
  ) => {
    const router = useRouter();
    const [, startTransition] = useTransition();

    const mergedStyles = useMemo(
      () => ({ ...ZERO_LATENCY_STYLES, ...style }),
      [style],
    );

    const handleClick = useCallback(
      (e: MouseEvent<HTMLAnchorElement>) => {
        // 执行外部回调
        onClick?.(e);

        if (e.defaultPrevented) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        const isInternalLink =
          !href.startsWith('http://') && !href.startsWith('https://');
        if (!isInternalLink) return;

        if (forceRefresh) {
          e.preventDefault();
          window.location.assign(href);
        } else if (useTransitionNav) {
          e.preventDefault();
          startTransition(() => {
            router.push(href);
          });
        }
      },
      [href, forceRefresh, useTransitionNav, onClick, router, startTransition],
    );

    if (forceRefresh) {
      return (
        <a
          ref={ref}
          href={href}
          onClick={handleClick}
          className={className}
          style={mergedStyles}
          {...rest}
        >
          {children}
        </a>
      );
    }

    return (
      <Link
        ref={ref}
        href={href}
        prefetch={prefetch}
        onClick={handleClick}
        className={className}
        style={mergedStyles}
        {...rest}
      >
        {children}
      </Link>
    );
  },
);

FastLink.displayName = 'FastLink';

export default FastLink;
