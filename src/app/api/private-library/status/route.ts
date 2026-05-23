import { NextRequest, NextResponse } from 'next/server';

import { verifyApiAuth } from '@/lib/auth';
import {
  formatPrivateLibrarySourceName,
  getPrivateLibraryConfig,
  getPrivateLibraryConnectorTypeLabel,
} from '@/lib/private-library';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = verifyApiAuth(request);
  if (!authResult.isValid) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const config = await getPrivateLibraryConfig();
  const connectors = config.connectors
    .filter((item) => item.enabled)
    .map((item) => ({
      id: item.id,
      name: item.name,
      displayName: item.displayName,
      type: item.type,
      typeLabel: getPrivateLibraryConnectorTypeLabel(item.type),
      sourceName: formatPrivateLibrarySourceName(item),
    }));

  return NextResponse.json({
    enabled: connectors.length > 0,
    connectors,
  });
}
