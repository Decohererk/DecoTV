import { NextResponse } from 'next/server';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export const runtime = 'nodejs';

const IMAGE_PROXY_TIMEOUT_MS = 8000;
const IMAGE_CACHE_SECONDS = 15720000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';

function jsonError(error: string, status: number, details?: string) {
  return NextResponse.json({ error, details }, { status });
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:127.') ||
    normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.') ||
    normalized.startsWith('::ffff:169.254.')
  );
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized === 'metadata.google.internal'
  );
}

function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

async function assertPublicHttpUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http/https URLs are allowed');
  }

  if (url.username || url.password) {
    throw new Error('URLs with credentials are not allowed');
  }

  if (isBlockedHostname(url.hostname)) {
    throw new Error('Localhost and metadata hosts are blocked');
  }

  if (isIP(url.hostname)) {
    if (isPrivateAddress(url.hostname)) {
      throw new Error('Private network addresses are blocked');
    }
    return;
  }

  const resolved = await lookup(url.hostname, { all: true, verbatim: true });
  if (
    resolved.length === 0 ||
    resolved.some((item) => isPrivateAddress(item.address))
  ) {
    throw new Error('Resolved address is not public');
  }
}

async function fetchImageWithRedirects(
  url: URL,
  signal: AbortSignal,
  redirectCount = 0,
): Promise<Response> {
  if (redirectCount > 3) {
    throw new Error('Too many redirects');
  }

  const response = await fetch(url.toString(), {
    signal,
    redirect: 'manual',
    headers: {
      Referer: 'https://movie.douban.com/',
      'User-Agent': USER_AGENT,
      Accept:
        'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    },
  });

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.has('location')
  ) {
    const nextUrl = new URL(response.headers.get('location') || '', url);
    await assertPublicHttpUrl(nextUrl);
    return fetchImageWithRedirects(nextUrl, signal, redirectCount + 1);
  }

  return response;
}

function looksLikeImage(buffer: Uint8Array): boolean {
  if (buffer.length < 4) return false;

  return (
    (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) ||
    (buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47) ||
    (buffer[0] === 0x47 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x38) ||
    (buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46) ||
    (buffer[0] === 0x3c &&
      buffer[1] === 0x73 &&
      buffer[2] === 0x76 &&
      buffer[3] === 0x67)
  );
}

function rebuildStream(
  firstChunk: Uint8Array | undefined,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (firstChunk) {
        controller.enqueue(firstChunk);
      }

      const pump = (): void => {
        reader
          .read()
          .then(({ done, value }) => {
            if (done) {
              controller.close();
              return;
            }
            if (value) {
              controller.enqueue(value);
            }
            pump();
          })
          .catch((error) => controller.error(error));
      };

      pump();
    },
    cancel() {
      return reader.cancel();
    },
  });
}

// OrionTV 兼容接口
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const imageUrl = searchParams.get('url');

  if (!imageUrl) {
    return jsonError('Missing image URL', 400);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(imageUrl);
    await assertPublicHttpUrl(parsedUrl);
  } catch (error) {
    return jsonError(
      'Invalid image URL',
      400,
      error instanceof Error ? error.message : undefined,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_PROXY_TIMEOUT_MS);

  try {
    const imageResponse = await fetchImageWithRedirects(
      parsedUrl,
      controller.signal,
    );

    if (!imageResponse.ok) {
      return jsonError(
        'Upstream image request failed',
        imageResponse.status,
        imageResponse.statusText,
      );
    }

    const contentType = imageResponse.headers.get('content-type') || '';
    if (contentType && !contentType.toLowerCase().startsWith('image/')) {
      return jsonError('Upstream response is not an image', 415, contentType);
    }

    if (!imageResponse.body) {
      return jsonError('Image response has no body', 502);
    }

    const reader = imageResponse.body.getReader();
    const first = await reader.read();
    const firstChunk = first.value;

    if (!contentType && firstChunk && !looksLikeImage(firstChunk)) {
      await reader.cancel().catch(() => undefined);
      return jsonError('Upstream response is not a recognizable image', 415);
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType || 'application/octet-stream');
    headers.set(
      'Cache-Control',
      `public, max-age=${IMAGE_CACHE_SECONDS}, s-maxage=${IMAGE_CACHE_SECONDS}, immutable`,
    );
    headers.set('CDN-Cache-Control', `public, s-maxage=${IMAGE_CACHE_SECONDS}`);
    headers.set(
      'Vercel-CDN-Cache-Control',
      `public, s-maxage=${IMAGE_CACHE_SECONDS}`,
    );
    headers.set('Netlify-Vary', 'query');

    return new Response(
      rebuildStream(first.done ? undefined : firstChunk, reader),
      {
        status: 200,
        headers,
      },
    );
  } catch (error) {
    const aborted =
      error instanceof DOMException && error.name === 'AbortError';
    return jsonError(
      aborted ? 'Image proxy timeout' : 'Error fetching image',
      aborted ? 504 : 502,
      error instanceof Error ? error.message : undefined,
    );
  } finally {
    clearTimeout(timeout);
  }
}
