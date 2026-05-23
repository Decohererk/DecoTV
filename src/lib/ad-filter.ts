/**
 * M3U8 广告分段过滤
 *
 * 算法移植自 dongguatv 项目的 public/libs/js/ad-filter.js（v3.1）
 * https://github.com/luoxiaohei/dongguatv
 *
 * 核心思路：CMS 资源站常通过 #EXT-X-DISCONTINUITY 在主内容前后/中间
 * 拼接广告分段。识别"主内容组（最长的 discontinuity 组）"，将其余
 * 时长在 3-120 秒、分段数较少的短组判定为广告并删除。
 */

export interface AdFilterConfig {
  enabled: boolean;
  minAdDuration: number;
  maxAdDuration: number;
  maxConsecutiveAdSegments: number;
  adDomainPatterns: string[];
  safeDomains: string[];
}

export const DEFAULT_AD_FILTER_CONFIG: AdFilterConfig = {
  enabled: true,
  minAdDuration: 3,
  maxAdDuration: 120,
  maxConsecutiveAdSegments: 15,
  adDomainPatterns: [
    'doubleclick',
    'googlesyndication',
    'googleadservices',
    'adsystem',
    'adservice',
    'baidu.com/adm',
    'pos.baidu.com',
    'cpro.baidu',
    'eclick.baidu',
    'baidustatic.com/adm',
    'gdt.qq.com',
    'l.qq.com',
    'e.qq.com',
    'adsmind.gdtimg',
    'tanx.com',
    'alimama.com',
    'mmstat.com',
    'atanx.alicdn',
    'ykad.',
    'ykimg.com/material',
    'iusmob.',
    'pangle.',
    'pangolin.',
    'bytedance.com/ad',
    'oceanengine.',
    'csjad.',
    'iqiyiad.',
    'iqiyi.com/cupid',
    'cupid.iqiyi',
    'mgtvad.',
    'admaster.',
    'miaozhen.',
    'adcdn.',
    'ad-cdn.',
    '/ad/',
    '/ads/',
    'advert',
    'adsrv',
    'adpush',
    'adx.',
    'dsp.',
    'rtb.',
    'ssp.',
    'tracking',
    'analytics',
    'commercial',
    'insert.',
    'preroll',
    'midroll',
    'postroll',
  ],
  safeDomains: [
    'hhuus.com',
    'bvvvvvvvvv1f.com',
    'play-cdn',
    'modujx',
    'ffzy',
    'sdzy',
    'wujin',
    'heimuer',
    'lzizy',
    'alicdn.com',
    'aliyuncs.com',
    'aliyun',
    'qcloud',
    'myqcloud.com',
    'ksyun',
    'ks-cdn',
    'huaweicloud',
    'hwcdn',
    'baidubce',
    'bcebos.com',
    'cdn.bcebos',
    'cdn.jsdelivr',
    'bootcdn',
    'staticfile',
    'unpkg',
    'cdnjs',
  ],
};

interface ParsedSegment {
  duration: number;
  discontinuityGroup: number;
  infLine: string;
  lineIndex: number;
  url?: string;
  urlLineIndex?: number;
  isAdDomain?: boolean;
}

interface ParsedM3U8 {
  lines: string[];
  segments: ParsedSegment[];
  discontinuityCount: number;
  totalDuration: number;
}

export interface FilterResult {
  filtered: string;
  adsRemoved: number;
  adsDuration: number;
  changed: boolean;
}

function isAdDomain(url: string, config: AdFilterConfig): boolean {
  if (!url) return false;
  const lowerUrl = url.toLowerCase();
  for (const safe of config.safeDomains) {
    if (lowerUrl.includes(safe)) return false;
  }
  for (const pattern of config.adDomainPatterns) {
    if (lowerUrl.includes(pattern)) return true;
  }
  return false;
}

function parseM3U8(content: string, config: AdFilterConfig): ParsedM3U8 {
  const lines = content.split('\n').map((l) => l.trim());
  const segments: ParsedSegment[] = [];
  let currentSegment: ParsedSegment | null = null;
  let discontinuityCount = 0;
  let currentDiscontinuityGroup = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuityCount++;
      currentDiscontinuityGroup = discontinuityCount;
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const match = line.match(/#EXTINF:([\d.]+)/);
      const duration = match ? parseFloat(match[1]) : 0;
      currentSegment = {
        duration,
        discontinuityGroup: currentDiscontinuityGroup,
        infLine: line,
        lineIndex: i,
      };
      continue;
    }

    if (currentSegment && line && !line.startsWith('#')) {
      currentSegment.url = line;
      currentSegment.urlLineIndex = i;
      currentSegment.isAdDomain = isAdDomain(line, config);
      segments.push(currentSegment);
      currentSegment = null;
    }
  }

  return {
    lines,
    segments,
    discontinuityCount,
    totalDuration: segments.reduce((sum, s) => sum + s.duration, 0),
  };
}

function detectAdSegments(
  segments: ParsedSegment[],
  config: AdFilterConfig,
): Set<number> {
  const adSegmentIndices = new Set<number>();

  segments.forEach((seg, idx) => {
    if (seg.isAdDomain) adSegmentIndices.add(idx);
  });

  const groups: Record<number, (ParsedSegment & { index: number })[]> = {};
  segments.forEach((seg, idx) => {
    const g = seg.discontinuityGroup;
    if (!groups[g]) groups[g] = [];
    groups[g].push({ ...seg, index: idx });
  });

  const groupKeys = Object.keys(groups)
    .map(Number)
    .sort((a, b) => a - b);

  if (groupKeys.length <= 1) return adSegmentIndices;

  const groupDurations: Record<number, number> = {};
  let maxDuration = 0;
  let mainContentGroup = 0;

  for (const gKey of groupKeys) {
    const duration = groups[gKey].reduce((sum, s) => sum + s.duration, 0);
    groupDurations[gKey] = duration;
    if (duration > maxDuration) {
      maxDuration = duration;
      mainContentGroup = gKey;
    }
  }

  for (const gKey of groupKeys) {
    if (gKey === mainContentGroup) continue;

    const group = groups[gKey];
    const groupDuration = groupDurations[gKey];

    if (groupDuration > config.maxAdDuration) continue;

    const isAdByDuration =
      groupDuration >= config.minAdDuration &&
      groupDuration <= config.maxAdDuration;
    const isAdBySegmentCount = group.length <= config.maxConsecutiveAdSegments;

    if (isAdByDuration && isAdBySegmentCount) {
      group.forEach((seg) => adSegmentIndices.add(seg.index));
    }
  }

  return adSegmentIndices;
}

/**
 * 过滤 M3U8 文本，移除广告分段。
 *
 * 不修改主播放列表（包含 #EXT-X-STREAM-INF 的）；只处理变体播放列表。
 * 仅删除 m3u8 中的广告段引用，TS 分片仍由播放器直连上游 CDN 拉取。
 */
export function filterM3U8(
  content: string,
  config: AdFilterConfig = DEFAULT_AD_FILTER_CONFIG,
): FilterResult {
  if (!config.enabled) {
    return { filtered: content, adsRemoved: 0, adsDuration: 0, changed: false };
  }

  // 主播放列表不处理
  if (content.includes('#EXT-X-STREAM-INF')) {
    return { filtered: content, adsRemoved: 0, adsDuration: 0, changed: false };
  }

  const parsed = parseM3U8(content, config);

  if (
    parsed.discontinuityCount === 0 &&
    !parsed.segments.some((s) => s.isAdDomain)
  ) {
    return { filtered: content, adsRemoved: 0, adsDuration: 0, changed: false };
  }

  const adIndices = detectAdSegments(parsed.segments, config);

  if (adIndices.size === 0) {
    return { filtered: content, adsRemoved: 0, adsDuration: 0, changed: false };
  }

  let adsDuration = 0;
  adIndices.forEach((idx) => {
    adsDuration += parsed.segments[idx].duration;
  });

  const linesToRemove = new Set<number>();
  adIndices.forEach((idx) => {
    const seg = parsed.segments[idx];
    linesToRemove.add(seg.lineIndex);
    if (seg.urlLineIndex !== undefined) linesToRemove.add(seg.urlLineIndex);
  });

  // 第一轮：移除广告 EXTINF/URL 行；删除完全位于广告段之前的 DISCONTINUITY
  const filteredLines: string[] = [];
  let hadContentBefore = false;
  let removedAdGroup = false;

  for (let i = 0; i < parsed.lines.length; i++) {
    const line = parsed.lines[i];

    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      let allAds = true;
      let hasSegments = false;

      for (let j = i + 1; j < parsed.lines.length; j++) {
        const nextLine = parsed.lines[j];
        if (
          nextLine.startsWith('#EXT-X-DISCONTINUITY') ||
          nextLine.startsWith('#EXT-X-ENDLIST')
        ) {
          break;
        }
        if (nextLine && !nextLine.startsWith('#')) {
          hasSegments = true;
          const segIdx = parsed.segments.findIndex((s) => s.url === nextLine);
          if (segIdx >= 0 && !adIndices.has(segIdx)) {
            allAds = false;
            break;
          }
        }
      }

      if (hasSegments && allAds) {
        removedAdGroup = true;
        continue;
      }

      if (removedAdGroup && hadContentBefore) {
        filteredLines.push(line);
        removedAdGroup = false;
        continue;
      }
    }

    if (!linesToRemove.has(i)) {
      filteredLines.push(line);
      if (line && !line.startsWith('#')) {
        const segIdx = parsed.segments.findIndex((s) => s.url === line);
        if (segIdx >= 0 && !adIndices.has(segIdx)) {
          hadContentBefore = true;
        }
      }
    }
  }

  // 第二轮：移除连续/末尾多余的 DISCONTINUITY
  const cleanedLines: string[] = [];
  for (let i = 0; i < filteredLines.length; i++) {
    const line = filteredLines[i];
    if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      let nextNonEmpty = '';
      for (let j = i + 1; j < filteredLines.length; j++) {
        if (filteredLines[j].trim()) {
          nextNonEmpty = filteredLines[j];
          break;
        }
      }
      if (
        nextNonEmpty.startsWith('#EXT-X-DISCONTINUITY') ||
        nextNonEmpty.startsWith('#EXT-X-ENDLIST') ||
        !nextNonEmpty
      ) {
        continue;
      }
    }
    cleanedLines.push(line);
  }

  // 第三轮：移除首个分段前的 DISCONTINUITY
  const finalLines: string[] = [];
  let foundFirstSegment = false;
  for (const line of cleanedLines) {
    if (!foundFirstSegment && line.startsWith('#EXT-X-DISCONTINUITY')) {
      continue;
    }
    if (line.startsWith('#EXTINF:')) {
      foundFirstSegment = true;
    }
    finalLines.push(line);
  }

  // 第四轮：广告移除后，剩余的 DISCONTINUITY 已无意义，且
  // 部分播放器在 DISCONTINUITY 处会出现音频采样率重置 bug，全部移除
  const noDiscoLines = finalLines.filter(
    (line) => !line.startsWith('#EXT-X-DISCONTINUITY'),
  );

  return {
    filtered: noDiscoLines.join('\n'),
    adsRemoved: adIndices.size,
    adsDuration,
    changed: true,
  };
}
