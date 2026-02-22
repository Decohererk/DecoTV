import { revalidatePath } from 'next/cache';

import type { AdminConfig } from './admin.types';
import { saveAdminConfigWithVerification } from './config';

export function revalidateAdminConfigViews(): void {
  try {
    // Invalidate root layout so all server components depending on getConfig() refetch.
    revalidatePath('/', 'layout');
    revalidatePath('/admin');
    revalidatePath('/api/admin/config');
    revalidatePath('/api/server-config');
  } catch {
    // Ignore when revalidate is not available (for detached async tasks).
  }
}

export async function persistAdminConfigMutation(
  config: AdminConfig,
  options: { revalidate?: boolean } = {},
): Promise<AdminConfig> {
  const persisted = await saveAdminConfigWithVerification(config);
  if (options.revalidate !== false) {
    revalidateAdminConfigViews();
  }
  return persisted;
}
