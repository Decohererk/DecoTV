/* eslint-disable no-console */

import { NextRequest, NextResponse } from 'next/server';

import { getAuthInfoFromCookie, verifyApiAuth } from '@/lib/auth';
import { getConfig } from '@/lib/config';
import { db } from '@/lib/db';
import { PlayRecord } from '@/lib/types';

export const runtime = 'nodejs';

function isLegacyPrivateLibraryPlayRecordKey(key: string): boolean {
  if (key.startsWith('private:progress:')) {
    return true;
  }

  const [source] = key.split('+');
  return Boolean(source?.startsWith('private-progress:'));
}

function isPublicPlayRecordKey(key: string): boolean {
  const [source, id] = key.split('+');
  return Boolean(source && id) && !isLegacyPrivateLibraryPlayRecordKey(key);
}

async function resolveAuthorizedUsername(
  request: NextRequest,
): Promise<{ username: string } | NextResponse> {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const authInfo = getAuthInfoFromCookie(request);
  const username =
    authResult.username ||
    authInfo?.username ||
    (authResult.isLocalMode ? '__local__' : '');

  if (!username) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!authResult.isLocalMode) {
    const config = await getConfig();
    if (username !== process.env.USERNAME) {
      const user = config.UserConfig.Users.find(
        (item) => item.username === username,
      );
      if (!user || user.banned) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
  }

  return { username };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await resolveAuthorizedUsername(request);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const records = await db.getAllPlayRecords(auth.username);
    const legacyKeys = Object.keys(records).filter(
      (key) => !isPublicPlayRecordKey(key),
    );

    if (legacyKeys.length > 0) {
      await Promise.all(
        legacyKeys.map(async (key) => {
          await db.deletePlayRecordByKey(auth.username, key);
        }),
      );
    }

    const publicRecords = Object.fromEntries(
      Object.entries(records).filter(([key]) => isPublicPlayRecordKey(key)),
    );

    return NextResponse.json(publicRecords, { status: 200 });
  } catch (error) {
    console.error('Failed to load play records', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await resolveAuthorizedUsername(request);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const body = (await request.json()) as {
      key?: string;
      record?: PlayRecord;
    };
    const { key, record } = body;

    if (!key || !record) {
      return NextResponse.json(
        { error: 'Missing key or record' },
        { status: 400 },
      );
    }

    if (!record.title || !record.source_name || record.index < 1) {
      return NextResponse.json(
        { error: 'Invalid record data' },
        { status: 400 },
      );
    }

    const [source, id] = key.split('+');
    if (!source || !id) {
      return NextResponse.json(
        { error: 'Invalid key format' },
        { status: 400 },
      );
    }

    await db.savePlayRecord(auth.username, source, id, {
      ...record,
      save_time: record.save_time ?? Date.now(),
    });

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Failed to save play record', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await resolveAuthorizedUsername(request);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get('key');

    if (key) {
      if (key.startsWith('private:progress:')) {
        await db.deletePlayRecordByKey(auth.username, key);
      } else {
        const [source, id] = key.split('+');
        if (!source || !id) {
          return NextResponse.json(
            { error: 'Invalid key format' },
            { status: 400 },
          );
        }

        await db.deletePlayRecord(auth.username, source, id);
      }
    } else {
      const all = await db.getAllPlayRecords(auth.username);
      await Promise.all(
        Object.keys(all).map(async (rawKey) => {
          const [source, id] = rawKey.split('+');
          if (source && id) {
            await db.deletePlayRecord(auth.username, source, id);
            return;
          }

          await db.deletePlayRecordByKey(auth.username, rawKey);
        }),
      );
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error('Failed to delete play record', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}
