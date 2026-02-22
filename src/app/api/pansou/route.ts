import { NextRequest } from 'next/server';

import {
  GET as searchGetHandler,
  OPTIONS as searchOptionsHandler,
  POST as searchPostHandler,
} from './search/route';

export const runtime = 'nodejs';
export const fetchCache = 'force-no-store';

export async function GET(request: NextRequest) {
  return searchGetHandler(request);
}

export async function POST(request: NextRequest) {
  return searchPostHandler(request);
}

export async function OPTIONS() {
  return searchOptionsHandler();
}
