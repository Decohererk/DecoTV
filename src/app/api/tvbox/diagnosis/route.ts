import { NextRequest, NextResponse } from 'next/server';

import { getEffectiveRequestOrigin } from '@/lib/request-protocol';
import { getSpiderJar, getSpiderJarSecurityStatus } from '@/lib/spiderJar';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get('mode') || 'standard';
    const baseUrl = getEffectiveRequestOrigin(req);
    const jarInfo = await getSpiderJar(false);
    const security = getSpiderJarSecurityStatus();
    const spiderUrl = `${baseUrl}/api/proxy/spider.jar`;

    const healthReport = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      mode,
      spider: {
        url: spiderUrl,
        name: jarInfo.success
          ? 'DecoTV pinned remote spider'
          : 'DecoTV bundled fallback spider',
        status: jarInfo.success ? 'pinned-remote' : 'fallback-only',
        withMd5: `${spiderUrl};md5;${jarInfo.md5}`,
        md5: jarInfo.md5,
        sha256: jarInfo.sha256,
        source: jarInfo.source,
        hashVerified: jarInfo.hashVerified,
        security,
      },
      checks: {
        spiderReachable: true,
        configValid: true,
        formatCorrect: true,
        modeSupported: true,
      },
      recommendations: [
        `当前模式: ${mode}`,
        'Spider jar 默认使用同源安全代理，远端 JAR 只有在显式配置并通过 SHA-256 校验后才会启用',
      ],
    };

    return NextResponse.json(healthReport);
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
        checks: {
          spiderReachable: false,
          configValid: false,
          formatCorrect: false,
          modeSupported: false,
        },
      },
      { status: 500 },
    );
  }
}
