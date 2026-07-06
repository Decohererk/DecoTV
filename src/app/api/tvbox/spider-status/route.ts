import { NextResponse } from 'next/server';

import { getSpiderJar, getSpiderStatus } from '@/lib/spiderJar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染，避免构建时获取JAR超时

/**
 * Spider JAR 状态检查 API
 * 提供详细的 JAR 获取状态和诊断信息
 */
export async function GET() {
  try {
    const currentStatus = getSpiderStatus();

    // 强制刷新获取最新状态
    const freshJar = await getSpiderJar(true);

    const response = {
      success: true,
      timestamp: Date.now(),
      cached_status: currentStatus,
      fresh_status: {
        success: freshJar.success,
        source: freshJar.source,
        size: freshJar.size,
        md5: freshJar.md5,
        sha256: freshJar.sha256,
        tried_sources: freshJar.tried,
        is_fallback: freshJar.source === 'fallback',
        hash_verified: freshJar.hashVerified,
        remote_enabled: freshJar.remoteEnabled,
        security_mode: freshJar.securityMode,
      },
      recommendations: [] as string[],
    };

    // 提供诊断建议
    if (!freshJar.success) {
      if (freshJar.securityMode === 'fallback-only') {
        response.recommendations.push(
          '远程 JAR 默认禁用，正在使用内置备用 JAR（仅保证端点可达，不包含完整 CatVod/FongMi spider）',
        );
        response.recommendations.push(
          '如果 TVBox/影视仓配置了 csp_ 开头的 CSP 源，这些源将无法返回数据（表现为「没找到数据」或「jar 加载失败」）',
        );
        response.recommendations.push(
          '恢复方法：配置 ALLOW_REMOTE_SPIDER_JAR=true、SPIDER_JAR_URL(S) 和 SPIDER_JAR_SHA256，三项缺一不可，详见 TVBox配置优化说明.md 的迁移指南',
        );
      } else {
        response.recommendations.push(
          '已启用远程 JAR，但所有候选源均不可用或 SHA-256 不匹配，正在使用内置备用 JAR',
        );
        response.recommendations.push(
          '请检查候选地址是否可访问、SPIDER_JAR_SHA256 是否与当前 JAR 内容一致（JAR 更新后哈希会变化）',
        );
      }
    } else if (freshJar.tried > 3) {
      response.recommendations.push(
        '多个 JAR 源失败后才成功，建议检查网络稳定性',
      );
    }

    if (freshJar.source.includes('github') && freshJar.tried > 1) {
      response.recommendations.push(
        'GitHub 源访问可能受限，建议配置代理或使用国内网络',
      );
    }

    // fallback JAR 本身就很小，「强制刷新」对 fallback-only 模式没有意义
    if (freshJar.size < 50000 && freshJar.securityMode !== 'fallback-only') {
      response.recommendations.push('JAR 文件较小，可能不完整，建议强制刷新');
    }

    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 500 },
    );
  }
}

/**
 * 手动刷新 JAR 缓存
 */
export async function POST() {
  try {
    const refreshedJar = await getSpiderJar(true);

    return NextResponse.json({
      success: true,
      message: 'JAR 缓存已刷新',
      jar_status: {
        success: refreshedJar.success,
        source: refreshedJar.source,
        size: refreshedJar.size,
        md5: refreshedJar.md5,
        sha256: refreshedJar.sha256,
        tried_sources: refreshedJar.tried,
        hash_verified: refreshedJar.hashVerified,
        remote_enabled: refreshedJar.remoteEnabled,
        security_mode: refreshedJar.securityMode,
      },
      timestamp: Date.now(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: Date.now(),
      },
      { status: 500 },
    );
  }
}
