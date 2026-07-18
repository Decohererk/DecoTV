/**
 * @jest-environment node
 */
/* global afterEach, describe, expect, it, jest */

jest.mock('@/lib/auth', () => ({
  verifyApiAuth: jest.fn(() => ({ isValid: true })),
}));

jest.mock('@/lib/private-library', () => ({
  resolveStreamRequest: jest.fn(),
  toPrivateLibraryErrorMessage: jest.fn(() => 'stream error'),
}));

const {
  resolveStreamRequest,
} = require('../src/lib/private-library');
const { GET } = require('../src/app/api/private-library/stream/route');

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

describe('private library stream auth refresh', () => {
  it('refreshes a renewable media-server session once after 401', async () => {
    resolveStreamRequest
      .mockResolvedValueOnce({
        url: 'http://jellyfin.example.com/stale-stream',
        headers: { 'X-Emby-Token': 'stale-token' },
        canRefreshAuth: true,
      })
      .mockResolvedValueOnce({
        url: 'http://jellyfin.example.com/fresh-stream',
        headers: { 'X-Emby-Token': 'fresh-token' },
        canRefreshAuth: true,
      });
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(new Uint8Array([0, 1, 2, 3]), {
          status: 206,
          headers: { 'Content-Type': 'video/mp4' },
        }),
      );

    const { NextRequest } = require('next/server');
    const response = await GET(
      new NextRequest(
        'http://localhost/api/private-library/stream?connectorId=jellyfin-main&sourceItemId=episode-1',
      ),
    );

    expect(response.status).toBe(206);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(resolveStreamRequest).toHaveBeenNthCalledWith(
      2,
      'jellyfin-main',
      'episode-1',
      undefined,
      { forceRefreshAuth: true },
    );
  });
});
