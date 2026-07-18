import { NextRequest, NextResponse } from 'next/server';

import { getSpiderJar, getSpiderJarByMd5 } from '@/lib/spiderJar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染，避免构建时超时

// Spider JAR 本地代理端点 - 使用统一的 jar 获取逻辑
export async function GET(req: NextRequest) {
  try {
    const requestedMd5 = (new URL(req.url).searchParams.get('md5') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    let jarInfo = requestedMd5 ? getSpiderJarByMd5(requestedMd5) : null;

    if (!jarInfo) {
      const currentJar = await getSpiderJar(false); // 使用缓存
      if (requestedMd5 && currentJar.md5 !== requestedMd5) {
        return NextResponse.json(
          {
            error: 'Spider JAR version unavailable',
            requestedMd5,
            currentMd5: currentJar.md5,
          },
          { status: 409 },
        );
      }
      jarInfo = currentJar;
    }

    return new NextResponse(new Uint8Array(jarInfo.buffer), {
      headers: {
        'Content-Type': 'application/java-archive',
        'Content-Length': jarInfo.size.toString(),
        'Cache-Control': 'public, max-age=3600', // 1小时缓存
        'Access-Control-Allow-Origin': '*',
        'X-Spider-Source': jarInfo.source,
        'X-Spider-Success': jarInfo.success.toString(),
        'X-Spider-Cached': jarInfo.cached.toString(),
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Proxy error',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
