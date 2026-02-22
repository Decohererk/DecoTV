import { NextRequest, NextResponse } from 'next/server';

import { getSpiderJar } from '@/lib/spiderJar';

export const runtime = 'nodejs';

// 专门的 spider.jar 服务端点
// 优化加载性能，减少 SSL handshake 错误
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get('refresh') === '1';

    const jarInfo = await getSpiderJar(forceRefresh);

    // 优化响应头，减少连接问题
    const headers = new Headers({
      'Content-Type': 'application/java-archive',
      'Content-Length': jarInfo.size.toString(),
      'Cache-Control': jarInfo.success
        ? 'public, max-age=7200'
        : 'public, max-age=300', // 成功缓存2小时，失败缓存5分钟
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
      Connection: 'close', // 避免连接复用问题
      'X-Spider-Source': jarInfo.source,
      'X-Spider-Success': jarInfo.success.toString(),
      'X-Spider-Size': jarInfo.size.toString(),
      'X-Spider-MD5': jarInfo.md5,
    });

    // 如果是 HEAD 请求，只返回头部
    if (req.method === 'HEAD') {
      return new NextResponse(null, { headers });
    }

    return new NextResponse(new Uint8Array(jarInfo.buffer), { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Spider JAR service error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

// 支持 HEAD 请求，用于检查jar可用性
export async function HEAD(req: NextRequest) {
  return GET(req);
}

// 支持 OPTIONS 请求，CORS预检
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
      'Access-Control-Max-Age': '86400',
    },
  });
}
