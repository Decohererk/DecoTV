/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */

'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';

import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import DecoTVFooterCard from '@/components/DecoTVFooterCard';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

import { useGlobalCache } from '@/contexts/GlobalCacheContext';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'favorites'>('home');
  const { siteName, announcement } = useSite();

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // === 接入全局缓存 ===
  const { homeData, homeLoading, fetchHomeData } = useGlobalCache();

  // 解构首页数据（带默认值防止 null）
  const hotMovies = homeData?.hotMovies ?? [];
  const hotTvShows = homeData?.hotTvShows ?? [];
  const hotVarietyShows = homeData?.hotVarietyShows ?? [];
  const bangumiCalendarData = homeData?.bangumiCalendar ?? [];
  const HOME_SECTION_LIMIT = 24;
  const hotMoviesPreview = useMemo(
    () => hotMovies.slice(0, HOME_SECTION_LIMIT),
    [hotMovies],
  );
  const hotTvShowsPreview = useMemo(
    () => hotTvShows.slice(0, HOME_SECTION_LIMIT),
    [hotTvShows],
  );
  const hotVarietyShowsPreview = useMemo(
    () => hotVarietyShows.slice(0, HOME_SECTION_LIMIT),
    [hotVarietyShows],
  );

  // 只在无缓存时显示骨架屏，有缓存时后台静默更新
  const loading = homeLoading && !homeData;

  // === 首次挂载时触发数据加载（利用 SWR 策略） ===
  useEffect(() => {
    fetchHomeData();
  }, []);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
    origin?: 'vod' | 'live';
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
          origin: fav?.origin,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 当切换到收藏夹时加载收藏数据
  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      },
    );

    return unsubscribe;
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  return (
    <PageLayout>
      {/* Hero Section */}
      <div className='relative pt-20 pb-10 sm:pt-32 sm:pb-16 overflow-hidden'>
        {/* Background Ambient Light */}
        <div className='absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-75 h-75 sm:w-150 sm:h-150 bg-purple-500/20 rounded-full blur-[48px] sm:blur-[72px] -z-10 pointer-events-none animate-pulse'></div>

        <div className='flex flex-col items-center justify-center text-center px-4'>
          <div className='relative group cursor-default'>
            <h1 className='text-6xl sm:text-8xl font-black tracking-tighter deco-brand drop-shadow-2xl select-none transition-transform duration-500 group-hover:scale-105'>
              {siteName || 'DecoTV'}
            </h1>
            <div className='absolute -inset-8 bg-linear-to-r from-blue-500/20 via-purple-500/20 to-pink-500/20 blur-2xl -z-10 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500'></div>
          </div>

          <div className='mt-8 animate-fade-in-up'>
            <div className='inline-flex items-center gap-3 px-6 py-2.5 rounded-full bg-white/82 dark:bg-black/72 border border-white/20 dark:border-white/10 shadow-md transition-all duration-300 hover:-translate-y-0.5'>
              <span className='text-base sm:text-lg font-medium bg-linear-to-r from-gray-800 to-gray-600 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent'>
                发现
              </span>
              <span className='w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600'></span>
              <span className='text-base sm:text-lg font-medium bg-linear-to-r from-gray-800 to-gray-600 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent'>
                收藏
              </span>
              <span className='w-1 h-1 rounded-full bg-gray-300 dark:bg-gray-600'></span>
              <span className='text-base sm:text-lg font-medium bg-linear-to-r from-gray-800 to-gray-600 dark:from-gray-100 dark:to-gray-300 bg-clip-text text-transparent'>
                继续观看
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 顶部 Tab 切换 */}
        <div className='mb-8 flex justify-center'>
          <CapsuleSwitch
            options={[
              { label: '首页', value: 'home' },
              { label: '收藏夹', value: 'favorites' },
            ]}
            active={activeTab}
            onChange={(value) => setActiveTab(value as 'home' | 'favorites')}
          />
        </div>

        <div className='max-w-[95%] mx-auto'>
          {activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的收藏
                </h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={async () => {
                      await clearAllFavorites();
                      setFavoriteItems([]);
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='justify-start grid grid-cols-3 gap-x-2 gap-y-14 sm:gap-y-20 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {favoriteItems.length === 0 && (
                  <div className='col-span-full text-center text-gray-500 py-8 dark:text-gray-400'>
                    暂无收藏内容
                  </div>
                )}
              </div>
            </section>
          ) : (
            // 首页视图
            <>
              {/* 继续观看 */}
              <ContinueWatching />

              {/* 热门电影 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门电影
                  </h2>
                  <Link
                    href='/douban?type=movie'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 显示真实数据
                      hotMoviesPreview.map((movie, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <VideoCard
                            from='douban'
                            title={movie.title}
                            poster={movie.poster}
                            douban_id={Number(movie.id)}
                            rate={movie.rate}
                            year={movie.year}
                            type='movie'
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 热门剧集 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门剧集
                  </h2>
                  <Link
                    href='/douban?type=tv'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 显示真实数据
                      hotTvShowsPreview.map((show, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <VideoCard
                            from='douban'
                            title={show.title}
                            poster={show.poster}
                            douban_id={Number(show.id)}
                            rate={show.rate}
                            year={show.year}
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>

              {/* 每日新番放送 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    新番放送
                  </h2>
                  <Link
                    href='/douban?type=anime'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 展示当前日期的番剧
                      (() => {
                        // 获取当前日期对应的星期
                        const today = new Date();
                        const weekdays = [
                          'Sun',
                          'Mon',
                          'Tue',
                          'Wed',
                          'Thu',
                          'Fri',
                          'Sat',
                        ];
                        const currentWeekday = weekdays[today.getDay()];

                        // 找到当前星期对应的番剧数据
                        const todayAnimes =
                          bangumiCalendarData.find(
                            (item) => item.weekday.en === currentWeekday,
                          )?.items || [];

                        // 过滤掉无效数据
                        const validAnimes = todayAnimes.filter(
                          (anime) => anime && anime.id,
                        );

                        return validAnimes
                          .slice(0, HOME_SECTION_LIMIT)
                          .map((anime, index) => (
                            <div
                              key={`${anime.id}-${index}`}
                              className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                            >
                              <VideoCard
                                from='douban'
                                title={anime.name_cn || anime.name}
                                poster={
                                  anime.images?.large ||
                                  anime.images?.common ||
                                  anime.images?.medium ||
                                  anime.images?.small ||
                                  anime.images?.grid ||
                                  '/logo.png'
                                }
                                douban_id={anime.id}
                                rate={anime.rating?.score?.toFixed(1) || ''}
                                year={anime.air_date?.split('-')?.[0] || ''}
                                isBangumi={true}
                              />
                            </div>
                          ));
                      })()}
                </ScrollableRow>
              </section>

              {/* 热门综艺 */}
              <section className='mb-8'>
                <div className='mb-4 flex items-center justify-between'>
                  <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                    热门综艺
                  </h2>
                  <Link
                    href='/douban?type=show'
                    className='flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                  >
                    查看更多
                    <ChevronRight className='w-4 h-4 ml-1' />
                  </Link>
                </div>
                <ScrollableRow>
                  {loading
                    ? // 加载状态显示灰色占位数据
                      Array.from({ length: 8 }).map((_, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                            <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                          </div>
                          <div className='mt-2 h-4 bg-gray-200 rounded animate-pulse dark:bg-gray-800'></div>
                        </div>
                      ))
                    : // 显示真实数据
                      hotVarietyShowsPreview.map((show, index) => (
                        <div
                          key={index}
                          className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                        >
                          <VideoCard
                            from='douban'
                            title={show.title}
                            poster={show.poster}
                            douban_id={Number(show.id)}
                            rate={show.rate}
                            year={show.year}
                          />
                        </div>
                      ))}
                </ScrollableRow>
              </section>
            </>
          )}

          {/* DecoTV 底部炫酷卡片 */}
          <DecoTVFooterCard />
        </div>
      </div>
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/70 dark:bg-black/80 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
          onTouchStart={(e) => {
            // 如果点击的是背景区域，阻止触摸事件冒泡，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          onTouchMove={(e) => {
            // 如果触摸的是背景区域，阻止触摸移动，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onTouchEnd={(e) => {
            // 如果触摸的是背景区域，阻止触摸结束事件，防止背景滚动
            if (e.target === e.currentTarget) {
              e.preventDefault();
            }
          }}
          style={{
            touchAction: 'none', // 禁用所有触摸操作
          }}
        >
          <div
            className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'
            onTouchMove={(e) => {
              // 允许公告内容区域正常滚动，阻止事件冒泡到外层
              e.stopPropagation();
            }}
            style={{
              touchAction: 'auto', // 允许内容区域的正常触摸操作
            }}
          >
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-transparent bg-clip-text bg-linear-to-r from-purple-500 via-pink-400 to-indigo-500 border-b-2 border-purple-400 pb-1 drop-shadow-lg'>
                公告
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='text-purple-400 hover:text-purple-600 dark:text-purple-300 dark:hover:text-white transition-colors'
                aria-label='关闭'
              >
                <svg
                  className='w-6 h-6'
                  fill='none'
                  stroke='currentColor'
                  viewBox='0 0 24 24'
                >
                  <path
                    strokeLinecap='round'
                    strokeLinejoin='round'
                    strokeWidth={2}
                    d='M6 18L18 6M6 6l12 12'
                  />
                </svg>
              </button>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 p-4 bg-linear-to-r from-purple-100 via-pink-100 to-indigo-100 dark:from-purple-900/40 dark:via-pink-900/30 dark:to-indigo-900/40 shadow-lg'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-linear-to-b from-purple-500 via-pink-400 to-indigo-500 dark:from-purple-400 dark:via-pink-400 dark:to-indigo-400'></div>
                <p className='ml-4 text-gray-700 dark:text-gray-200 leading-relaxed font-medium'>
                  {announcement}
                </p>
                <div className='absolute right-2 bottom-2 w-8 h-8 bg-linear-to-tr from-purple-400 via-pink-400 to-indigo-400 rounded-full blur-xl opacity-40 animate-pulse'></div>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-linear-to-r from-purple-600 via-pink-500 to-indigo-600 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-purple-700 hover:via-pink-600 hover:to-indigo-700 dark:from-purple-600 dark:via-pink-500 dark:to-indigo-600 dark:hover:from-purple-700 dark:hover:via-pink-600 dark:hover:to-indigo-700 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
