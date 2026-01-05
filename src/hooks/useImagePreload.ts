/**
 * useImagePreload - 图片预加载 Hook
 *
 * 功能：
 * - 预加载即将进入视口的图片
 * - 使用 <link rel="preload"> 提高加载优先级
 * - 增量添加预加载链接，不清理已存在的链接
 * - 避免 "preloaded but not used" 警告
 *
 * 参考 LunaTV 的智能图片加载策略
 */

/* eslint-disable no-undef */

'use client';

/// <reference lib="dom" />

import { useEffect, useRef } from 'react';

// 默认预加载数量
const DEFAULT_PRELOAD_COUNT = 12;

// 全局已预加载的 URL 集合（避免重复预加载）
const preloadedUrls = new Set<string>();

/**
 * 预加载图片 URL 列表
 *
 * @param urls 图片 URL 数组
 * @param count 预加载数量，默认 12
 *
 * @example
 * ```tsx
 * const imageUrls = items.map(item => item.poster);
 * useImagePreload(imageUrls, 10);
 * ```
 */
export function useImagePreload(
  urls: string[],
  count = DEFAULT_PRELOAD_COUNT,
): void {
  // 跟踪本组件添加的预加载链接（用于组件卸载时清理）
  const addedLinksRef = useRef<HTMLLinkElement[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!urls || urls.length === 0) return;

    // 获取需要预加载的 URL（只取前 count 个有效 URL）
    const urlsToPreload = urls
      .slice(0, count)
      .filter((url) => url && url.trim() !== '');

    // 增量添加预加载链接（不删除已存在的）
    urlsToPreload.forEach((url) => {
      // 跳过已经预加载过的 URL（全局去重）
      if (preloadedUrls.has(url)) return;

      // 跳过 DOM 中已存在的预加载
      const existing = document.querySelector(
        `link[rel="preload"][href="${CSS.escape(url)}"]`,
      );
      if (existing) {
        preloadedUrls.add(url);
        return;
      }

      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = url;
      // 允许跨域图片
      link.crossOrigin = 'anonymous';

      document.head.appendChild(link);
      addedLinksRef.current.push(link);
      preloadedUrls.add(url);
    });

    // 清理函数：只在组件完全卸载时清理
    // 注意：不再在每次 urls 变化时清理，避免 "preloaded but not used" 警告
  }, [urls, count]);

  // 组件卸载时清理本组件添加的链接
  useEffect(() => {
    return () => {
      addedLinksRef.current.forEach((link) => {
        try {
          document.head.removeChild(link);
          // 从全局集合中移除
          preloadedUrls.delete(link.href);
        } catch {
          // 忽略错误
        }
      });
      addedLinksRef.current = [];
    };
  }, []);
}

export default useImagePreload;
