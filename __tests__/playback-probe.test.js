/** @jest-environment node */

/* global describe, expect, it, jest */

const {
  inspectHlsPlaylist,
  probePlaybackUrl,
  selectEffectivePlaybackTarget,
} = require('../src/lib/playback-probe');
const {
  selectImmediatePlaybackUrl,
} = require('../src/lib/player/playback-source');

describe('playback probe playlist inspection', () => {
  it('extracts variant playlist and quality from a master playlist', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720',
      '720p/index.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=3000000,RESOLUTION=1920x1080',
      '1080p/index.m3u8',
    ].join('\n');

    const result = inspectHlsPlaylist(
      playlist,
      'https://cdn.example.com/movie/master.m3u8',
    );

    expect(result.isHls).toBe(true);
    expect(result.isMaster).toBe(true);
    expect(result.quality).toBe('1080p');
    expect(result.firstVariantUrl).toBe(
      'https://cdn.example.com/movie/720p/index.m3u8',
    );
  });

  it('extracts the first media segment from a variant playlist', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6,',
      '../segments/0001.ts',
      '#EXTINF:6,',
      '../segments/0002.ts',
    ].join('\n');

    const result = inspectHlsPlaylist(
      playlist,
      'https://cdn.example.com/movie/720p/index.m3u8',
    );

    expect(result.isHls).toBe(true);
    expect(result.isMaster).toBe(false);
    expect(result.firstSegmentUrl).toBe(
      'https://cdn.example.com/movie/segments/0001.ts',
    );
  });
});

describe('playback proxy fallback selection', () => {
  const proxyUrl =
    'https://decotv.example.com/api/proxy/m3u8-filter?url=https%3A%2F%2Fcdn.example.com%2Fmovie.m3u8';
  const directUrl = 'https://cdn.example.com/movie.m3u8';

  it('keeps the direct URL validated by the probe instead of the failed proxy URL', () => {
    expect(
      selectEffectivePlaybackTarget({
        playbackUrl: proxyUrl,
        resolvedUrl: directUrl,
        proxied: true,
      }),
    ).toEqual({
      playbackUrl: directUrl,
      resolvedUrl: directUrl,
      proxied: false,
    });
  });

  it('uses a cached direct fallback before returning an internal proxy URL', () => {
    const cacheKey = `source-a|${proxyUrl}`;
    const cache = new Map([[cacheKey, directUrl]]);

    expect(
      selectImmediatePlaybackUrl({
        rawUrl: proxyUrl,
        sourceKey: 'source-a',
        currentSourceKey: '',
        cache,
        origin: 'https://decotv.example.com',
      }),
    ).toEqual({
      url: directUrl,
      cacheKey,
      fromCache: true,
    });
  });

  it('falls back to the direct manifest when the proxy returns non-HLS content', async () => {
    const directManifest = 'https://decotv.example.com/upstream/movie.m3u8';
    const malformedProxyUrl =
      'https://decotv.example.com/api/proxy/m3u8-filter?url=' +
      encodeURIComponent(directManifest);
    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('<html>upstream error</html>', {
          headers: { 'Content-Type': 'text/html' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('#EXTM3U\n#EXTINF:6,\nsegment-1.ts', {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { 'Content-Type': 'video/mp2t' },
        }),
      );

    try {
      const result = await probePlaybackUrl(malformedProxyUrl, {
        request: new Request(
          'https://decotv.example.com/api/playback/probe',
        ),
        timeoutMs: 1000,
        mediaType: 'hls',
      });

      expect(result.status).not.toBe('failed');
      expect(result.resolvedUrl).toBe(directManifest);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('falls back to direct playback when the proxied first segment fails', async () => {
    const directManifest = 'https://decotv.example.com/upstream/movie.m3u8';
    const proxyManifest =
      'https://decotv.example.com/api/proxy/m3u8-filter?url=' +
      encodeURIComponent(directManifest);
    const proxySegment =
      'https://decotv.example.com/api/proxy/m3u8-asset?url=' +
      encodeURIComponent('https://decotv.example.com/upstream/segment-1.ts');
    const originalFetch = global.fetch;
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(`#EXTM3U\n#EXTINF:6,\n${proxySegment}`, {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        }),
      )
      .mockResolvedValueOnce(new Response('timeout', { status: 504 }))
      .mockResolvedValueOnce(
        new Response('#EXTM3U\n#EXTINF:6,\nsegment-1.ts', {
          headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 1, 2, 3]), {
          headers: { 'Content-Type': 'video/mp2t' },
        }),
      );

    try {
      const result = await probePlaybackUrl(proxyManifest, {
        request: new Request(
          'https://decotv.example.com/api/playback/probe',
        ),
        timeoutMs: 1000,
        mediaType: 'hls',
      });

      expect(result.status).not.toBe('failed');
      expect(result.resolvedUrl).toBe(directManifest);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
