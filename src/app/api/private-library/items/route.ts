import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  formatPrivateLibrarySourceName,
  getConnectorCachedItems,
  getPrivateLibraryConfig,
  getPrivateLibraryConnectorTypeLabel,
  hydratePrivateLibraryItem,
  type PrivateLibraryConnectorType,
  type PrivateLibraryItem,
  scanConnector,
  toPrivateLibraryErrorMessage,
} from '@/lib/private-library';

export const runtime = 'nodejs';

interface LibraryItemPayload {
  id: string;
  title: string;
  year?: number;
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
  poster: string;
  connectorName: string;
  connectorDisplayName?: string;
  connectorSourceName: string;
  connectorId: string;
  connectorType: PrivateLibraryConnectorType;
  sourceItemId: string;
  streamPath: string;
  season?: number;
  episode?: number;
  overview?: string;
  genres?: string[];
  libraryName?: string;
  originalLanguage?: string;
  tmdbRating?: number;
  runtimeMinutes?: number;
  episodeCount?: number;
  seasonCount?: number;
  isAnime?: boolean;
}

interface LibraryCategoryPayload {
  key: string;
  label: string;
  count: number;
}

interface ConnectorPayload {
  id: string;
  name: string;
  displayName?: string;
  sourceName: string;
  type: PrivateLibraryConnectorType;
  typeLabel: string;
}

interface ErrorPayload {
  connectorId: string;
  connectorName: string;
  error: string;
}

interface MergedLibraryItem extends PrivateLibraryItem {
  connectorName: string;
  connectorDisplayName?: string;
  connectorSourceName: string;
}

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
const MAX_EXTRA_CATEGORIES = 12;

function parsePositiveInt(
  value: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), max);
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase();
}

function toSearchHaystack(item: MergedLibraryItem): string {
  return [
    item.title,
    item.searchTitle,
    item.overview,
    item.connectorName,
    item.connectorSourceName,
    item.libraryName,
    ...(item.genres || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function sortItems(items: MergedLibraryItem[]): MergedLibraryItem[] {
  return [...items].sort((left, right) => {
    const yearDelta = (right.year || 0) - (left.year || 0);
    if (yearDelta !== 0) {
      return yearDelta;
    }

    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

function toLibraryLabel(value: string): string {
  const label = value.trim();
  const normalized = normalizeText(label);

  if (!label) {
    return '';
  }

  if (normalized === 'movies') {
    return '电影库';
  }

  if (normalized === 'tvshows' || normalized === 'tv shows') {
    return '剧集库';
  }

  return label;
}

function matchesCategory(item: MergedLibraryItem, category: string): boolean {
  if (!category || category === 'all') {
    return true;
  }

  if (category === 'media:movie') {
    return item.mediaType === 'movie';
  }

  if (category === 'media:tv') {
    return item.mediaType === 'tv';
  }

  if (category === 'media:anime') {
    return Boolean(item.isAnime);
  }

  if (category.startsWith('library:')) {
    const target = normalizeText(category.slice('library:'.length));
    return normalizeText(toLibraryLabel(item.libraryName || '')) === target;
  }

  if (category.startsWith('genre:')) {
    const target = normalizeText(category.slice('genre:'.length));
    return (item.genres || []).some((genre) => normalizeText(genre) === target);
  }

  return true;
}

function buildCategories(items: MergedLibraryItem[]): LibraryCategoryPayload[] {
  const movieCount = items.filter((item) => item.mediaType === 'movie').length;
  const tvCount = items.filter((item) => item.mediaType === 'tv').length;
  const animeCount = items.filter((item) => item.isAnime).length;
  const categories: LibraryCategoryPayload[] = [
    { key: 'all', label: '全部', count: items.length },
    { key: 'media:movie', label: '电影', count: movieCount },
    { key: 'media:tv', label: '剧集', count: tvCount },
  ];

  if (animeCount > 0) {
    categories.push({
      key: 'media:anime',
      label: '动漫',
      count: animeCount,
    });
  }

  const libraryCounts = new Map<string, number>();
  for (const item of items) {
    const label = toLibraryLabel(item.libraryName || '');
    const normalized = normalizeText(label);
    if (!label || normalized === '电影库' || normalized === '剧集库') {
      continue;
    }

    libraryCounts.set(label, (libraryCounts.get(label) || 0) + 1);
  }

  Array.from(libraryCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0], 'zh-CN');
    })
    .slice(0, 6)
    .forEach(([label, count]) => {
      categories.push({
        key: `library:${label}`,
        label,
        count,
      });
    });

  const genreCounts = new Map<string, number>();
  for (const item of items) {
    for (const genre of item.genres || []) {
      const label = genre.trim();
      if (!label) {
        continue;
      }

      genreCounts.set(label, (genreCounts.get(label) || 0) + 1);
    }
  }

  Array.from(genreCounts.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }

      return left[0].localeCompare(right[0], 'zh-CN');
    })
    .slice(0, MAX_EXTRA_CATEGORIES)
    .forEach(([label, count]) => {
      categories.push({
        key: `genre:${label}`,
        label,
        count,
      });
    });

  return categories.filter((item) => item.count > 0);
}

async function toLibraryItemPayload(
  item: MergedLibraryItem,
): Promise<LibraryItemPayload> {
  let hydrated = item;

  try {
    const hydratedBase = await hydratePrivateLibraryItem(item);
    hydrated = {
      ...item,
      ...hydratedBase,
      connectorName: item.connectorName,
      connectorDisplayName: item.connectorDisplayName,
      connectorSourceName: item.connectorSourceName,
    };
  } catch {
    hydrated = item;
  }

  return {
    id: hydrated.id,
    title: hydrated.title,
    year: hydrated.year,
    tmdbId: hydrated.tmdbId,
    mediaType: hydrated.mediaType,
    poster: hydrated.poster || '',
    connectorId: hydrated.connectorId,
    connectorType: hydrated.connectorType,
    connectorName: hydrated.connectorName,
    connectorDisplayName: hydrated.connectorDisplayName,
    connectorSourceName: hydrated.connectorSourceName,
    sourceItemId: hydrated.sourceItemId,
    streamPath: hydrated.streamPath,
    season: hydrated.season,
    episode: hydrated.episode,
    overview: hydrated.overview,
    genres: hydrated.genres,
    libraryName: hydrated.libraryName,
    originalLanguage: hydrated.originalLanguage,
    tmdbRating: hydrated.tmdbRating,
    runtimeMinutes: hydrated.runtimeMinutes,
    episodeCount: hydrated.episodeCount,
    seasonCount: hydrated.seasonCount,
    isAnime: hydrated.isAnime,
  };
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const connectorIdFilter = (searchParams.get('connectorId') || '').trim();
    const forceRefresh = searchParams.get('refresh') === '1';
    const query = (searchParams.get('q') || '').trim();
    const category = (searchParams.get('category') || '').trim();
    const offset = parsePositiveInt(searchParams.get('offset'), 0, 10_000);
    const limit = parsePositiveInt(
      searchParams.get('limit'),
      DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const config = await getPrivateLibraryConfig();
    const allEnabledConnectors = config.connectors.filter(
      (item) => item.enabled,
    );
    const targetConnectors = allEnabledConnectors.filter(
      (item) => !connectorIdFilter || item.id === connectorIdFilter,
    );

    const connectors: ConnectorPayload[] = allEnabledConnectors.map(
      (connector) => ({
        id: connector.id,
        name: connector.name,
        displayName: connector.displayName,
        sourceName: formatPrivateLibrarySourceName(connector),
        type: connector.type,
        typeLabel: getPrivateLibraryConnectorTypeLabel(connector.type),
      }),
    );
    const connectorResults = await Promise.allSettled(
      targetConnectors.map(async (connector) => {
        let items = forceRefresh ? [] : getConnectorCachedItems(connector.id);

        if (items.length === 0) {
          items = await scanConnector(connector);
        }

        return {
          connector,
          items,
        };
      }),
    );

    const merged: MergedLibraryItem[] = [];
    const errors: ErrorPayload[] = [];

    connectorResults.forEach((result, index) => {
      if (result.status === 'rejected') {
        const connector = targetConnectors[index];
        if (!connector) {
          return;
        }

        errors.push({
          connectorId: connector.id,
          connectorName: connector.name,
          error: toPrivateLibraryErrorMessage(result.reason),
        });
        return;
      }

      for (const item of result.value.items) {
        merged.push({
          ...item,
          connectorName: result.value.connector.name,
          connectorDisplayName: result.value.connector.displayName,
          connectorSourceName: formatPrivateLibrarySourceName(
            result.value.connector,
          ),
        });
      }
    });

    const normalizedQuery = normalizeText(query);
    const queryFiltered = sortItems(
      merged.filter((item) =>
        normalizedQuery
          ? toSearchHaystack(item).includes(normalizedQuery)
          : true,
      ),
    );

    const categories = buildCategories(queryFiltered);
    const activeCategory = category || 'all';
    const filtered = queryFiltered.filter((item) =>
      matchesCategory(item, activeCategory),
    );
    const pageItems = filtered.slice(offset, offset + limit);
    const items = await Promise.all(
      pageItems.map((item) => toLibraryItemPayload(item)),
    );

    return NextResponse.json({
      items,
      categories,
      connectors,
      pagination: {
        total: filtered.length,
        offset,
        limit,
        hasMore: offset + items.length < filtered.length,
        nextOffset: offset + items.length,
      },
      ...(errors.length > 0 ? { errors } : {}),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: '读取私人影库资源失败',
        details: toPrivateLibraryErrorMessage(error),
      },
      { status: 500 },
    );
  }
}
