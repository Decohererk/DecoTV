/* eslint-disable no-console */
'use client';

import { useCallback, useEffect, useState } from 'react';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import ScrollableRow from '@/components/ScrollableRow';
import VideoCard from '@/components/VideoCard';

interface ContinueWatchingProps {
  className?: string;
}

function isPlayableHistoryKey(key: string): boolean {
  if (key.startsWith('private:progress:')) {
    return false;
  }

  const [source, id] = key.split('+');
  return Boolean(source && id) && !source.startsWith('private-progress:');
}

function getProgress(record: PlayRecord): number {
  if (record.total_time === 0) {
    return 0;
  }

  return (record.play_time / record.total_time) * 100;
}

function parseKey(key: string): { source: string; id: string } {
  const [source = '', id = ''] = key.split('+');
  return { source, id };
}

export default function ContinueWatching({ className }: ContinueWatchingProps) {
  const [playRecords, setPlayRecords] = useState<
    (PlayRecord & { key: string })[]
  >([]);
  const [loading, setLoading] = useState(true);
  const visiblePlayRecords = playRecords.slice(0, 24);

  const updatePlayRecords = useCallback(
    (allRecords: Record<string, PlayRecord>) => {
      const sortedRecords = Object.entries(allRecords)
        .filter(([key]) => isPlayableHistoryKey(key))
        .map(([key, record]) => ({
          ...record,
          key,
        }))
        .sort((left, right) => right.save_time - left.save_time);

      setPlayRecords(sortedRecords);
    },
    [],
  );

  useEffect(() => {
    const fetchPlayRecords = async () => {
      try {
        setLoading(true);
        const allRecords = await getAllPlayRecords();
        updatePlayRecords(allRecords);
      } catch (error) {
        console.error('Failed to load play records:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    };

    void fetchPlayRecords();

    const unsubscribe = subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => {
        updatePlayRecords(newRecords);
      },
    );

    return unsubscribe;
  }, [updatePlayRecords]);

  if (!loading && playRecords.length === 0) {
    return null;
  }

  return (
    <section className={`mb-8 ${className || ''}`}>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
          继续观看
        </h2>
        {!loading && playRecords.length > 0 && (
          <button
            className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            onClick={async () => {
              await clearAllPlayRecords();
              setPlayRecords([]);
            }}
          >
            清空
          </button>
        )}
      </div>
      <ScrollableRow>
        {loading
          ? Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className='min-w-24 w-24 sm:min-w-45 sm:w-44'>
                <div className='relative aspect-2/3 w-full overflow-hidden rounded-lg bg-gray-200 animate-pulse dark:bg-gray-800'>
                  <div className='absolute inset-0 bg-gray-300 dark:bg-gray-700'></div>
                </div>
                <div className='mt-2 h-4 rounded bg-gray-200 animate-pulse dark:bg-gray-800'></div>
                <div className='mt-1 h-3 rounded bg-gray-200 animate-pulse dark:bg-gray-800'></div>
              </div>
            ))
          : visiblePlayRecords.map((record) => {
              const { source, id } = parseKey(record.key);
              return (
                <div
                  key={record.key}
                  className='min-w-24 w-24 sm:min-w-45 sm:w-44'
                >
                  <VideoCard
                    id={id}
                    title={record.title}
                    poster={record.cover}
                    year={record.year}
                    source={source}
                    source_name={record.source_name}
                    progress={getProgress(record)}
                    episodes={record.total_episodes}
                    currentEpisode={record.index}
                    query={record.search_title}
                    from='playrecord'
                    onDelete={() =>
                      setPlayRecords((prev) =>
                        prev.filter((item) => item.key !== record.key),
                      )
                    }
                    type={record.total_episodes > 1 ? 'tv' : ''}
                  />
                </div>
              );
            })}
      </ScrollableRow>
    </section>
  );
}
