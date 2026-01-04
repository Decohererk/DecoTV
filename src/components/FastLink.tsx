/* eslint-disable no-undef */

'use client';

/// <reference lib="dom" />

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import NProgress from 'nprogress';
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
 * FastLink - 零延迟乐观导航组件 (Optimistic Navigation)
 *
 * 核心设计理念：
 * - "Zero Latency" (零延迟)：点击瞬间 (0ms) UI 必须响应，不等待路由或数据
 * - 进度条立即启动：用户感知到"正在切换"，消除点击无反应的焦虑
 * - 消除移动端 300ms 延迟：使用 touch-action: manipulation
 *
 * 性能优化策略：
 * 1. NProgress.start() 同步调用 - 在 onClick 第一行执行，不进入任何异步队列
 * 2. touch-action: manipulation - 禁用浏览器双击缩放检测，消除触摸延迟
 * 3. useTransition 非阻塞导航 - 路由切换不阻塞 UI，用户可继续交互
 * 4. will-change: transform - 提示 GPU 预创建合成层，hover 动画更流畅
 *
 * 使用场景：
 * - 导航栏、底部栏等核心路由（推荐 useTransitionNav=true）
 * - VideoCard 等列表项的跳转链接
 * - 任何需要"毫秒级响应"的用户交互
 */

interface FastLinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  'href'
> {
  /** 目标路径 */
  href: string;
  /** 子元素 */
  children: ReactNode;
  /**
   * 强制刷新模式
   * - true: 使用 window.location 硬跳转（最快，但会丢失 SPA 状态）
   * - false (默认): 使用 next/link SPA 导航
   */
  forceRefresh?: boolean;
  /**
   * 使用 React Transition 包裹导航
   * - 将导航标记为低优先级，不阻塞当前 UI 交互
   * - 适合在保持 SPA 特性的同时提升响应感
   */
  useTransitionNav?: boolean;
  /** 额外的点击处理（优先于内部逻辑执行） */
  onClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /**
   * 是否显示进度条
   * - true (默认): 点击时立即启动顶部进度条
   * - false: 不触发进度条（适用于模态框内链接等场景）
   */
  showProgress?: boolean;
}

/**
 * 零延迟样式配置
 * 这些样式确保触摸设备上的点击没有任何延迟
 */
const ZERO_LATENCY_STYLES: CSSProperties = {
  // 消除移动端 300ms 触摸延迟：
  // - 告诉浏览器此元素不需要双击缩放检测
  // - 浏览器无需等待判断是否为双击，立即触发 click
  touchAction: 'manipulation',

  // GPU 加速提示：
  // - 浏览器预先创建合成层，hover 等动画更流畅
  // - 避免动画时触发主线程重排
  willChange: 'transform',

  // 消除触摸高亮：
  // - 移除 iOS/Android 默认的点击高亮色块
  // - 自定义的 hover 效果可以替代它
  WebkitTapHighlightColor: 'transparent',
};

const FastLink = forwardRef<HTMLAnchorElement, FastLinkProps>(
  (
    {
      href,
      children,
      forceRefresh = false,
      useTransitionNav = false,
      showProgress = true,
      onClick,
      className,
      style,
      ...rest
    },
    ref,
  ) => {
    const router = useRouter();
    const [, startTransition] = useTransition();

    /**
     * 合并样式：将零延迟样式与用户自定义样式合并
     * 使用 useMemo 避免每次渲染创建新对象
     */
    const mergedStyles = useMemo(
      () => ({ ...ZERO_LATENCY_STYLES, ...style }),
      [style],
    );

    /**
     * 核心点击处理器 - 零延迟设计
     *
     * 执行顺序至关重要：
     * 1. [0ms] NProgress.start() - 进度条立即可见
     * 2. [0ms] onClick?.() - 外部回调（如 setActiveTab）
     * 3. [1-2ms] router.push() - 异步非阻塞导航
     *
     * 为什么这样能实现"毫秒级响应"？
     * - NProgress.start() 是同步 DOM 操作，立即生效
     * - startTransition 将路由更新标记为低优先级
     * - 用户看到进度条 ≈ 点击成功，心理延迟为 0
     */
    const handleClick = useCallback(
      (e: MouseEvent<HTMLAnchorElement>) => {
        // ========== 第一阶段：即时视觉反馈 (0ms) ==========
        // 检查是否为内部导航（外部链接不启动进度条）
        const isInternalLink =
          !href.startsWith('http://') && !href.startsWith('https://');

        if (isInternalLink && showProgress) {
          // 【关键】同步调用进度条启动
          // - 这是 onClick 的第一行有效代码
          // - 进度条动画由 CSS 驱动，不阻塞 JS
          // - 用户在 16ms 内（下一帧）就能看到进度条
          NProgress.start();
        }

        // ========== 第二阶段：外部回调 (0-1ms) ==========
        // 执行父组件的 onClick（如 TopNavbar 的 setActiveTab）
        // 这允许实现"乐观 UI"：点击即变色
        onClick?.(e);

        // 如果外部已阻止默认行为，直接返回
        if (e.defaultPrevented) return;

        // 检查是否按住修饰键（Cmd/Ctrl + 点击应该在新标签打开）
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

        // 外部链接直接走浏览器默认行为
        if (!isInternalLink) return;

        // ========== 第三阶段：非阻塞导航 (异步) ==========
        if (forceRefresh) {
          // 强制刷新模式：阻止 SPA 导航，使用浏览器硬跳转
          e.preventDefault();
          window.location.assign(href);
        } else if (useTransitionNav) {
          // 【推荐】Transition 模式：
          // - 导航被标记为"可中断的低优先级更新"
          // - 不会阻塞当前帧的渲染（进度条动画流畅）
          // - 用户可以在导航过程中继续点击其他元素
          e.preventDefault();
          startTransition(() => {
            router.push(href);
          });
        }
        // 默认情况：让 next/link 处理
      },
      [
        href,
        forceRefresh,
        useTransitionNav,
        showProgress,
        onClick,
        router,
        startTransition,
      ],
    );

    // 强制刷新模式使用原生 <a> 标签
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

    // 默认使用 next/link，禁用 prefetch 避免资源抢占
    return (
      <Link
        ref={ref}
        href={href}
        prefetch={false}
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
