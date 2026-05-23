/* eslint-disable @typescript-eslint/no-explicit-any */

import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';

export const runtime = 'nodejs';

interface ServerQualityRecord {
  sourceKey: string;
  successCount: number;
  failCount: number;
  lastSuccessAt?: number;
  lastFailAt?: number;
  avgTtfb?: number;
  reasons: Record<string, number>;
}

const records = new Map<string, ServerQualityRecord>();

function rollingAverage(current: number | undefined, next: number): number {
  if (!Number.isFinite(next) || next <= 0) return current || 0;
  if (!current || current <= 0) return Math.round(next);
  return Math.round(current * 0.7 + next * 0.3);
}

export async function POST(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, any>;
  const sourceKey = String(body.sourceKey || body.source || '').trim();
  if (!sourceKey) {
    return NextResponse.json({ error: 'Missing sourceKey' }, { status: 400 });
  }

  const status =
    body.status === 'success' || body.ok === true ? 'success' : 'failure';
  const now = Date.now();
  const record =
    records.get(sourceKey) ||
    ({
      sourceKey,
      successCount: 0,
      failCount: 0,
      reasons: {},
    } satisfies ServerQualityRecord);

  if (status === 'success') {
    record.successCount += 1;
    record.lastSuccessAt = now;
    const ttfb = Number(body.ttfbMs || body.firstSegmentMs);
    if (Number.isFinite(ttfb) && ttfb > 0) {
      record.avgTtfb = rollingAverage(record.avgTtfb, ttfb);
    }
  } else {
    record.failCount += 1;
    record.lastFailAt = now;
    const reason = String(body.reason || 'unknown');
    record.reasons[reason] = (record.reasons[reason] || 0) + 1;
  }

  records.set(sourceKey, record);
  return NextResponse.json(
    { ok: true, record },
    {
      headers: {
        'Cache-Control': 'no-store',
        'X-DecoTV-Source': sourceKey,
      },
    },
  );
}
