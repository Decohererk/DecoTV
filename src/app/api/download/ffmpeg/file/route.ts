import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { NextRequest, NextResponse } from 'next/server';
import { Readable } from 'stream';

import { verifyApiAuth } from '@/lib/auth';
import { getFfmpegOutputFile } from '@/lib/ffmpeg-download';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

function unauthorized() {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return unauthorized();
  }

  const id = request.nextUrl.searchParams.get('id')?.trim();
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const output = await getFfmpegOutputFile(id);
  if (!output) {
    return NextResponse.json(
      { error: 'Output file not found or not ready' },
      { status: 404 },
    );
  }

  try {
    const fileStat = await stat(output.path);
    const nodeStream = createReadStream(output.path);
    const webStream = Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>;

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(output.fileName)}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Failed to open output file',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
