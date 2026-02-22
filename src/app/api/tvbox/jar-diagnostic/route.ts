import { NextRequest, NextResponse } from 'next/server';

/**
 * TVBox JAR 深度诊断 API
 * 提供详细的 JAR 源测试报告和网络环境分析
 */

interface JarTestResult {
  url: string;
  status: 'success' | 'failed' | 'timeout' | 'invalid';
  responseTime: number;
  fileSize?: number;
  httpStatus?: number;
  error?: string;
  headers?: Record<string, string>;
  isValidJar?: boolean;
  md5?: string;
}

interface DiagnosticReport {
  timestamp: string;
  environment: {
    userAgent: string;
    ip?: string;
    timezone: string;
    isDomestic: boolean;
    recommendedSources: string[];
  };
  jarTests: JarTestResult[];
  summary: {
    totalTested: number;
    successCount: number;
    failedCount: number;
    averageResponseTime: number;
    fastestSource?: string;
    recommendedSource?: string;
  };
  recommendations: string[];
}

// JAR 源配置（使用真实可用的源）
const JAR_SOURCES = {
  domestic: [
    'https://agit.ai/Yoursmile7/TVBox/raw/branch/master/jar/custom_spider.jar',
    'https://ghproxy.net/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://mirror.ghproxy.com/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://gh-proxy.com/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://ghps.cc/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://raw.gitmirror.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://ghproxy.cc/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://gh.api.99988866.xyz/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
  ],
  international: [
    'https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://raw.gitmirror.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://ghproxy.cc/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
  ],
  proxy: [
    'https://gh-proxy.com/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://ghps.cc/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://gh.api.99988866.xyz/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
    'https://ghproxy.net/https://raw.githubusercontent.com/FongMi/CatVodSpider/main/jar/custom_spider.jar',
  ],
};

// 测试单个 JAR 源
async function testJarSource(url: string): Promise<JarTestResult> {
  const startTime = Date.now();
  const result: JarTestResult = {
    url,
    status: 'failed',
    responseTime: 0,
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    // 优化请求头
    const headers: Record<string, string> = {
      Accept: '*/*',
      'Accept-Encoding': 'identity',
      'Cache-Control': 'no-cache',
      Connection: 'close',
    };

    if (url.includes('github') || url.includes('raw.githubusercontent')) {
      headers['User-Agent'] = 'curl/7.68.0';
    } else if (url.includes('gitee') || url.includes('gitcode')) {
      headers['User-Agent'] =
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    } else {
      headers['User-Agent'] =
        'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 Mobile Safari/537.36';
    }

    const response = await fetch(url, {
      method: 'HEAD', // 先用 HEAD 请求测试可达性
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });

    clearTimeout(timeout);
    result.responseTime = Date.now() - startTime;
    result.httpStatus = response.status;

    // 收集响应头信息
    result.headers = {};
    response.headers.forEach((value, key) => {
      if (result.headers) result.headers[key] = value;
    });

    if (!response.ok) {
      result.status = 'failed';
      result.error = `HTTP ${response.status}: ${response.statusText}`;
      return result;
    }

    // 检查文件大小
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
      result.fileSize = parseInt(contentLength, 10);
      if (result.fileSize < 1000) {
        result.status = 'invalid';
        result.error = `File too small: ${result.fileSize} bytes`;
        return result;
      }
    }

    // 如果 HEAD 成功，尝试获取部分内容验证
    const verifyController = new AbortController();
    const verifyTimeout = setTimeout(() => verifyController.abort(), 5000);

    const verifyResponse = await fetch(url, {
      method: 'GET',
      signal: verifyController.signal,
      headers: {
        ...headers,
        Range: 'bytes=0-1023', // 只获取前 1KB
      },
    });

    clearTimeout(verifyTimeout);

    if (verifyResponse.ok) {
      const buffer = await verifyResponse.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // 验证 JAR 文件头（ZIP 格式）
      if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
        result.isValidJar = true;
        result.status = 'success';

        // 计算 MD5（只对前 1KB）
        const crypto = await import('crypto');
        result.md5 = crypto
          .createHash('md5')
          .update(Buffer.from(buffer))
          .digest('hex')
          .substring(0, 8);
      } else {
        result.status = 'invalid';
        result.error = 'Invalid JAR file format (not a ZIP file)';
        result.isValidJar = false;
      }
    }

    return result;
  } catch (error: unknown) {
    result.responseTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        result.status = 'timeout';
        result.error = `Timeout after ${result.responseTime}ms`;
      } else {
        result.status = 'failed';
        result.error = error.message;
      }
    } else {
      result.status = 'failed';
      result.error = 'Unknown error';
    }

    return result;
  }
}

// 检测网络环境
function detectEnvironment(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  const acceptLanguage = request.headers.get('accept-language') || '';
  const cfIpCountry = request.headers.get('cf-ipcountry') || '';
  const xForwardedFor = request.headers.get('x-forwarded-for') || '';

  // 获取时区
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback to UTC if timezone detection fails
  }

  // 多维度检测国内环境
  const isChinaTimezone =
    timezone.includes('Asia/Shanghai') ||
    timezone.includes('Asia/Chongqing') ||
    timezone.includes('Asia/Beijing') ||
    timezone.includes('Asia/Urumqi');

  const isChinaLanguage =
    acceptLanguage.includes('zh-CN') || acceptLanguage.includes('zh-Hans');

  const isChinaIP = cfIpCountry === 'CN';

  // 综合判断（满足任意两个条件即认为是国内）
  const isDomestic =
    [isChinaTimezone, isChinaLanguage, isChinaIP].filter(Boolean).length >= 2;

  return {
    userAgent,
    timezone,
    isDomestic,
    detectionDetails: {
      timezone: isChinaTimezone ? '中国时区' : '非中国时区',
      language: isChinaLanguage ? '中文语言' : '其他语言',
      ipCountry: cfIpCountry || '未知',
      forwardedIp: xForwardedFor || '未知',
    },
  };
}

export async function GET(request: NextRequest) {
  const env = detectEnvironment(request);

  // 根据环境选择测试源
  const testSources = env.isDomestic
    ? [
        ...JAR_SOURCES.domestic,
        ...JAR_SOURCES.international.slice(0, 3),
        ...JAR_SOURCES.proxy.slice(0, 2),
      ]
    : [
        ...JAR_SOURCES.international,
        ...JAR_SOURCES.proxy.slice(0, 2),
        ...JAR_SOURCES.domestic.slice(0, 3),
      ];

  // eslint-disable-next-line no-console
  console.log(
    `🔍 开始 JAR 源诊断测试，环境: ${env.isDomestic ? '国内' : '国际'}`,
  );

  // 并发测试所有源（但限制并发数）
  const concurrency = 5;
  const results: JarTestResult[] = [];

  for (let i = 0; i < testSources.length; i += concurrency) {
    const batch = testSources.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(testJarSource));
    results.push(...batchResults);

    // eslint-disable-next-line no-console
    console.log(`✅ 完成批次 ${Math.floor(i / concurrency) + 1}`);
  }

  // 分析结果
  const successResults = results.filter((r) => r.status === 'success');
  const failedResults = results.filter((r) => r.status !== 'success');

  const summary = {
    totalTested: results.length,
    successCount: successResults.length,
    failedCount: failedResults.length,
    averageResponseTime:
      results.reduce((sum, r) => sum + r.responseTime, 0) / results.length,
    fastestSource: successResults.sort(
      (a, b) => a.responseTime - b.responseTime,
    )[0]?.url,
    recommendedSource: successResults[0]?.url,
  };

  // 生成推荐
  const recommendations: string[] = [];

  if (successResults.length === 0) {
    recommendations.push('❌ 所有 JAR 源均不可用，请检查网络环境');
    recommendations.push('');
    recommendations.push('🔧 诊断建议：');
    recommendations.push('  1. 检查网络连接是否正常');
    recommendations.push('  2. 检查防火墙或代理设置');
    recommendations.push('  3. 尝试切换网络（WiFi/移动数据）');
    recommendations.push('  4. 如在国内，建议使用代理或VPN');
    recommendations.push(
      '  5. DNS 解析可能存在问题，尝试更换DNS（如 8.8.8.8）',
    );
    recommendations.push('');
    recommendations.push('💡 如果您在国内，GitHub 资源访问受限是正常现象');
  } else if (successResults.length < 3) {
    recommendations.push('⚠️ 网络环境不佳，只有少数源可用');
    recommendations.push('');
    recommendations.push(`✅ 推荐使用最快源: ${summary.fastestSource}`);
    recommendations.push(`   响应时间: ${successResults[0]?.responseTime}ms`);
    recommendations.push('');
    recommendations.push('💡 优化建议：');
    if (env.isDomestic) {
      recommendations.push('  • 检测到您在国内，建议优先使用镜像源');
      recommendations.push('  • 可尝试使用 VPN 或代理改善访问速度');
    } else {
      recommendations.push('  • 检测到您在海外，建议优先使用国际源');
    }
  } else {
    recommendations.push('✅ 网络环境良好，多个 JAR 源可用');
    recommendations.push('');
    recommendations.push(`⚡ 最快源: ${summary.fastestSource}`);
    recommendations.push(`   响应时间: ${successResults[0]?.responseTime}ms`);
    recommendations.push('');
    recommendations.push(`🎯 推荐源: ${summary.recommendedSource}`);
    if (env.isDomestic) {
      recommendations.push('');
      recommendations.push('💡 您在国内，已自动优先测试镜像源');
    }
  }

  // 分析失败原因
  const timeouts = failedResults.filter((r) => r.status === 'timeout').length;
  const httpErrors = failedResults.filter(
    (r) => r.httpStatus && (r.httpStatus === 403 || r.httpStatus === 404),
  ).length;
  const invalidJars = failedResults.filter(
    (r) => r.status === 'invalid',
  ).length;

  if (timeouts > 0 || httpErrors > 0 || invalidJars > 0) {
    recommendations.push('');
    recommendations.push('📊 问题分析：');
  }

  if (timeouts > 0) {
    recommendations.push(`  • ${timeouts} 个源超时 - 网络延迟较高或源不可达`);
  }
  if (httpErrors > 0) {
    recommendations.push(
      `  • ${httpErrors} 个源返回 HTTP 错误（403/404） - 源文件可能已失效或被限制访问`,
    );
    recommendations.push('    建议：这些源可能需要代理或已下线，请避免使用');
  }
  if (invalidJars > 0) {
    recommendations.push(
      `  • ${invalidJars} 个源返回无效 JAR 文件 - 文件格式错误或已损坏`,
    );
  }

  // 网络环境提示
  recommendations.push('');
  recommendations.push('🌐 网络环境检测：');
  recommendations.push(`  • 时区: ${env.timezone}`);
  recommendations.push(
    `  • 判定环境: ${env.isDomestic ? '🇨🇳 国内' : '🌍 海外'}`,
  );
  if (env.detectionDetails) {
    recommendations.push(`  • 时区判定: ${env.detectionDetails.timezone}`);
    recommendations.push(`  • 语言判定: ${env.detectionDetails.language}`);
    if (
      env.detectionDetails.ipCountry &&
      env.detectionDetails.ipCountry !== '未知'
    ) {
      recommendations.push(`  • IP 国家: ${env.detectionDetails.ipCountry}`);
    }
  }

  const report: DiagnosticReport = {
    timestamp: new Date().toISOString(),
    environment: {
      ...env,
      recommendedSources: testSources.slice(0, 5),
    },
    jarTests: results,
    summary,
    recommendations,
  };

  return NextResponse.json(report, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
