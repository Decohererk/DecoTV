/*
 * Shared HMAC signing for the auth cookie.
 *
 * The signed payload binds username, role, issued-at and expiry
 * (`username:role:iat:exp`), so a leaked cookie stops working when it
 * expires instead of replaying until PASSWORD changes. Signing prefers a
 * dedicated AUTH_SECRET (or NEXTAUTH_SECRET) and falls back to PASSWORD so
 * existing deployments keep working without new configuration; rotating
 * the active secret invalidates all sessions at once.
 *
 * Uses only Web Crypto and process.env so it is safe to import from both
 * the Node.js route handlers and the middleware (edge) runtime.
 */

export interface SignedAuthTokenFields {
  username?: string;
  role?: 'owner' | 'admin' | 'user' | 'guest';
  signature?: string;
  iat?: number;
  exp?: number;
}

const SIGNATURE_HEX_LENGTH = 64;
// Tolerate small clock differences between the instance that issued the
// cookie and the instance verifying it.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export function getAuthSigningSecret(): string {
  return (
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.PASSWORD ||
    ''
  );
}

function buildSignedAuthPayload(
  username: string,
  role: string,
  iat: number,
  exp: number,
): string {
  return `${username}:${role}:${iat}:${exp}`;
}

async function importHmacKey(secret: string, usage: 'sign' | 'verify') {
  const encoder = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  );
}

export async function signAuthToken(
  username: string,
  role: 'owner' | 'admin' | 'user' | 'guest',
  iat: number,
  exp: number,
): Promise<string> {
  const secret = getAuthSigningSecret();
  if (!secret) {
    throw new Error('Auth signing secret is not configured');
  }

  const encoder = new TextEncoder();
  const key = await importHmacKey(secret, 'sign');
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(buildSignedAuthPayload(username, role, iat, exp)),
  );

  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyAuthToken(
  fields: SignedAuthTokenFields,
  now = Date.now(),
): Promise<boolean> {
  const secret = getAuthSigningSecret();
  if (!secret || !fields.username || !fields.signature) return false;

  // Cookies without signed iat/exp (issued by older builds) are rejected;
  // those sessions re-authenticate once and receive expiring tokens.
  if (
    typeof fields.iat !== 'number' ||
    typeof fields.exp !== 'number' ||
    !Number.isFinite(fields.iat) ||
    !Number.isFinite(fields.exp)
  ) {
    return false;
  }

  if (fields.exp <= now) return false;
  if (fields.iat > now + CLOCK_SKEW_MS) return false;

  const signature = fields.signature;
  if (
    signature.length !== SIGNATURE_HEX_LENGTH ||
    !/^[0-9a-f]+$/i.test(signature)
  ) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const key = await importHmacKey(secret, 'verify');
    const signatureBuffer = new Uint8Array(
      signature.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) || [],
    );

    return await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBuffer,
      encoder.encode(
        buildSignedAuthPayload(
          fields.username,
          fields.role || 'user',
          fields.iat,
          fields.exp,
        ),
      ),
    );
  } catch {
    return false;
  }
}
