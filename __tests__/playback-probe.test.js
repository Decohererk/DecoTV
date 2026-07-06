/* global beforeEach, describe, expect, it, jest */

jest.mock('../src/lib/proxy-security', () => ({
  fetchWithValidatedRedirects: jest.fn(),
  normalizeHeaderUrl: jest.fn((value) => {
    if (!value) return undefined;
    try {
      const parsed = new URL(value);
      return parsed.toString();
    } catch {
      return undefined;
    }
  }),
  validateProxyTargetUrl: jest.fn((value) => Promise.resolve(value)),
}));

const {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} = require('../src/lib/proxy-security');
const { TextDecoder, TextEncoder } = require('util');

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;

const {
  inspectHlsPlaylist,
  probePlaybackUrl,
} = require('../src/lib/playback-probe');

function requestLike(url, headers = {}) {
  return {
    headers: new Headers(headers),
    url,
  };
}

function bodyFromBuffer(buffer) {
  return {
    getReader() {
      let consumed = false;
      return {
        async read() {
          if (consumed) return { done: true };
          consumed = true;
          return { done: false, value: buffer };
        },
        async cancel() {},
      };
    },
    async cancel() {},
  };
}

function textResponse(body, init = {}) {
  return {
    ok: init.status ? init.status >= 200 && init.status < 300 : true,
    status: init.status || 200,
    statusText: init.statusText || 'OK',
    url: init.url || '',
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') {
          return init.contentType || 'application/vnd.apple.mpegurl';
        }
        if (name.toLowerCase() === 'content-length') {
          return String(Buffer.byteLength(body));
        }
        return '';
      },
    },
    body: bodyFromBuffer(Buffer.from(body, 'utf8')),
  };
}

function bytesResponse(size, init = {}) {
  return {
    ok: true,
    status: init.status || 206,
    statusText: 'Partial Content',
    url: init.url || '',
    headers: {
      get(name) {
        if (name.toLowerCase() === 'content-type') {
          return init.contentType || 'video/mp2t';
        }
        if (name.toLowerCase() === 'content-length') {
          return String(size);
        }
        return '';
      },
    },
    body: bodyFromBuffer(Buffer.alloc(size, 1)),
  };
}

describe('playback probe fetch retries', () => {
  beforeEach(() => {
    fetchWithValidatedRedirects.mockReset();
    validateProxyTargetUrl.mockClear();
    validateProxyTargetUrl.mockImplementation((value) =>
      Promise.resolve(value),
    );
  });

  it('retries blocked HLS playlists with URL-derived referer headers', async () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6,',
      'seg-0001.ts',
    ].join('\n');

    fetchWithValidatedRedirects.mockImplementation((url, init) => {
      if (String(url).endsWith('/seg-0001.ts')) {
        return Promise.resolve(
          bytesResponse(64 * 1024, {
            url: 'https://cdn.example.com/movie/seg-0001.ts',
          }),
        );
      }

      if (init.headers.get('Referer') === 'https://cdn.example.com/') {
        return Promise.resolve(
          textResponse(playlist, {
            url: 'https://cdn.example.com/movie/index.m3u8',
          }),
        );
      }

      return Promise.resolve(textResponse('Forbidden', { status: 403 }));
    });

    const result = await probePlaybackUrl(
      'https://cdn.example.com/movie/index.m3u8',
      {
        request: requestLike('https://tv.example.com/api/playback/probe', {
          host: 'tv.example.com',
          'user-agent': 'Mozilla/5.0 test browser',
        }),
        timeoutMs: 8000,
        mediaType: 'hls',
      },
    );

    expect(result.status).toBe('ok');
    expect(result.speedKBps).toBeGreaterThan(0);
    expect(
      fetchWithValidatedRedirects.mock.calls.some(
        (call) => call[1].headers.get('Referer') === 'https://cdn.example.com/',
      ),
    ).toBe(true);
  });

  it('reports a positive speed when the probe read finishes within one millisecond', async () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1720000000000);

    try {
      fetchWithValidatedRedirects.mockImplementation(() =>
        Promise.resolve(
          bytesResponse(64 * 1024, {
            url: 'https://cdn.example.com/movie/file.mp4',
            contentType: 'video/mp4',
          }),
        ),
      );

      const result = await probePlaybackUrl(
        'https://cdn.example.com/movie/file.mp4',
        {
          request: requestLike('https://tv.example.com/api/playback/probe', {
            host: 'tv.example.com',
            'user-agent': 'Mozilla/5.0 test browser',
          }),
          timeoutMs: 8000,
          mediaType: 'file',
        },
      );

      expect(result.status).toBe('ok');
      expect(result.speedKBps).toBeGreaterThan(0);
      expect(Number.isFinite(result.speedKBps)).toBe(true);
    } finally {
      nowSpy.mockRestore();
    }
  });
});

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
