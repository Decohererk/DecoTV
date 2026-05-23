/* eslint-disable @typescript-eslint/no-explicit-any */

import { DoubanResult } from './types';

interface DoubanCategoriesParams {
  kind: 'tv' | 'movie';
  category: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

interface DoubanListParams {
  tag: string;
  type: string;
  pageLimit?: number;
  pageStart?: number;
}

interface DoubanRecommendsParams {
  kind: 'tv' | 'movie';
  pageLimit?: number;
  pageStart?: number;
  category?: string;
  format?: string;
  label?: string;
  region?: string;
  year?: string;
  platform?: string;
  sort?: string;
}

type DoubanClientProxyType =
  | 'auto'
  | 'direct'
  | 'server'
  | 'cors-proxy-zwei'
  | 'cmliussss-cdn-tencent'
  | 'cmliussss-cdn-ali'
  | 'cors-anywhere'
  | 'custom';

function getDoubanProxyConfig(): {
  proxyType: DoubanClientProxyType;
  proxyUrl: string;
} {
  if (typeof window === 'undefined') {
    return {
      proxyType: 'auto',
      proxyUrl: '',
    };
  }

  const runtime = window.RUNTIME_CONFIG ?? {};
  const proxyType =
    localStorage.getItem('doubanDataSource') ||
    runtime.DOUBAN_PROXY_TYPE ||
    'auto';
  const proxyUrl =
    localStorage.getItem('doubanProxyUrl') || runtime.DOUBAN_PROXY || '';

  return {
    proxyType: proxyType as DoubanClientProxyType,
    proxyUrl,
  };
}

function appendProxyConfig(params: URLSearchParams) {
  const { proxyType, proxyUrl } = getDoubanProxyConfig();
  params.set('proxyType', proxyType || 'auto');
  if (proxyUrl) {
    params.set('proxyUrl', proxyUrl);
  }
}

async function fetchDoubanApi(
  path: string,
  params: URLSearchParams,
): Promise<DoubanResult> {
  appendProxyConfig(params);

  const response = await fetch(`${path}?${params.toString()}`, {
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const details =
      data?.details ||
      data?.error ||
      `HTTP ${response.status} ${response.statusText}`;
    const attempts = Array.isArray(data?.providerAttempts)
      ? `；尝试节点：${data.providerAttempts
          .map(
            (item: any) =>
              `${item.provider}${item.ok ? '成功' : `失败(${item.reason || item.status || 'unknown'})`}`,
          )
          .join(' / ')}`
      : '';
    throw new Error(`${details}${attempts}`);
  }

  return data as DoubanResult;
}

export async function getDoubanCategories(
  params: DoubanCategoriesParams,
): Promise<DoubanResult> {
  const { kind, category, type, pageLimit = 20, pageStart = 0 } = params;

  if (!['tv', 'movie'].includes(kind)) {
    throw new Error('kind 参数必须是 tv 或 movie');
  }
  if (!category || !type) {
    throw new Error('category 和 type 参数不能为空');
  }
  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之间');
  }
  if (pageStart < 0) {
    throw new Error('pageStart 不能小于 0');
  }

  const requestParams = new URLSearchParams({
    kind,
    category,
    type,
    limit: pageLimit.toString(),
    start: pageStart.toString(),
  });

  return fetchDoubanApi('/api/douban/categories', requestParams);
}

export async function getDoubanList(
  params: DoubanListParams,
): Promise<DoubanResult> {
  const { tag, type, pageLimit = 20, pageStart = 0 } = params;

  if (!tag || !type) {
    throw new Error('tag 和 type 参数不能为空');
  }
  if (!['tv', 'movie'].includes(type)) {
    throw new Error('type 参数必须是 tv 或 movie');
  }
  if (pageLimit < 1 || pageLimit > 100) {
    throw new Error('pageLimit 必须在 1-100 之间');
  }
  if (pageStart < 0) {
    throw new Error('pageStart 不能小于 0');
  }

  const requestParams = new URLSearchParams({
    tag,
    type,
    pageSize: pageLimit.toString(),
    pageStart: pageStart.toString(),
  });

  return fetchDoubanApi('/api/douban', requestParams);
}

export async function getDoubanRecommends(
  params: DoubanRecommendsParams,
): Promise<DoubanResult> {
  const {
    kind,
    pageLimit = 20,
    pageStart = 0,
    category,
    format,
    label,
    region,
    year,
    platform,
    sort,
  } = params;

  const requestParams = new URLSearchParams({
    kind,
    limit: pageLimit.toString(),
    start: pageStart.toString(),
    category: category ?? '',
    format: format ?? '',
    label: label ?? '',
    region: region ?? '',
    year: year ?? '',
    platform: platform ?? '',
    sort: sort ?? '',
  });

  return fetchDoubanApi('/api/douban/recommends', requestParams);
}
