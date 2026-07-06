/* global afterEach, describe, expect, it, jest */

const {
  getFallbackSpiderJarInfo,
  getSpiderJar,
  getSpiderJarSecurityStatus,
  resetSpiderJarCacheForTests,
} = require('../src/lib/spiderJar');

const ENV_KEYS = [
  'ALLOW_REMOTE_SPIDER_JAR',
  'SPIDER_JAR_URL',
  'SPIDER_JAR_URLS',
  'SPIDER_JAR_SHA256',
  'REMOTE_SPIDER_JAR_SHA256',
];
const originalFetch = global.fetch;

function clearSpiderEnv() {
  for (const key of ENV_KEYS) {
    delete process.env[key];
  }
}

afterEach(() => {
  clearSpiderEnv();
  resetSpiderJarCacheForTests();
  jest.restoreAllMocks();
  if (originalFetch === undefined) {
    delete global.fetch;
  } else {
    global.fetch = originalFetch;
  }
});

describe('spider jar security mode', () => {
  it('uses the fallback jar by default without fetching remote URLs', async () => {
    clearSpiderEnv();
    global.fetch = jest.fn();

    const status = getSpiderJarSecurityStatus();
    const jar = await getSpiderJar(true);

    expect(status.mode).toBe('fallback-only');
    expect(status.remoteEnabled).toBe(false);
    expect(jar.success).toBe(false);
    expect(jar.source).toBe('fallback');
    expect(jar.securityMode).toBe('fallback-only');
    expect(jar.tried).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('exposes fallback jar metadata from the same bytes used by getSpiderJar', async () => {
    clearSpiderEnv();
    const fallback = getFallbackSpiderJarInfo();
    const jar = await getSpiderJar(true);

    expect(fallback.source).toBe('fallback');
    expect(fallback.md5).toBe(jar.md5);
    expect(fallback.sha256).toBe(jar.sha256);
    expect(fallback.size).toBe(jar.size);
    expect(fallback.md5).toMatch(/^[a-f0-9]{32}$/);
    expect(fallback.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fallback.size).toBeGreaterThan(0);
  });

  it('does not fetch remote URLs when remote mode lacks a pinned hash', async () => {
    clearSpiderEnv();
    process.env.ALLOW_REMOTE_SPIDER_JAR = 'true';
    process.env.SPIDER_JAR_URLS = 'https://example.com/custom_spider.jar';
    global.fetch = jest.fn();

    const status = getSpiderJarSecurityStatus();
    const jar = await getSpiderJar(true);

    expect(status.mode).toBe('fallback-only');
    expect(status.reason).toBe('missing_sha256');
    expect(status.remoteEnabled).toBe(true);
    expect(jar.success).toBe(false);
    expect(jar.remoteEnabled).toBe(true);
    expect(jar.securityMode).toBe('fallback-only');
    expect(jar.tried).toBe(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts only explicit http URLs without credentials for pinned remote mode', () => {
    clearSpiderEnv();
    process.env.ALLOW_REMOTE_SPIDER_JAR = 'yes';
    process.env.SPIDER_JAR_URLS = [
      'https://example.com/custom_spider.jar',
      'ftp://example.com/ignored.jar',
      'https://user:pass@example.com/ignored.jar',
      'https://example.com/custom_spider.jar',
    ].join(',');
    process.env.SPIDER_JAR_SHA256 = `sha256:${'a'.repeat(64)}`;

    const status = getSpiderJarSecurityStatus();

    expect(status.mode).toBe('remote-pinned');
    expect(status.hashConfigured).toBe(true);
    expect(status.candidateCount).toBe(1);
    expect(status.candidates).toEqual([
      'https://example.com/custom_spider.jar',
    ]);
    expect(status.expectedSha256).toBe('a'.repeat(64));
  });
});
