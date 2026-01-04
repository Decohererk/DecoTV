/**
 * useImagePreload - 图片预加载 Hook
 *
 * 功能：
 * - 预加载即将进入视口的图片
 * - 使用 <link rel="preload"> 提高加载优先级
 * - 自动清理已添加的预加载链接
 *
 * 参考 LunaTV 的智能图片加载策略
 */

/* eslint-disable no-undef */

'use client';

/// <reference lib="dom" />

import { useEffect, useRef } from 'react';

// 默认预加载数量
const DEFAULT_PRELOAD_COUNT = 12;

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
  // 跟踪已添加的预加载链接
  const addedLinksRef = useRef<HTMLLinkElement[]>([]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!urls || urls.length === 0) return;

    // 清理之前的预加载链接
    addedLinksRef.current.forEach((link) => {
      try {
        document.head.removeChild(link);
      } catch {
        // 链接可能已被移除
      }
    });
    addedLinksRef.current = [];

    // 获取需要预加载的 URL
    const urlsToPreload = urls
      .slice(0, count)
      .filter((url) => url && url.trim() !== '');

    // 创建预加载链接
    urlsToPreload.forEach((url) => {
      // 跳过已存在的预加载
      const existing = document.querySelector(
        `link[rel="preload"][href="${url}"]`,
      );
      if (existing) return;

      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = url;
      // 允许跨域图片
      link.crossOrigin = 'anonymous';

      document.head.appendChild(link);
      addedLinksRef.current.push(link);
    });

    // 清理函数
    return () => {
      addedLinksRef.current.forEach((link) => {
        try {
          document.head.removeChild(link);
        } catch {
          // 忽略错误
        }
      });
      addedLinksRef.current = [];
    };
  }, [urls, count]);
}

export default useImagePreload;
