export const runtime = 'nodejs';

function withCorsHeaders(headers: Headers) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Range, Origin, Accept',
  );
  headers.set(
    'Access-Control-Expose-Headers',
    'Content-Length, Content-Range, Accept-Ranges, Content-Type',
  );
}

export async function OPTIONS() {
  const headers = new Headers();
  withCorsHeaders(headers);
  return new Response(null, { status: 204, headers });
}

export async function GET(request: Request) {
  const current = new URL(request.url);
  const target = new URL('/api/proxy/m3u8', current.origin);

  for (const [key, value] of Array.from(current.searchParams.entries())) {
    target.searchParams.append(key, value);
  }

  if (!target.searchParams.has('proxyAssets')) {
    const directMedia = process.env.M3U8_DIRECT_MEDIA;
    const proxySegments = process.env.PLAYBACK_PROXY_SEGMENTS;
    target.searchParams.set(
      'proxyAssets',
      proxySegments === 'true' || proxySegments === '1'
        ? '1'
        : directMedia === 'false'
          ? '1'
          : '0',
    );
  }

  const headers = new Headers();
  withCorsHeaders(headers);
  headers.set('Cache-Control', 'no-cache');
  headers.set('Location', target.toString());
  return new Response(null, { status: 307, headers });
}
