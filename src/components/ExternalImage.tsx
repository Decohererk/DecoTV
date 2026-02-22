'use client';

import Image, { type ImageProps } from 'next/image';
import {
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { POSTER_FALLBACK_SRC, resolveImageUrl } from '@/lib/image-url';

type ExternalImageProps = Omit<ImageProps, 'src'> & {
  src: ImageProps['src'];
  fallbackSrc?: string;
  proxyWidth?: number;
};

function resolveSrc(
  src: ImageProps['src'],
  proxyWidth: number,
): ImageProps['src'] {
  if (typeof src !== 'string') {
    return src;
  }
  return resolveImageUrl(src, { wsrvWidth: proxyWidth });
}

export default function ExternalImage(props: ExternalImageProps) {
  const {
    src,
    decoding = 'async',
    loading,
    onError: externalOnError,
    fallbackSrc = POSTER_FALLBACK_SRC,
    proxyWidth = 256,
    ...rest
  } = props;

  const resolvedSrc = useMemo(
    () => resolveSrc(src, proxyWidth),
    [src, proxyWidth],
  );
  const [currentSrc, setCurrentSrc] = useState<ImageProps['src']>(resolvedSrc);
  const [fallbackApplied, setFallbackApplied] = useState(false);

  useEffect(() => {
    setCurrentSrc(resolvedSrc);
    setFallbackApplied(false);
  }, [resolvedSrc]);

  const handleError = useCallback(
    (e: SyntheticEvent<HTMLImageElement, Event>) => {
      if (!fallbackApplied) {
        setCurrentSrc(fallbackSrc);
        setFallbackApplied(true);
      }
      if (typeof externalOnError === 'function') {
        externalOnError(e);
      }
    },
    [externalOnError, fallbackApplied, fallbackSrc],
  );

  return (
    <Image
      {...rest}
      src={currentSrc}
      decoding={decoding}
      loading={loading ?? 'lazy'}
      referrerPolicy={rest.referrerPolicy ?? 'no-referrer'}
      unoptimized
      onError={handleError}
    />
  );
}
