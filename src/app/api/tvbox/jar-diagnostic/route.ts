import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { fetchWithValidatedRedirects } from '@/lib/proxy-security';
import { getSpiderJarSecurityStatus } from '@/lib/spiderJar';

const MAX_DIAGNOSTIC_JAR_BYTES = 20 * 1024 * 1024;

interface JarTestResult {
  url: string;
  status: 'success' | 'failed' | 'timeout' | 'invalid';
  responseTime: number;
  fileSize?: number;
  httpStatus?: number;
  error?: string;
  headers?: Record<string, string>;
  isValidJar?: boolean;
  sha256?: string;
  hashMatches?: boolean;
}

interface DiagnosticReport {
  timestamp: string;
  security: ReturnType<typeof getSpiderJarSecurityStatus>;
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

function hashSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function testJarSource(
  url: string,
  expectedSha256: string,
): Promise<JarTestResult> {
  const startTime = Date.now();
  const result: JarTestResult = {
    url,
    status: 'failed',
    responseTime: 0,
  };

  try {
    const response = await fetchWithValidatedRedirects(
      url,
      {
        method: 'GET',
        headers: {
          Accept: 'application/java-archive, application/zip, */*',
          'Accept-Encoding': 'identity',
          'Cache-Control': 'no-cache',
          Connection: 'close',
          'User-Agent': 'DecoTV/1.5 spider-jar-diagnostic',
        },
      },
      { timeoutMs: 10000, maxRedirects: 3 },
    );

    result.responseTime = Date.now() - startTime;
    result.httpStatus = response.status;
    result.headers = {};
    response.headers.forEach((value, key) => {
      if (result.headers) result.headers[key] = value;
    });

    if (!response.ok) {
      result.status = 'failed';
      result.error = `HTTP ${response.status}: ${response.statusText}`;
      return result;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_DIAGNOSTIC_JAR_BYTES) {
      result.status = 'invalid';
      result.error = `File too large: ${contentLength} bytes`;
      return result;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    result.fileSize = buffer.length;

    if (buffer.length < 1000 || buffer.length > MAX_DIAGNOSTIC_JAR_BYTES) {
      result.status = 'invalid';
      result.error = `Unexpected file size: ${buffer.length} bytes`;
      return result;
    }

    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
      result.status = 'invalid';
      result.error = 'Invalid JAR file format (not a ZIP file)';
      result.isValidJar = false;
      return result;
    }

    result.isValidJar = true;
    result.sha256 = hashSha256(buffer);
    result.hashMatches = result.sha256 === expectedSha256;
    result.status = result.hashMatches ? 'success' : 'invalid';
    if (!result.hashMatches) {
      result.error = 'SHA-256 does not match SPIDER_JAR_SHA256';
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

function detectEnvironment(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || '';
  const acceptLanguage = request.headers.get('accept-language') || '';
  const cfIpCountry = request.headers.get('cf-ipcountry') || '';
  const xForwardedFor = request.headers.get('x-forwarded-for') || '';

  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Fallback to UTC if timezone detection fails.
  }

  const isChinaTimezone =
    timezone.includes('Asia/Shanghai') ||
    timezone.includes('Asia/Chongqing') ||
    timezone.includes('Asia/Beijing') ||
    timezone.includes('Asia/Urumqi');

  const isChinaLanguage =
    acceptLanguage.includes('zh-CN') || acceptLanguage.includes('zh-Hans');

  const isChinaIP = cfIpCountry === 'CN';
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

function buildReport(
  request: NextRequest,
  jarTests: JarTestResult[],
  recommendations: string[],
): DiagnosticReport {
  const env = detectEnvironment(request);
  const security = getSpiderJarSecurityStatus();
  const successResults = jarTests.filter((r) => r.status === 'success');
  const failedResults = jarTests.filter((r) => r.status !== 'success');
  const fastest = [...successResults].sort(
    (a, b) => a.responseTime - b.responseTime,
  )[0];

  return {
    timestamp: new Date().toISOString(),
    security,
    environment: {
      ...env,
      recommendedSources: security.candidates.slice(0, 5),
    },
    jarTests,
    summary: {
      totalTested: jarTests.length,
      successCount: successResults.length,
      failedCount: failedResults.length,
      averageResponseTime:
        jarTests.length === 0
          ? 0
          : jarTests.reduce((sum, r) => sum + r.responseTime, 0) /
            jarTests.length,
      fastestSource: fastest?.url,
      recommendedSource: successResults[0]?.url,
    },
    recommendations,
  };
}

export async function GET(request: NextRequest) {
  const security = getSpiderJarSecurityStatus();

  if (security.mode !== 'remote-pinned' || !security.expectedSha256) {
    const recommendations = [
      'Remote spider.jar fetching is disabled by default.',
      `Current mode: ${security.mode}`,
      `Reason: ${security.reason || 'not_ready'}`,
      `To enable it, set ${security.env.enable}=true, ${security.env.urls}, and ${security.env.sha256}.`,
    ];

    return NextResponse.json(buildReport(request, [], recommendations), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }

  const concurrency = 2;
  const results: JarTestResult[] = [];
  const expectedSha256 = security.expectedSha256 || '';

  for (let i = 0; i < security.candidates.length; i += concurrency) {
    const batch = security.candidates.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map((url) => testJarSource(url, expectedSha256)),
    );
    results.push(...batchResults);
  }

  const successResults = results.filter((r) => r.status === 'success');
  const failedResults = results.filter((r) => r.status !== 'success');
  const fastestSource = [...successResults].sort(
    (a, b) => a.responseTime - b.responseTime,
  )[0]?.url;
  const recommendations: string[] = [];

  if (successResults.length === 0) {
    recommendations.push(
      'No configured spider.jar source matched SPIDER_JAR_SHA256.',
    );
    recommendations.push(
      'Keep remote spider.jar disabled until the hash is fixed.',
    );
  } else {
    recommendations.push(
      'At least one configured spider.jar source is pinned and valid.',
    );
    if (fastestSource) recommendations.push(`Fastest source: ${fastestSource}`);
  }

  if (failedResults.length > 0) {
    recommendations.push(
      `${failedResults.length} configured source(s) failed validation or were unreachable.`,
    );
  }

  return NextResponse.json(buildReport(request, results, recommendations), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
