'use client';

import { ExternalLink, MessageCircle, Star, User } from 'lucide-react';
import { memo, useState } from 'react';

import type { DoubanComment } from '@/hooks/useDoubanInfo';

import ExternalImage from '@/components/ExternalImage';

// ============================================================================
// Types
// ============================================================================

interface MovieReviewsProps {
  /** 评论列表 */
  comments: DoubanComment[];
  /** 是否正在加载 */
  loading?: boolean;
  /** 评论总数 */
  total?: number;
  /** 豆瓣 ID，用于生成"查看更多"链接 */
  doubanId?: string | number;
  /** 最多显示数量 */
  maxDisplay?: number;
}

// ============================================================================
// Sub Components
// ============================================================================

/**
 * 评分星星显示
 */
const RatingStars = memo(function RatingStars({
  value,
  max = 5,
}: {
  value: number;
  max?: number;
}) {
  return (
    <div className='flex items-center gap-0.5'>
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${
            i < value
              ? 'text-yellow-400 fill-yellow-400'
              : 'text-gray-300 dark:text-gray-600'
          }`}
        />
      ))}
    </div>
  );
});

/**
 * 单条评论卡片
 */
const CommentCard = memo(function CommentCard({
  comment,
}: {
  comment: DoubanComment;
}) {
  const [avatarError, setAvatarError] = useState(false);

  // 计算评分 (豆瓣评分 1-5 星)
  const starRating = comment.rating?.value || 0;

  // 格式化时间
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className='bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow'>
      {/* 用户信息 */}
      <div className='flex items-center gap-3 mb-3'>
        {/* 头像 */}
        <div className='relative w-10 h-10 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shrink-0'>
          {comment.author.avatar && !avatarError ? (
            <ExternalImage
              src={comment.author.avatar}
              alt={comment.author.name}
              fill
              className='object-cover'
              referrerPolicy='no-referrer'
              onError={() => setAvatarError(true)}
              sizes='40px'
            />
          ) : (
            <div className='w-full h-full flex items-center justify-center'>
              <User className='w-5 h-5 text-gray-400 dark:text-gray-500' />
            </div>
          )}
        </div>

        {/* 用户名和时间 */}
        <div className='flex-1 min-w-0'>
          <p className='text-sm font-medium text-gray-900 dark:text-gray-100 truncate'>
            {comment.author.name}
          </p>
          <div className='flex items-center gap-2'>
            {starRating > 0 && <RatingStars value={starRating} />}
            <span className='text-xs text-gray-500 dark:text-gray-400'>
              {formatDate(comment.created_at)}
            </span>
          </div>
        </div>
      </div>

      {/* 评论内容 */}
      <p className='text-sm text-gray-600 dark:text-gray-300 leading-relaxed line-clamp-4'>
        {comment.content}
      </p>

      {/* 有用数 */}
      {comment.useful_count > 0 && (
        <div className='mt-3 text-xs text-gray-400 dark:text-gray-500'>
          {comment.useful_count} 人认为有用
        </div>
      )}
    </div>
  );
});

/**
 * 骨架屏加载状态
 */
const Skeleton = memo(function Skeleton({ count = 6 }: { count?: number }) {
  return (
    <div className='space-y-4'>
      <div className='flex items-center justify-between'>
        <div className='h-5 w-20 bg-gray-200 dark:bg-gray-700 rounded' />
        <div className='h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded' />
      </div>
      <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className='bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 animate-pulse'
          >
            <div className='flex items-center gap-3 mb-3'>
              <div className='w-10 h-10 bg-gray-200 dark:bg-gray-700 rounded-full' />
              <div className='flex-1'>
                <div className='h-4 w-20 bg-gray-200 dark:bg-gray-700 rounded mb-1' />
                <div className='h-3 w-24 bg-gray-200 dark:bg-gray-700 rounded' />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='h-3 w-full bg-gray-200 dark:bg-gray-700 rounded' />
              <div className='h-3 w-full bg-gray-200 dark:bg-gray-700 rounded' />
              <div className='h-3 w-2/3 bg-gray-200 dark:bg-gray-700 rounded' />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

/**
 * 空状态
 */
const EmptyState = memo(function EmptyState() {
  return (
    <div className='flex flex-col items-center justify-center py-12 text-center'>
      <div className='w-16 h-16 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mb-4'>
        <MessageCircle className='w-8 h-8 text-gray-400 dark:text-gray-600' />
      </div>
      <p className='text-gray-500 dark:text-gray-400 font-medium'>暂无短评</p>
      <p className='text-sm text-gray-400 dark:text-gray-500 mt-1'>
        还没有用户发表短评
      </p>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

/**
 * 电影短评列表组件
 * 卡片式网格布局
 */
function MovieReviewsComponent({
  comments,
  loading = false,
  total = 0,
  doubanId,
  maxDisplay = 6,
}: MovieReviewsProps) {
  if (loading) {
    return <Skeleton count={maxDisplay} />;
  }

  const displayComments = comments.slice(0, maxDisplay);
  const hasMore = total > maxDisplay;

  // 生成豆瓣链接
  const doubanUrl = doubanId
    ? `https://movie.douban.com/subject/${doubanId}/comments`
    : null;

  return (
    <div className='space-y-4'>
      {/* 标题和查看更多 */}
      <div className='flex items-center justify-between'>
        <h3 className='text-base font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2'>
          <MessageCircle className='w-5 h-5' />
          精彩短评
          {total > 0 && (
            <span className='text-sm font-normal text-gray-500 dark:text-gray-400'>
              ({total})
            </span>
          )}
        </h3>

        {hasMore && doubanUrl && (
          <a
            href={doubanUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='inline-flex items-center gap-1 text-sm text-green-600 dark:text-green-400 hover:underline'
          >
            查看更多
            <ExternalLink className='w-3.5 h-3.5' />
          </a>
        )}
      </div>

      {/* 评论列表 */}
      {displayComments.length > 0 ? (
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'>
          {displayComments.map((comment) => (
            <CommentCard key={comment.id} comment={comment} />
          ))}
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

export const MovieReviews = memo(MovieReviewsComponent);

export default MovieReviews;
