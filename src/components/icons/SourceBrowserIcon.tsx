'use client';

import { memo } from 'react';

interface SourceBrowserIconProps {
  className?: string;
}

function SourceBrowserIconComponent({ className }: SourceBrowserIconProps) {
  return (
    <svg
      className={className}
      viewBox='0 0 24 24'
      fill='none'
      xmlns='http://www.w3.org/2000/svg'
      aria-hidden='true'
    >
      <defs>
        <linearGradient id='sb-gradient' x1='4' y1='4' x2='20' y2='20'>
          <stop offset='0%' stopColor='currentColor' stopOpacity='0.95' />
          <stop offset='100%' stopColor='currentColor' stopOpacity='0.55' />
        </linearGradient>
      </defs>
      <rect
        x='4'
        y='5'
        width='14'
        height='9'
        rx='2.5'
        stroke='url(#sb-gradient)'
        strokeWidth='1.7'
      />
      <rect
        x='7'
        y='10'
        width='14'
        height='9'
        rx='2.5'
        stroke='url(#sb-gradient)'
        strokeWidth='1.7'
      />
      <path
        d='M17.5 4.5V2.8M17.5 11.2v-1.6M20.7 7h-1.6M16 7h-1.6'
        stroke='currentColor'
        strokeWidth='1.4'
        strokeLinecap='round'
      />
    </svg>
  );
}

export const SourceBrowserIcon = memo(SourceBrowserIconComponent);

export default SourceBrowserIcon;
