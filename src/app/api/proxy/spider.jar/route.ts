import { NextRequest, NextResponse } from 'next/server';

import { getSpiderJar } from '@/lib/spiderJar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染，避免构建时超时

// Spider JAR 本地代理端点 - 使用统一的 jar 获取逻辑
export async function GET(_req: NextRequest) {
  try {
    const jarInfo = await getSpiderJar(false); // 使用缓存

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
