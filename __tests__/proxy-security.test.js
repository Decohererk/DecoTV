/* global afterEach, beforeEach, describe, expect, it, jest */

jest.mock('node:dns/promises', () => ({
  lookup: jest.fn(),
}));

const { lookup } = require('node:dns/promises');
const {
  fetchWithValidatedRedirects,
  validateProxyTargetUrl,
} = require('../src/lib/proxy-security');

const originalFetch = global.fetch;

function clearProxyEnv() {
  delete process.env.PROXY_ALLOW_PRIVATE_HOSTS;
  delete process.env.PROXY_PRIVATE_HOST_ALLOWLIST;
}

function redirectResponse(location) {
  return {
    status: 302,
    headers: new Headers({ location }),
  };
}

function okResponse() {
  return {
    status: 200,
    headers: new Headers(),
  };
}

beforeEach(() => {
  clearProxyEnv();
  lookup.mockReset();
  lookup.mockImplementation((hostname) => {
    if (hostname === 'public.example') {
      return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
    }
    if (hostname === 'nas.local') {
      return Promise.resolve([{ address: '192.168.1.10', family: 4 }]);
    }
    return Promise.resolve([{ address: '93.184.216.34', family: 4 }]);
  });
});

afterEach(() => {
  clearProxyEnv();
  jest.restoreAllMocks();
  if (originalFetch === undefined) {
    delete global.fetch;
  } else {
    global.fetch = originalFetch;
  }
});

describe('proxy target validation', () => {
  it('blocks private literal IPs by default', async () => {
    await expect(
      validateProxyTargetUrl('http://192.168.1.10/video.m3u8'),
    ).rejects.toThrow('Blocked IP address');
  });

  it('allows explicitly allowlisted private literal IPs', async () => {
    process.env.PROXY_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.PROXY_PRIVATE_HOST_ALLOWLIST = '192.168.1.10';

    await expect(
      validateProxyTargetUrl('http://192.168.1.10/video.m3u8'),
    ).resolves.toBe('http://192.168.1.10/video.m3u8');
  });

  it('blocks hostnames that resolve to private IPs by default', async () => {
    await expect(
      validateProxyTargetUrl('http://nas.local/video.m3u8'),
    ).rejects.toThrow('blocked IP address');
  });

  it('allows private resolved IPs only when the address is allowlisted', async () => {
    process.env.PROXY_ALLOW_PRIVATE_HOSTS = 'on';
    process.env.PROXY_PRIVATE_HOST_ALLOWLIST = '192.168.1.0/24';

    await expect(
      validateProxyTargetUrl('http://nas.local/video.m3u8'),
    ).resolves.toBe('http://nas.local/video.m3u8');
  });

  it('resolves allowlisted hostnames before allowing private targets', async () => {
    process.env.PROXY_ALLOW_PRIVATE_HOSTS = 'true';
    process.env.PROXY_PRIVATE_HOST_ALLOWLIST = 'nas.local';

    await expect(
      validateProxyTargetUrl('http://nas.local/video.m3u8'),
    ).resolves.toBe('http://nas.local/video.m3u8');

    expect(lookup).toHaveBeenCalledWith('nas.local', {
      all: true,
      verbatim: true,
    });
  });

  it('revalidates redirects before following them', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(redirectResponse('http://127.0.0.1/latest'))
      .mockResolvedValueOnce(okResponse());

    await expect(
      fetchWithValidatedRedirects(
        'https://public.example/playlist.m3u8',
        { method: 'GET' },
        { timeoutMs: 1000 },
      ),
    ).rejects.toThrow('Blocked IP address');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
