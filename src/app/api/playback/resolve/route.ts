/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getAvailableApiSites } from '@/lib/config';
import { resolvePlayableUrl } from '@/lib/player/playback-resolver';

export const runtime = 'nodejs';

function getRequestOrigin(request: NextRequest): string {
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    .trim();
  const forwardedHost = request.headers
    .get('x-forwarded-host')
    ?.split(',')[0]
    .trim();
  const protocol = forwardedProto || request.nextUrl.protocol.replace(':', '');
  const host =
    forwardedHost || request.headers.get('host') || request.nextUrl.host;
  return `${protocol}://${host}`;
}

async function readPayload(request: NextRequest): Promise<Record<string, any>> {
  if (request.method === 'POST') {
    return (await request.json().catch(() => ({}))) as Record<string, any>;
  }
  return Object.fromEntries(request.nextUrl.searchParams.entries());
}

async function findSourceConfig(request: NextRequest, source?: string) {
  if (!source) return undefined;
  const authResult = verifyApiAuth(request);
  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authInfo?.username || (authResult.isLocalMode ? '__local__' : '');
  const sites = await getAvailableApiSites(username);
  return sites.find((site) => site.key === source);
}

async function handle(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = await readPayload(request);
  const sourceKey = String(payload.sourceKey || payload.source || '').trim();
  const sourceConfig = await findSourceConfig(request, sourceKey);
  const result = await resolvePlayableUrl({
    sourceKey,
    sourceName: payload.sourceName || sourceConfig?.name,
    sourceConfig,
    episodeUrl: String(payload.episodeUrl || payload.url || ''),
    title: payload.title,
    episodeIndex:
      payload.episodeIndex === undefined
        ? undefined
        : Number(payload.episodeIndex),
    requestOrigin: String(payload.requestOrigin || getRequestOrigin(request)),
    userAgent: request.headers.get('user-agent') || undefined,
    referer: payload.referer,
    proxyMode: payload.proxyMode,
    strategy: payload.strategy,
  });

  return NextResponse.json(result, {
    headers: {
      'Cache-Control': 'no-store',
      'X-DecoTV-Playback-Strategy': result.strategy,
      'X-DecoTV-Source': sourceKey,
      'X-DecoTV-Error-Reason': result.health?.reason || '',
      'X-DecoTV-Upstream-Status': String(result.health?.manifest?.status || ''),
      'X-DecoTV-Upstream-Duration': String(
        result.health?.timings?.manifestMs || '',
      ),
    },
  });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
