/*
 * Proxy target validation helpers.
 *
 * Threat model: validateProxyTargetUrl blocks localhost, private/link-local
 * ranges, and cloud metadata hosts, and fetchWithValidatedRedirects
 * re-validates every redirect hop before following it. This significantly
 * reduces SSRF exposure, but it validates DNS answers at check time without
 * pinning the resolved IP to the actual socket connection. A hostile
 * authoritative DNS server that flips answers between validation and connect
 * (DNS rebinding) is therefore mitigated on a best-effort basis, not fully
 * eliminated. Routes built on these helpers should not be treated as a hard
 * security boundary for internal networks; keep sensitive internal services
 * off the deployment's network or behind their own authentication.
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_HOST_ALLOW_ENV = 'PROXY_ALLOW_PRIVATE_HOSTS';
const PRIVATE_HOST_ALLOWLIST_ENV = 'PROXY_PRIVATE_HOST_ALLOWLIST';

export function normalizeHeaderUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
}

function isBlockedHostname(hostname: string): boolean {
  return (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === 'metadata.google.internal'
  );
}

function isAlwaysBlockedHostname(hostname: string): boolean {
  return !hostname || hostname === 'metadata.google.internal';
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return true;
  }

  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 224 && b === 0 && c === 0) ||
    a >= 224
  );
}

function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedIPv4(mapped[1]);

  return (
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  );
}

function isBlockedAddress(address: string): boolean {
  const version = isIP(normalizeHostname(address));
  if (version === 4) return isBlockedIPv4(address);
  if (version === 6) return isBlockedIPv6(normalizeHostname(address));
  return true;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return null;
  }

  return (
    ((parts[0] << 24) >>> 0) +
    ((parts[1] << 16) >>> 0) +
    ((parts[2] << 8) >>> 0) +
    (parts[3] >>> 0)
  );
}

function isTruthy(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes((value || '').toLowerCase());
}

interface PrivateHostAllowlist {
  enabled: boolean;
  exactIps: Set<string>;
  hostnames: Set<string>;
  ipv4Cidrs: Array<{ base: number; mask: number }>;
}

function parseAllowlistToken(
  rawToken: string,
  allowlist: PrivateHostAllowlist,
) {
  const trimmed = rawToken.trim();
  if (!trimmed) return;

  let token = trimmed;
  try {
    if (/^https?:\/\//i.test(token)) {
      token = new URL(token).hostname;
    }
  } catch {
    return;
  }

  const cidrMatch = token.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d{1,2})$/);
  if (cidrMatch) {
    const base = ipv4ToNumber(cidrMatch[1]);
    const prefix = Number(cidrMatch[2]);
    if (
      base !== null &&
      Number.isInteger(prefix) &&
      prefix >= 0 &&
      prefix <= 32
    ) {
      const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
      allowlist.ipv4Cidrs.push({ base: base & mask, mask });
    }
    return;
  }

  const normalized = normalizeHostname(token);
  const version = isIP(normalized);
  if (version) {
    allowlist.exactIps.add(normalized);
    return;
  }

  if (normalized) {
    allowlist.hostnames.add(normalized);
  }
}

async function getPrivateHostAllowlist(): Promise<PrivateHostAllowlist> {
  const allowlist: PrivateHostAllowlist = {
    enabled: isTruthy(process.env[PRIVATE_HOST_ALLOW_ENV]),
    exactIps: new Set(),
    hostnames: new Set(),
    ipv4Cidrs: [],
  };

  if (!allowlist.enabled) return allowlist;

  const raw = process.env[PRIVATE_HOST_ALLOWLIST_ENV] || '';
  for (const token of raw.split(/[\s,]+/)) {
    parseAllowlistToken(token, allowlist);
  }

  await Promise.all(
    Array.from(allowlist.hostnames).map(async (hostname) => {
      try {
        const records = await lookup(hostname, { all: true, verbatim: true });
        for (const record of records) {
          allowlist.exactIps.add(normalizeHostname(record.address));
        }
      } catch {
        // Ignore allowlist hostnames that cannot be resolved right now.
      }
    }),
  );

  return allowlist;
}

function isAddressAllowlisted(
  address: string,
  allowlist: PrivateHostAllowlist,
): boolean {
  const normalized = normalizeHostname(address);
  if (allowlist.exactIps.has(normalized)) return true;

  const version = isIP(normalized);
  if (version === 4) {
    const value = ipv4ToNumber(normalized);
    return (
      value !== null &&
      allowlist.ipv4Cidrs.some(({ base, mask }) => (value & mask) === base)
    );
  }

  return false;
}

function isBlockedAddressAllowed(
  address: string,
  allowlist: PrivateHostAllowlist,
): boolean {
  if (!allowlist.enabled) return false;
  return isAddressAllowlisted(address, allowlist);
}

export async function validateProxyTargetUrl(rawUrl: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid url');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https supported');
  }

  if (parsed.username || parsed.password) {
    throw new Error('URL credentials are not supported');
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (isAlwaysBlockedHostname(hostname)) {
    throw new Error('Blocked host');
  }

  const privateHostAllowlist = await getPrivateHostAllowlist();
  if (
    isBlockedHostname(hostname) &&
    !privateHostAllowlist.hostnames.has(hostname)
  ) {
    throw new Error('Blocked host');
  }

  const literalVersion = isIP(hostname);
  if (literalVersion) {
    if (
      isBlockedAddress(hostname) &&
      !isBlockedAddressAllowed(hostname, privateHostAllowlist)
    ) {
      throw new Error('Blocked IP address');
    }
    return parsed.toString();
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('Host did not resolve');

  if (
    records.some(
      (record) =>
        isBlockedAddress(record.address) &&
        !isBlockedAddressAllowed(record.address, privateHostAllowlist),
    )
  ) {
    throw new Error('Host resolves to a blocked IP address');
  }

  return parsed.toString();
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWithValidatedRedirects(
  rawUrl: string,
  init: RequestInit,
  options: { timeoutMs: number; maxRedirects?: number },
): Promise<Response> {
  const maxRedirects = options.maxRedirects ?? 3;
  let currentUrl = rawUrl;

  for (let i = 0; i <= maxRedirects; i++) {
    const validatedUrl = await validateProxyTargetUrl(currentUrl);
    const response = await fetchWithTimeout(
      validatedUrl,
      { ...init, redirect: 'manual' },
      options.timeoutMs,
    );

    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.headers.has('location')
    ) {
      if (i === maxRedirects) throw new Error('Too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect location missing');
      currentUrl = new URL(location, validatedUrl).toString();
      continue;
    }

    return response;
  }

  throw new Error('Too many redirects');
}
