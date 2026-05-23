'use client';

import Image, { type ImageProps } from 'next/image';
import {
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  type DoubanImageProxyOverride,
  POSTER_FALLBACK_SRC,
  rememberDoubanImageProvider,
  resolveImageUrlCandidates,
} from '@/lib/image-url';

type ExternalImageProps = Omit<ImageProps, 'src'> & {
  src: ImageProps['src'];
  fallbackSrc?: string;
  proxyWidth?: number;
};

function resolveSrcCandidates(
  src: ImageProps['src'],
  proxyWidth: number,
  doubanImageProxy?: DoubanImageProxyOverride,
): ImageProps['src'][] {
  if (typeof src !== 'string') {
    return [src];
  }
  return resolveImageUrlCandidates(src, {
    wsrvWidth: proxyWidth,
    doubanImageProxy,
  });
}

let cachedClientDoubanImageProxy: DoubanImageProxyOverride | undefined;
let cachedClientDoubanImageProxyAt = 0;
const CLIENT_PROXY_CACHE_TTL_MS = 2000;

function readClientDoubanImageProxy(): DoubanImageProxyOverride | undefined {
  if (typeof window === 'undefined') return undefined;
  const now = Date.now();
  if (now - cachedClientDoubanImageProxyAt < CLIENT_PROXY_CACHE_TTL_MS) {
    return cachedClientDoubanImageProxy;
  }

  const runtime = window.RUNTIME_CONFIG ?? {};
  let storedType: string | null = null;
  let storedUrl: string | null = null;
  try {
    storedType = window.localStorage.getItem('doubanImageProxyType');
    storedUrl = window.localStorage.getItem('doubanImageProxyUrl');
  } catch {
    // localStorage 被禁用时静默回退
  }
  cachedClientDoubanImageProxy = {
    proxyType: storedType ?? runtime.DOUBAN_IMAGE_PROXY_TYPE ?? undefined,
    proxyUrl: storedUrl ?? runtime.DOUBAN_IMAGE_PROXY ?? undefined,
  };
  cachedClientDoubanImageProxyAt = now;

  return cachedClientDoubanImageProxy;
}

function areCandidatesEqual(
  left: ImageProps['src'][],
  right: ImageProps['src'][],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((item, index) => Object.is(item, right[index]));
}

function withFallbackCandidate(
  candidates: ImageProps['src'][],
  fallbackSrc: string,
): ImageProps['src'][] {
  if (candidates.some((item) => Object.is(item, fallbackSrc))) {
    return candidates;
  }
  return [...candidates, fallbackSrc];
}

export default function ExternalImage(props: ExternalImageProps) {
  const {
    src,
    decoding = 'async',
    loading,
    onLoad: externalOnLoad,
    onError: externalOnError,
    fallbackSrc = POSTER_FALLBACK_SRC,
    proxyWidth = 256,
    ...rest
  } = props;

  // SSR 与首屏渲染只走 process.env 默认值，确保两端 HTML 一致避免 hydration 警告。
  const ssrSafeCandidates = useMemo(
    () =>
      withFallbackCandidate(resolveSrcCandidates(src, proxyWidth), fallbackSrc),
    [src, proxyWidth, fallbackSrc],
  );
  const [candidates, setCandidates] =
    useState<ImageProps['src'][]>(ssrSafeCandidates);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const currentSrc = candidates[candidateIndex] || fallbackSrc;

  // 客户端挂载后再叠加 RUNTIME_CONFIG / localStorage 中的用户/管理员选择。
  useEffect(() => {
    const refreshCandidates = () => {
      cachedClientDoubanImageProxyAt = 0;
      const override = readClientDoubanImageProxy();
      const nextCandidates = withFallbackCandidate(
        resolveSrcCandidates(src, proxyWidth, override),
        fallbackSrc,
      );
      setCandidates((previousCandidates) =>
        areCandidatesEqual(previousCandidates, nextCandidates)
          ? previousCandidates
          : nextCandidates,
      );
      setCandidateIndex(0);
    };

    refreshCandidates();
    window.addEventListener('doubanProxyChanged', refreshCandidates);

    return () => {
      window.removeEventListener('doubanProxyChanged', refreshCandidates);
    };
  }, [src, proxyWidth, fallbackSrc]);

  const handleLoad = useCallback(
    (e: SyntheticEvent<HTMLImageElement, Event>) => {
      if (typeof currentSrc === 'string') {
        rememberDoubanImageProvider(currentSrc);
      }
      if (typeof externalOnLoad === 'function') {
        externalOnLoad(e);
      }
    },
    [currentSrc, externalOnLoad],
  );

  const handleError = useCallback(
    (e: SyntheticEvent<HTMLImageElement, Event>) => {
      const nextIndex = candidateIndex + 1;

      if (nextIndex < candidates.length) {
        setCandidateIndex(nextIndex);
        return;
      }

      if (typeof externalOnError === 'function') {
        externalOnError(e);
      }
    },
    [candidateIndex, candidates.length, externalOnError],
  );

  return (
    <Image
      {...rest}
      src={currentSrc}
      decoding={decoding}
      loading={loading ?? 'lazy'}
      referrerPolicy={rest.referrerPolicy ?? 'no-referrer'}
      unoptimized
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
