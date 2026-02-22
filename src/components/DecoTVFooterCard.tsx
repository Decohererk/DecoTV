'use client';

import { useEffect, useState } from 'react';

import { useSite } from './SiteProvider';

const DecoTVFooterCard = () => {
  const [isVisible, setIsVisible] = useState(false);
  const { siteName } = useSite();

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.1 },
    );

    const element = document.getElementById('deco-footer-card');
    if (element) {
      observer.observe(element);
    }

    return () => {
      if (element) {
        observer.unobserve(element);
      }
    };
  }, []);

  return (
    <div
      id='deco-footer-card'
      className={`relative overflow-hidden transition-all duration-1000 transform ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'
      }`}
    >
      <div className='relative mx-4 sm:mx-6 lg:mx-auto lg:max-w-4xl mb-8 sm:mb-12'>
        {/* Main Card Container */}
        <div className='relative group overflow-hidden rounded-3xl bg-white/5 dark:bg-black/20 backdrop-blur-xl border border-white/10 dark:border-white/5 shadow-2xl transition-all duration-500 hover:shadow-purple-500/10 hover:border-white/20'>
          {/* Subtle Animated Background Gradient */}
          <div className='absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-blue-500/5 opacity-50 group-hover:opacity-100 transition-opacity duration-700'></div>

          {/* Moving Light Beam */}
          <div className='absolute inset-0 opacity-0 group-hover:opacity-20 transition-opacity duration-700 bg-gradient-to-r from-transparent via-white to-transparent -skew-x-12 translate-x-[-100%] group-hover:animate-shine'></div>

          {/* Content */}
          <div className='relative z-10 px-8 py-12 sm:px-16 sm:py-16 text-center'>
            {/* Logo Section */}
            <div className='mb-8 relative inline-block'>
              <h2 className='text-5xl sm:text-7xl font-black tracking-tighter deco-brand drop-shadow-2xl'>
                {siteName || 'DecoTV'}
              </h2>
              {/* Reflection/Glow */}
              <div className='absolute -inset-4 bg-gradient-to-r from-purple-500/20 to-blue-500/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500'></div>
            </div>

            {/* Divider */}
            <div className='flex justify-center items-center gap-4 mb-8 opacity-50'>
              <div className='h-px w-12 bg-gradient-to-r from-transparent to-gray-400 dark:to-gray-500'></div>
              <div className='w-1.5 h-1.5 rounded-full bg-gray-400 dark:bg-gray-500'></div>
              <div className='h-px w-12 bg-gradient-to-l from-transparent to-gray-400 dark:to-gray-500'></div>
            </div>

            {/* Powered By Section */}
            <div className='space-y-2'>
              <p className='text-sm sm:text-base font-medium text-gray-500 dark:text-gray-400 uppercase tracking-widest'>
                Powered by
              </p>
              <p className='text-2xl sm:text-3xl font-bold bg-gradient-to-r from-gray-800 via-gray-600 to-gray-800 dark:from-white dark:via-gray-200 dark:to-white bg-clip-text text-transparent'>
                Katelya
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DecoTVFooterCard;
