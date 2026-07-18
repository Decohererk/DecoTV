/** @jest-environment node */

/* global afterEach, beforeEach, describe, expect, it, jest */

jest.mock('@/lib/config', () => ({
  getConfig: jest.fn(),
}));

jest.mock('@/lib/db', () => ({
  db: {},
}));

jest.mock('@/lib/private-library-config', () => ({
  normalizePrivateLibraryConfig: jest.fn(),
}));

jest.mock('@/lib/server-cache', () => ({
  getServerCache: jest.fn(() => null),
  setServerCache: jest.fn(),
}));

jest.mock('@/lib/tmdb', () => ({
  isTmdbEnabled: jest.fn(async () => false),
  tmdbGetMovieDetail: jest.fn(),
  tmdbGetTvDetail: jest.fn(),
  tmdbSearch: jest.fn(),
  toTmdbPosterUrl: jest.fn(() => ''),
}));

const { getServerCache } = require('@/lib/server-cache');
const {
  aggregatePrivateLibraryItems,
  scanConnector,
} = require('../src/lib/private-library');

const originalFetch = global.fetch;

beforeEach(() => {
  getServerCache.mockImplementation(() => null);
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

function item(overrides) {
  return {
    id: `openlist:${overrides.sourceItemId}`,
    connectorId: 'openlist',
    connectorType: 'openlist',
    sourceItemId: overrides.sourceItemId,
    title: '快乐综艺',
    searchTitle: '快乐综艺',
    mediaType: 'tv',
    streamPath: overrides.streamPath,
    scannedAt: 1,
    sortKey: overrides.sortKey,
    ...overrides,
  };
}

describe('private library aggregation', () => {
  it('groups OpenList episode files into one series item', () => {
    const result = aggregatePrivateLibraryItems([
      item({
        sourceItemId: '/shows/快乐综艺/第2期.strm',
        streamPath: '/shows/快乐综艺/第2期.strm',
        episode: 2,
        sortKey: 2,
        embeddedStreamUrl: 'https://cdn.example.com/2.m3u8',
      }),
      item({
        sourceItemId: '/shows/快乐综艺/第1期.strm',
        streamPath: '/shows/快乐综艺/第1期.strm',
        episode: 1,
        sortKey: 1,
        embeddedStreamUrl: 'https://cdn.example.com/1.m3u8',
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('快乐综艺');
    expect(result[0].episodeCount).toBe(2);
    expect(result[0].episodeItems.map((entry) => entry.sourceItemId)).toEqual([
      '/shows/快乐综艺/第1期.strm',
      '/shows/快乐综艺/第2期.strm',
    ]);
    expect(
      result[0].episodeItems.map((entry) => entry.embeddedStreamUrl),
    ).toEqual([
      'https://cdn.example.com/1.m3u8',
      'https://cdn.example.com/2.m3u8',
    ]);
  });

  it('does not group movie items', () => {
    const result = aggregatePrivateLibraryItems([
      item({
        sourceItemId: '/movies/Movie.mp4',
        title: 'Movie',
        searchTitle: 'Movie',
        mediaType: 'movie',
        streamPath: '/movies/Movie.mp4',
        sortKey: 1,
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].episodeItems).toBeUndefined();
  });
});

function jellyfinConnector(overrides = {}) {
  return {
    id: 'jellyfin-main',
    name: 'Jellyfin',
    type: 'jellyfin',
    enabled: true,
    serverUrl: 'http://jellyfin.example.com',
    token: '',
    username: 'deco',
    password: 'secret',
    libraryFilter: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('Jellyfin scanning', () => {
  it('refreshes a cached username/password session once after 401', async () => {
    getServerCache.mockImplementation((key) =>
      key.includes(':auth:')
        ? {
            accessToken: 'stale-token',
            userId: 'user-1',
            authorizationHeader: 'MediaBrowser Token="stale-token"',
          }
        : null,
    );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        Response.json({
          AccessToken: 'fresh-token',
          User: { Id: 'user-1' },
        }),
      )
      .mockResolvedValueOnce(Response.json({ Items: [] }));

    await expect(scanConnector(jellyfinConnector())).resolves.toEqual([]);
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[1][0]).toContain(
      '/Users/AuthenticateByName',
    );
    expect(global.fetch.mock.calls[2][0]).toContain('api_key=fresh-token');
  });

  it('expands series into playable episodes and groups them by season order', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          Items: [
            {
              Id: 'series-1',
              Name: 'Example Show',
              Type: 'Series',
              ProductionYear: 2025,
              CollectionType: 'tvshows',
              ProviderIds: { Tmdb: '123' },
              Overview: 'Series overview',
              Genres: ['Drama'],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          Items: [
            {
              Id: 'episode-2',
              Name: 'Episode 2',
              Type: 'Episode',
              SeriesId: 'series-1',
              SeriesName: 'Example Show',
              ParentIndexNumber: 1,
              IndexNumber: 2,
            },
            {
              Id: 'episode-1',
              Name: 'Episode 1',
              Type: 'Episode',
              SeriesId: 'series-1',
              SeriesName: 'Example Show',
              ParentIndexNumber: 1,
              IndexNumber: 1,
            },
          ],
        }),
      );

    const result = await scanConnector(
      jellyfinConnector({ token: 'static-api-key' }),
    );

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(
      new URL(global.fetch.mock.calls[0][0]).searchParams.get(
        'IncludeItemTypes',
      ),
    ).toBe('Movie,Series');
    expect(
      new URL(global.fetch.mock.calls[1][0]).searchParams.get(
        'IncludeItemTypes',
      ),
    ).toBe('Episode');
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Example Show');
    expect(result[0].sourceItemId).toBe('episode-1');
    expect(result[0].episodeItems.map((entry) => entry.sourceItemId)).toEqual([
      'episode-1',
      'episode-2',
    ]);
  });
});
