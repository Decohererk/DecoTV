export type AuthMode = 'password' | 'public';

export function getAuthMode(): AuthMode {
  return process.env.NEXT_PUBLIC_AUTH_MODE === 'public' ? 'public' : 'password';
}

export function isPublicMode(): boolean {
  return getAuthMode() === 'public';
}

export function isPasswordMode(): boolean {
  return getAuthMode() === 'password';
}

export function isPublicAdminAllowed(): boolean {
  return isPublicMode() && process.env.PUBLIC_ALLOW_ADMIN === 'true';
}
