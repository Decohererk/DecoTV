/* global describe, expect, it */

const crypto = require('crypto');

const {
  getFallbackSpiderJarInfo,
  getSpiderJarByMd5,
} = require('../src/lib/spiderJar');

describe('TVBox spider jar identity', () => {
  it('derives the fallback md5 from the bytes that will actually be served', () => {
    const fallback = getFallbackSpiderJarInfo();
    const actualMd5 = crypto
      .createHash('md5')
      .update(fallback.buffer)
      .digest('hex');

    expect(fallback.source).toBe('fallback');
    expect(fallback.success).toBe(false);
    expect(fallback.md5).toBe(actualMd5);
    expect(fallback.size).toBe(fallback.buffer.length);
  });

  it('pins a requested fallback md5 to the same jar bytes', () => {
    const fallback = getFallbackSpiderJarInfo();
    const pinned = getSpiderJarByMd5(fallback.md5);

    expect(pinned).not.toBeNull();
    expect(pinned.md5).toBe(fallback.md5);
    expect(Buffer.compare(pinned.buffer, fallback.buffer)).toBe(0);
    expect(getSpiderJarByMd5('00000000000000000000000000000000')).toBeNull();
  });
});
