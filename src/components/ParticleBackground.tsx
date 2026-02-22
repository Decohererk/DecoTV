'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo } from 'react';

function shouldUseLiteRender(pathname: string): boolean {
  return (
    pathname.startsWith('/douban') ||
    pathname.startsWith('/search') ||
    pathname.startsWith('/source-browser')
  );
}

export default function ParticleBackground() {
  const pathname = usePathname();

  const isLiteRender = useMemo(
    () => shouldUseLiteRender(pathname ?? ''),
    [pathname],
  );

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.renderMode = isLiteRender ? 'lite' : 'full';

    return () => {
      delete root.dataset.renderMode;
    };
  }, [isLiteRender]);

  const blobAnimationClass = isLiteRender
    ? 'motion-reduce:animate-none'
    : 'animate-blob-slow motion-reduce:animate-none';

  return (
    <div className='fixed inset-0 z-[-1] overflow-hidden'>
      <div className='absolute inset-0 bg-linear-to-b from-neutral-950 via-slate-950 to-black dark:from-neutral-950 dark:via-slate-950 dark:to-black' />
      <div className='absolute inset-0 bg-linear-to-b from-slate-100 via-gray-50 to-white dark:opacity-0 transition-opacity duration-500' />

      <div
        className={`absolute -top-16 -left-16 w-64 h-64 md:w-[40vw] md:h-[40vw] md:max-w-125 md:max-h-125 rounded-full ${isLiteRender ? 'opacity-70 blur-[22px] md:blur-[30px]' : 'mix-blend-screen blur-[28px] md:blur-[44px]'} ${blobAnimationClass} transform-gpu`}
        style={{
          background:
            'radial-gradient(circle, rgba(139,92,246,0.22) 0%, transparent 70%)',
          transform: 'translate3d(0,0,0)',
        }}
      />

      <div
        className={`absolute bottom-20 -right-16 md:bottom-0 md:-right-20 w-56 h-56 md:w-[35vw] md:h-[35vw] md:max-w-md md:max-h-md rounded-full ${isLiteRender ? 'opacity-70 blur-[18px] md:blur-[28px]' : 'mix-blend-screen blur-[24px] md:blur-[40px]'} ${blobAnimationClass} transform-gpu`}
        style={{
          background:
            'radial-gradient(circle, rgba(34,211,238,0.18) 0%, transparent 70%)',
          transform: 'translate3d(0,0,0)',
          animationDelay: '5s',
        }}
      />

      {!isLiteRender && (
        <div
          className='absolute inset-0 opacity-[0.025] dark:opacity-[0.04] pointer-events-none'
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
          }}
        />
      )}

      <style jsx>{`
        @keyframes blob-slow {
          0%,
          100% {
            transform: translate3d(0, 0, 0) scale(1);
          }
          50% {
            transform: translate3d(10px, -14px, 0) scale(1.03);
          }
        }

        .animate-blob-slow {
          animation: blob-slow 18s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
