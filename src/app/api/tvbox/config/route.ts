/* eslint-disable @typescript-eslint/no-explicit-any, no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { getEffectiveRequestOrigin } from '@/lib/request-protocol';
import {
  getFallbackSpiderJarInfo,
  getSpiderJar,
  getSpiderJarSecurityStatus,
} from '@/lib/spiderJar';
import {
  buildResolutionFilterFromSearchParams,
  formatResolutionLabel,
  serializeResolutionFilter,
} from '@/lib/video-quality';

// ================= Spider 公共可达 & 回退缓存逻辑 =================
// 目的：避免出现 “spider url is private/not public” & 404 问题
// 策略：
// 1. 永远优先返回【公网可直接访问】的远程 jar 地址（不用 localhost / 内网 IP）
// 2. 多源顺序探测（HEAD/快速 GET），成功后缓存 30 分钟，减少频繁探测
// 3. 探测失败时，仍然返回第一个候选（保证字段存在），并附加 ;fail 方便诊断
// 4. 可通过 ?forceSpiderRefresh=1 强制刷新缓存
// 5. 若用户仍需要本地代理，在 admin 面板单独展示“备用代理地址”而不是写入 spider 主字段

// 内网 / 私网 host 判定（TVBox 体检会标记为 private/not public 的几类）
function isPrivateHost(host: string): boolean {
  if (!host) return true;
  const lower = host.toLowerCase();
  return (
    lower.startsWith('localhost') ||
    lower.startsWith('127.') ||
    lower.startsWith('0.0.0.0') ||
    lower.startsWith('10.') ||
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(lower) ||
    lower.startsWith('192.168.') ||
    lower === '::1'
  );
}

function getRequestBaseUrl(req: NextRequest): string {
  const envBase = (process.env.NEXT_PUBLIC_SITE_BASE || '')
    .trim()
    .replace(/\/$/, '');
  if (envBase) return envBase;

  return getEffectiveRequestOrigin(req);
}

function resolveClientRegion(req: NextRequest, searchParams: URLSearchParams) {
  const explicit = (
    searchParams.get('region') ||
    searchParams.get('area') ||
    searchParams.get('jarRegion') ||
    ''
  )
    .trim()
    .toLowerCase();

  if (
    ['intl', 'global', 'oversea', 'overseas', 'international'].includes(
      explicit,
    )
  ) {
    return 'international';
  }
  if (['cn', 'china', 'domestic', 'mainland'].includes(explicit)) {
    return 'domestic';
  }

  const acceptLanguage = req.headers.get('accept-language') || '';
  const userAgent = req.headers.get('user-agent') || '';

  if (acceptLanguage.includes('zh-CN') || userAgent.includes('zh-CN')) {
    return 'domestic';
  }

  // TVBox/影视仓客户端常常不带语言和真实地区信息。项目面向中文源，
  // 默认国内优先比使用 Vercel/部署机房位置更符合客户端可达性。
  return 'domestic';
}

function isAllowedPinnedSpiderUrl(
  rawSpiderUrl: string,
  allowedCandidates: string[],
): boolean {
  try {
    const cleanUrl = rawSpiderUrl.split(';')[0];
    const parsed = new URL(cleanUrl);
    if (isPrivateHost(parsed.hostname)) return false;
    return allowedCandidates.includes(parsed.toString());
  } catch {
    return false;
  }
}

// 旧 spider 探测与缓存逻辑已被 getSpiderJar 取代（保留候选常量供文档或 UI 展示）

// 旧的 selectPublicSpider 已被新的 getSpiderJar 方案取代，保留状态结构供兼容（不再调用）

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic'; // 强制动态渲染，避免构建时获取JAR超时

// TVBox 订阅格式 - 标准 TVBox/猫影视 格式
// 参考: TVBox 官方格式规范

/**
 * 智能检测 API 类型
 * 0: MacCMS XML格式 (标准苹果CMS XML接口)
 * 1: MacCMS JSON格式 (标准苹果CMS JSON接口)
 * 3: CSP源 (Custom Spider Plugin)
 */
function detectApiType(api: string): number {
  const url = api.toLowerCase().trim();

  // CSP 源（插件源，优先判断）
  if (url.startsWith('csp_')) return 3;

  // XML 采集接口 - 更精确匹配
  if (
    url.includes('.xml') ||
    url.includes('xml.php') ||
    url.includes('api.php/provide/vod/at/xml') ||
    url.includes('provide/vod/at/xml') ||
    (url.includes('maccms') && url.includes('xml'))
  ) {
    return 0;
  }

  // JSON 采集接口 - 标准苹果CMS格式
  if (
    url.includes('.json') ||
    url.includes('json.php') ||
    url.includes('api.php/provide/vod') ||
    url.includes('provide/vod') ||
    url.includes('api.php') ||
    url.includes('maccms') ||
    url.includes('/api/') ||
    url.match(/\/provide.*vod/) ||
    url.match(/\/api.*vod/)
  ) {
    return 1;
  }

  // 默认为JSON类型（苹果CMS最常见）
  return 1;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams, href } = new URL(req.url);
    const format = searchParams.get('format') || 'json';
    const mode = (searchParams.get('mode') || '').toLowerCase(); // 可选: safe|min|yingshicang

    // 🔒 成人内容过滤参数
    const filterParam = searchParams.get('filter'); // on|off
    const adultParam = searchParams.get('adult'); // 0|1

    // 🎯 智能搜索代理控制（默认启用）
    const proxyParam = searchParams.get('proxy'); // off 表示禁用代理，直连原始API
    const useSmartProxy = proxyParam !== 'off' && proxyParam !== 'disable'; // 默认启用
    const resolutionFilter =
      buildResolutionFilterFromSearchParams(searchParams);
    const serializedResolutionFilter =
      serializeResolutionFilter(resolutionFilter);

    console.log(
      '[TVBox] request:',
      href,
      'format:',
      format,
      'mode:',
      mode,
      'filter:',
      filterParam,
      'proxy:',
      useSmartProxy,
      'minResolution:',
      resolutionFilter.minLevel
        ? formatResolutionLabel(resolutionFilter.minLevel)
        : 'off',
    );

    const cfg = await getConfig();
    const baseUrl = getRequestBaseUrl(req);
    const jarMode = (
      searchParams.get('jar') ||
      searchParams.get('jarMode') ||
      ''
    )
      .trim()
      .toLowerCase();
    const spiderSecurity = getSpiderJarSecurityStatus();

    // 🛡️ 纵深防御 Layer 1: 配置接口严格过滤
    // 确定是否应该过滤成人内容
    // 核心逻辑：只有显式传入 filter=off 才允许成人内容
    // 默认情况（无参数）= 严格安全模式
    let shouldFilterAdult = true; // 默认严格过滤

    // 只有显式传入 filter=off 才关闭过滤
    if (filterParam === 'off' || filterParam === 'disable') {
      shouldFilterAdult = false; // 禁用过滤 = 显示成人内容
      console.log(
        '[TVBox] ⚠️ Adult filter DISABLED by explicit filter=off parameter',
      );
    } else if (adultParam === '1' || adultParam === 'true') {
      shouldFilterAdult = false; // 显式启用成人内容
      console.log(
        '[TVBox] ⚠️ Adult filter DISABLED by explicit adult=1 parameter',
      );
    } else {
      // 其他所有情况（包括无参数）都启用过滤
      console.log('[TVBox] 🔒 Adult filter ENABLED (strict safe mode)');
    }

    const forceSpiderRefresh = searchParams.get('forceSpiderRefresh') === '1';

    // 高可用 JAR 策略：智能选择 + 多重备选 + 错误处理 + 超时控制
    let jarInfo;
    try {
      // 添加 3 秒超时限制，避免 OrionTV 等待过久
      jarInfo = await Promise.race([
        getSpiderJar(forceSpiderRefresh),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Spider JAR timeout')), 3000),
        ),
      ]);
    } catch (err) {
      console.warn('[TVBox] Spider JAR fetch timeout/failed:', err);
      jarInfo = getFallbackSpiderJarInfo();
    }

    const sameOriginSpiderJar = `${baseUrl}/api/proxy/spider.jar;md5;${jarInfo.md5}`;
    const usePinnedRemoteSpider =
      (jarMode === 'remote' || jarMode === 'direct') &&
      jarInfo.success &&
      jarInfo.source !== 'fallback' &&
      jarInfo.hashVerified;
    let globalSpiderJar = usePinnedRemoteSpider
      ? `${jarInfo.source};md5;${jarInfo.md5}`
      : sameOriginSpiderJar;

    // 🔒 根据过滤设置筛选视频源
    let sourcesToUse = (cfg.SourceConfig || []).filter((s) => !s.disabled);

    // 🚨 成人内容过滤：仅依据显式标记 is_adult === true
    // 注意：不再使用关键词推断，避免误伤正常源
    if (shouldFilterAdult) {
      const beforeCount = sourcesToUse.length;

      // 仅检查显式标记 is_adult === true，不做任何模糊推测
      sourcesToUse = sourcesToUse.filter((s) => {
        if (s.is_adult === true) {
          console.log(
            `[TVBox] 🚨 Filtered by is_adult flag: ${s.key} (${s.name})`,
          );
          return false;
        }
        return true;
      });

      const filteredCount = beforeCount - sourcesToUse.length;
      console.log(
        `[TVBox] ✅ Adult filter (explicit only): ${filteredCount} sources removed, ${sourcesToUse.length} remaining`,
      );
    } else {
      console.log(
        `[TVBox] ⚠️ Adult filter disabled, returning all ${sourcesToUse.length} sources`,
      );
    }

    const sourceSites = sourcesToUse.map((s) => {
      const apiType = detectApiType(s.api);
      const site: any = {
        key: s.key,
        name: s.name,
        type: apiType,
        api: s.api,
        // 根据API类型优化配置
        searchable: apiType === 3 ? 1 : 1, // CSP源通常支持搜索
        quickSearch: apiType === 3 ? 1 : 1, // 快速搜索
        filterable: apiType === 3 ? 1 : 1, // 筛选功能
        changeable: 1, // 允许换源
      };

      // 🎯 默认启用智能搜索代理（解决TVBox搜索不精确问题）
      // 只代理普通采集源（type 0, 1），CSP源保持原样
      if (useSmartProxy && (apiType === 0 || apiType === 1)) {
        // 保存原始API供代理使用
        site.original_api = site.api;

        const proxySearchParams = new URLSearchParams({
          source: s.key,
          filter: shouldFilterAdult ? 'on' : 'off',
          ...serializedResolutionFilter,
          wd: '',
        });

        // 替换为智能搜索代理端点
        // TVBox会在URL后拼接搜索关键词，格式：api + wd={keyword}
        site.api = `${baseUrl}/api/tvbox/search?${proxySearchParams.toString()}`;

        console.log(`[TVBox] Enabled smart proxy for source: ${s.key}`);
      }

      // 优化：根据不同API类型设置请求头，提升稳定性和切换体验
      if (apiType === 0 || apiType === 1) {
        // 苹果CMS接口优化配置
        site.header = {
          'User-Agent':
            'Mozilla/5.0 (Linux; Android 11; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Mobile Safari/537.36',
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Cache-Control': 'no-cache',
          Connection: 'close', // 避免连接复用问题
        };

        // 优化搜索参数配置
        if (!useSmartProxy && !s.api.includes('?')) {
          if (apiType === 1) {
            // JSON接口标准参数
            site.api = s.api + (s.api.endsWith('/') ? '' : '/') + '?ac=list';
          }
        }

        // 增加超时和重试配置
        site.timeout = 10000; // 10秒超时
        site.retry = 2; // 重试2次
      } else if (apiType === 3) {
        // CSP源优化配置
        site.header = {
          'User-Agent': 'okhttp/3.15',
          Accept: '*/*',
          Connection: 'close',
        };

        // CSP源通常更稳定，设置更长超时
        site.timeout = 15000; // 15秒超时
        site.retry = 1; // 重试1次
      }

      // 解析 detail 扩展配置
      const detail = (s.detail || '').trim();
      if (detail) {
        try {
          const obj = JSON.parse(detail);
          if (obj && typeof obj === 'object') {
            // 更新站点配置
            if (obj.type !== undefined) {
              site.type = Number(obj.type);
              // 重新设置对应的请求头
              if (site.type === 3) {
                site.header = { 'User-Agent': 'okhttp/3.15' };
              }
            }
            if (obj.api) site.api = obj.api;

            // 处理ext配置
            if (obj.ext !== undefined) {
              site.ext =
                typeof obj.ext === 'string' ? obj.ext : JSON.stringify(obj.ext);
            }

            // 搜索相关配置
            if (obj.searchable !== undefined)
              site.searchable = Number(obj.searchable);
            if (obj.quickSearch !== undefined)
              site.quickSearch = Number(obj.quickSearch);
            if (obj.filterable !== undefined)
              site.filterable = Number(obj.filterable);
            if (obj.playUrl !== undefined) site.playUrl = obj.playUrl;

            // jar配置处理
            if (obj.jar) {
              const jarUrl = obj.jar.trim();
              if (
                jarUrl.startsWith('http') &&
                isAllowedPinnedSpiderUrl(jarUrl, spiderSecurity.candidates)
              ) {
                site.jar = jarUrl;
                globalSpiderJar = jarUrl;
              }
            }

            // 处理自定义请求头
            if (obj.header && typeof obj.header === 'object') {
              site.header = { ...site.header, ...obj.header };
            }
          }
        } catch {
          // 如果不是JSON，作为ext字符串处理
          site.ext = detail;
        }
      }

      // 最终类型检查和修正
      if (
        typeof site.api === 'string' &&
        site.api.toLowerCase().startsWith('csp_')
      ) {
        site.type = 3;
        site.header = { 'User-Agent': 'okhttp/3.15' };
      }

      // 确保必要字段存在
      if (!site.ext) site.ext = '';

      return site;
    });

    const includeDoubanNavigation =
      searchParams.get('douban') !== 'off' &&
      searchParams.get('douban') !== 'false';
    const enableDoubanKeywordSearch =
      searchParams.get('doubanSearch') === 'on' ||
      searchParams.get('doubanSearch') === 'true';
    const doubanSite = {
      key: 'decotv_douban',
      name: '豆瓣导航',
      type: 1,
      api: `${baseUrl}/api/tvbox/douban`,
      searchable: enableDoubanKeywordSearch ? 1 : 0,
      quickSearch: enableDoubanKeywordSearch ? 1 : 0,
      filterable: 1,
      changeable: 0,
      header: {
        'User-Agent':
          'Mozilla/5.0 (Linux; Android 11; TVBox) AppleWebKit/537.36',
        Accept: 'application/json, text/plain, */*',
      },
      ext: '',
    };
    const sites = includeDoubanNavigation
      ? [doubanSite, ...sourceSites]
      : sourceSites;

    // 构建直播配置（同样应用成人内容过滤，仅依据显式标记）
    let livesToUse = (cfg.LiveConfig || []).filter((l) => !l.disabled);

    if (shouldFilterAdult) {
      const beforeLiveCount = livesToUse.length;
      livesToUse = livesToUse.filter((l) => {
        // 仅检查显式标记 is_adult === true
        if ((l as any).is_adult === true) {
          console.log(`[TVBox] 🚨 Filtered live by is_adult: ${l.name}`);
          return false;
        }
        return true;
      });
      const filteredLiveCount = beforeLiveCount - livesToUse.length;
      if (filteredLiveCount > 0) {
        console.log(
          `[TVBox] ✅ Filtered ${filteredLiveCount} adult live sources`,
        );
      }
    }

    const lives = livesToUse.map((l) => ({
      name: l.name,
      type: 0, // 0-m3u格式
      url: l.url,
      ua:
        l.ua ||
        'Mozilla/5.0 (Linux; Android 11; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.72 Mobile Safari/537.36',
      epg: l.epg || '',
      logo: '',
      group: '直播',
    }));

    const tvboxAds = [
      'mimg.0c1q0l.cn',
      'www.googletagmanager.com',
      'mc.usihnbcq.cn',
      'wan.51img1.com',
      'iqiyi.hbuioo.com',
      'vip.ffzyad.com',
      'ffzyad',
      'casino',
      'macau',
      'aomen',
      'gambling',
      'bet365',
      '1xbet',
      '188bet',
      '22bet',
      'https://lf1-cdn-tos.bytegoofy.com/obj/tos-cn-i-dy/455ccf9e8ae744378118e4bd289288dd',
    ];

    // 构建配置对象（支持多种模式优化）
    let tvboxConfig: any;
    if (mode === 'yingshicang') {
      // 专门为影视仓优化的配置 - 解决数据获取问题
      tvboxConfig = {
        // 使用公共 spider（不要使用 localhost 避免体检判定 private）
        spider: globalSpiderJar,
        sites: sites.map((site) => {
          const optimizedSite = { ...site };

          // 影视仓优化：保留必要字段，删除可能冲突的字段
          delete optimizedSite.timeout;
          delete optimizedSite.retry;
          delete optimizedSite.changeable;

          // 影视仓稳定配置
          if (optimizedSite.type === 3) {
            // CSP源：简化配置，提升兼容性
            optimizedSite.header = {
              'User-Agent': 'okhttp/3.15',
              Accept: '*/*',
            };
          } else {
            // 苹果CMS：使用移动端UA，提升兼容性
            optimizedSite.header = {
              'User-Agent':
                'Mozilla/5.0 (Linux; Android 11; SM-G973F) AppleWebKit/537.36',
              Accept: 'application/json, */*',
              Connection: 'close',
            };
          }

          // 强制启用普通源搜索功能，豆瓣导航默认只做分类导航。
          optimizedSite.searchable =
            optimizedSite.key === 'decotv_douban' ? doubanSite.searchable : 1;
          optimizedSite.quickSearch =
            optimizedSite.key === 'decotv_douban' ? doubanSite.quickSearch : 1;
          optimizedSite.filterable = 1;

          // 影视仓特有优化
          optimizedSite.playerType = 1; // 强制使用系统播放器
          optimizedSite.playUrl = ''; // 清空可能的播放链接冲突

          return optimizedSite;
        }),
        lives,
        parses: [
          {
            name: '默认解析',
            type: 0,
            url: 'https://jx.xmflv.com/?url=',
            ext: {
              flag: ['qq', 'qiyi', 'mgtv', 'youku', 'letv', 'sohu', 'iqiyi'],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          {
            name: '备用解析',
            type: 0,
            url: 'https://www.yemu.xyz/?url=',
            ext: {
              flag: ['qq', 'qiyi', 'mgtv', 'youku', 'letv'],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          {
            name: '高速解析',
            type: 0,
            url: 'https://jx.aidouer.net/?url=',
            ext: {
              flag: ['qq', 'qiyi', 'mgtv', 'youku'],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          { name: 'Json并发', type: 2, url: 'Parallel' },
          { name: 'Json轮询', type: 2, url: 'Sequence' },
        ],
        flags: [
          'youku',
          'qq',
          'iqiyi',
          'qiyi',
          'letv',
          'sohu',
          'tudou',
          'pptv',
          'mgtv',
          'wasu',
          'bilibili',
          'renrenmi',
        ],
        ads: tvboxAds,
        // 影视仓专用规则 - 解决播放问题
        rules: [
          {
            name: '量子资源',
            hosts: ['vip.lz', 'hd.lz', 'v.cdnlz.com'],
            regex: [
              '#EXT-X-DISCONTINUITY\\r?\\n\\#EXTINF:6.433333,[\\s\\S]*?#EXT-X-DISCONTINUITY',
              '#EXTINF.*?\\s+.*?1o.*?\\.ts\\s+',
            ],
          },
          {
            name: '非凡资源',
            hosts: ['vip.ffzy', 'hd.ffzy', 'v.ffzyapi.com'],
            regex: [
              '#EXT-X-DISCONTINUITY\\r?\\n\\#EXTINF:6.666667,[\\s\\S]*?#EXT-X-DISCONTINUITY',
              '#EXTINF.*?\\s+.*?1o.*?\\.ts\\s+',
            ],
          },
        ],
        // 添加影视仓专用的壁纸和其他配置
        wallpaper: 'https://picsum.photos/1920/1080/?blur=1',
        maxHomeVideoContent: '20',
      };
    } else if (mode === 'fast' || mode === 'optimize') {
      // 快速切换优化模式：专门针对资源源切换体验优化
      tvboxConfig = {
        spider: globalSpiderJar,
        sites: sites.map((site) => {
          const fastSite = { ...site };
          // 快速模式：移除可能导致卡顿的配置
          delete fastSite.timeout;
          delete fastSite.retry;

          // 优化请求头，提升响应速度
          if (fastSite.type === 3) {
            fastSite.header = { 'User-Agent': 'okhttp/3.15' };
          } else {
            fastSite.header = {
              'User-Agent':
                'Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36',
              Connection: 'close',
            };
          }

          // 强制启用普通源快速切换相关功能，豆瓣导航默认不参与关键词搜索。
          fastSite.searchable =
            fastSite.key === 'decotv_douban' ? doubanSite.searchable : 1;
          fastSite.quickSearch =
            fastSite.key === 'decotv_douban' ? doubanSite.quickSearch : 1;
          fastSite.filterable = 1;
          fastSite.changeable = 1;

          return fastSite;
        }),
        lives,
        parses: [
          {
            name: '极速解析',
            type: 0,
            url: 'https://jx.xmflv.com/?url=',
            ext: { flag: ['all'] },
          },
          { name: 'Json并发', type: 2, url: 'Parallel' },
        ],
        flags: ['youku', 'qq', 'iqiyi', 'qiyi', 'letv', 'sohu', 'mgtv'],
        ads: tvboxAds,
        wallpaper: '', // 移除壁纸加快加载
        maxHomeVideoContent: '15', // 减少首页内容，提升加载速度
      };
    } else if (mode === 'safe' || mode === 'min') {
      // 仅输出最必要字段，避免解析器因字段不兼容而失败
      tvboxConfig = {
        spider: globalSpiderJar,
        sites,
        lives,
        parses: [
          { name: '默认解析', type: 0, url: 'https://jx.xmflv.com/?url=' },
          { name: '夜幕解析', type: 0, url: 'https://www.yemu.xyz/?url=' },
        ],
        ads: tvboxAds,
      };
    } else {
      // 标准完整配置 - 优化体验和兼容性
      tvboxConfig = {
        spider: globalSpiderJar,
        wallpaper: 'https://picsum.photos/1920/1080/?blur=2',
        sites,
        lives,
        parses: [
          {
            name: '默认解析',
            type: 0,
            url: 'https://jx.xmflv.com/?url=',
            ext: {
              flag: [
                'qq',
                'qiyi',
                'mgtv',
                'youku',
                'letv',
                'sohu',
                'xigua',
                'cntv',
              ],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          {
            name: '夜幕解析',
            type: 0,
            url: 'https://www.yemu.xyz/?url=',
            ext: {
              flag: ['qq', 'qiyi', 'mgtv', 'youku', 'letv', 'sohu'],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          {
            name: '爱豆解析',
            type: 0,
            url: 'https://jx.aidouer.net/?url=',
            ext: {
              flag: ['qq', 'qiyi', 'mgtv', 'youku', 'letv'],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          {
            name: '8090解析',
            type: 0,
            url: 'https://www.8090g.cn/?url=',
            ext: {
              flag: ['qq', 'qiyi', 'mgtv', 'youku'],
              header: { 'User-Agent': 'Mozilla/5.0' },
            },
          },
          { name: 'Json并发', type: 2, url: 'Parallel' },
          { name: 'Json轮询', type: 2, url: 'Sequence' },
        ],
        flags: [
          'youku',
          'qq',
          'iqiyi',
          'qiyi',
          'letv',
          'sohu',
          'tudou',
          'pptv',
          'mgtv',
          'wasu',
          'bilibili',
          'renrenmi',
          'xigua',
          'cntv',
          '1905',
          'fun',
        ],
        ijk: [
          {
            group: '软解码',
            options: [
              { category: 4, name: 'opensles', value: '0' },
              { category: 4, name: 'overlay-format', value: '842225234' },
              { category: 4, name: 'framedrop', value: '1' },
              { category: 4, name: 'start-on-prepared', value: '1' },
              { category: 1, name: 'http-detect-range-support', value: '0' },
              { category: 1, name: 'fflags', value: 'fastseek' },
              { category: 4, name: 'reconnect', value: '1' },
              { category: 4, name: 'enable-accurate-seek', value: '0' },
              { category: 4, name: 'mediacodec', value: '0' },
              { category: 4, name: 'mediacodec-auto-rotate', value: '0' },
              {
                category: 4,
                name: 'mediacodec-handle-resolution-change',
                value: '0',
              },
              { category: 2, name: 'skip_loop_filter', value: '48' },
              { category: 4, name: 'packet-buffering', value: '0' },
              { category: 1, name: 'analyzeduration', value: '2000000' },
              { category: 1, name: 'probesize', value: '10485760' },
              { category: 1, name: 'flush_packets', value: '1' },
            ],
          },
          {
            group: '硬解码',
            options: [
              { category: 4, name: 'opensles', value: '0' },
              { category: 4, name: 'overlay-format', value: '842225234' },
              { category: 4, name: 'framedrop', value: '1' },
              { category: 4, name: 'start-on-prepared', value: '1' },
              { category: 1, name: 'http-detect-range-support', value: '0' },
              { category: 1, name: 'fflags', value: 'fastseek' },
              { category: 4, name: 'reconnect', value: '1' },
              { category: 4, name: 'enable-accurate-seek', value: '0' },
              { category: 4, name: 'mediacodec', value: '1' },
              { category: 4, name: 'mediacodec-auto-rotate', value: '1' },
              {
                category: 4,
                name: 'mediacodec-handle-resolution-change',
                value: '1',
              },
              { category: 2, name: 'skip_loop_filter', value: '48' },
              { category: 4, name: 'packet-buffering', value: '0' },
              { category: 1, name: 'analyzeduration', value: '2000000' },
              { category: 1, name: 'probesize', value: '10485760' },
            ],
          },
        ],
        ads: tvboxAds,
        doh: [
          {
            name: '阿里DNS',
            url: 'https://dns.alidns.com/dns-query',
            ips: ['223.5.5.5', '223.6.6.6'],
          },
          {
            name: '腾讯DNS',
            url: 'https://doh.pub/dns-query',
            ips: ['119.29.29.29', '119.28.28.28'],
          },
        ],
      };
    }

    // 只允许显式配置并通过 SHA-256 pin 的远端 JAR 覆盖。
    const overrideSpider = searchParams.get('spider');
    if (
      overrideSpider &&
      /^https?:\/\//i.test(overrideSpider) &&
      isAllowedPinnedSpiderUrl(overrideSpider, spiderSecurity.candidates)
    ) {
      tvboxConfig.spider = overrideSpider;
    } else {
      tvboxConfig.spider = globalSpiderJar;
    }
    // 附加可观测字段（TVBox 忽略未知字段，不影响使用）
    tvboxConfig.spider_url = jarInfo.source;
    tvboxConfig.spider_md5 = jarInfo.md5;
    tvboxConfig.spider_sha256 = jarInfo.sha256;
    tvboxConfig.spider_cached = jarInfo.cached;
    tvboxConfig.spider_real_size = jarInfo.size;
    tvboxConfig.spider_tried = jarInfo.tried;
    tvboxConfig.spider_success = jarInfo.success;
    tvboxConfig.spider_hash_verified = jarInfo.hashVerified;
    tvboxConfig.spider_remote_enabled = jarInfo.remoteEnabled;
    tvboxConfig.spider_security_mode = jarInfo.securityMode;
    tvboxConfig.min_resolution = resolutionFilter.minLevel
      ? formatResolutionLabel(resolutionFilter.minLevel)
      : 'off';
    tvboxConfig.resolution_strict = resolutionFilter.strict;
    tvboxConfig.jar_mode = usePinnedRemoteSpider
      ? 'pinned-remote'
      : 'same-origin-proxy';
    tvboxConfig.client_region = resolveClientRegion(req, searchParams);
    tvboxConfig.douban_navigation = includeDoubanNavigation;
    tvboxConfig.douban_keyword_search = enableDoubanKeywordSearch;

    // 提供备用字段：仅用于调试，不影响体检
    (tvboxConfig as any).spider_backup = sameOriginSpiderJar;
    // 保留候选列表以便前端展示（可选）
    (tvboxConfig as any).spider_candidates = spiderSecurity.candidates;
    (tvboxConfig as any).spider_security = spiderSecurity;

    // fallback-only 模式下内置 JAR 不含完整 CSP spider，配置里又存在 csp_ 源时
    // 明确提示用户，避免只看到「没找到数据 / jar 加载失败」而无从排查
    if (
      jarInfo.securityMode === 'fallback-only' &&
      tvboxConfig.sites.some((site: { type?: number }) => site.type === 3)
    ) {
      (tvboxConfig as any).spider_warning =
        '当前为 fallback-only 模式：内置 JAR 仅保证端点可达，不包含完整 CSP spider，' +
        '配置中的 csp_ 源将无法返回数据。如需恢复，请设置 ALLOW_REMOTE_SPIDER_JAR=true、' +
        'SPIDER_JAR_URL(S) 和 SPIDER_JAR_SHA256（详见 TVBox配置优化说明.md 的迁移指南）。';
    }

    // 配置验证和清理
    console.log('TVBox配置验证:', {
      sitesCount: tvboxConfig.sites.length,
      livesCount: tvboxConfig.lives.length,
      parsesCount: tvboxConfig.parses.length,
      spider: tvboxConfig.spider ? '已设置' : '未设置',
      spiderUrl: tvboxConfig.spider.split(';')[0],
      mode: mode || 'standard',
    });

    let responseContent: string;
    let contentType: string;

    if (format === 'base64') {
      // Base64编码 - 影视仓等部分应用需要
      const jsonString = JSON.stringify(tvboxConfig, null, 0);
      responseContent = Buffer.from(jsonString, 'utf-8').toString('base64');
      contentType = 'text/plain; charset=utf-8';
    } else {
      // 标准JSON格式 - 确保字段顺序和格式正确
      responseContent = JSON.stringify(
        tvboxConfig,
        (key, value) => {
          // 数字类型的字段确保为数字
          if (
            ['type', 'searchable', 'quickSearch', 'filterable'].includes(key)
          ) {
            return typeof value === 'string' ? parseInt(value) || 0 : value;
          }
          return value;
        },
        0,
      ); // 紧凑格式，不使用缩进

      // TVBox体检要求content-type为text/plain
      contentType = 'text/plain; charset=utf-8';
    }

    return new NextResponse(responseContent, {
      headers: {
        'content-type': contentType,
        // 🚨 严格禁止缓存，确保 OrionTV 等客户端每次获取最新配置
        'cache-control':
          'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
        pragma: 'no-cache',
        expires: '0',
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'Content-Type',
      },
    });
  } catch (e) {
    console.error('TVBox 配置生成失败:', e);
    return NextResponse.json(
      {
        error: 'TVBox 配置生成失败',
        details: e instanceof Error ? e.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}

// 处理 CORS 预检请求 (OrionTV 1.3.11+ 可能需要)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': 'Content-Type',
      'access-control-max-age': '86400',
    },
  });
}
