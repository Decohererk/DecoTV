/*
 * In-memory login rate limiter (per instance) — OPT-IN, disabled by default.
 *
 * Why opt-in: the limiter can only be as trustworthy as the client IP it
 * keys on, and in the common deployments (direct Docker/LAN, or a reverse
 * proxy that forwards its own address) every request is observed with the
 * same gateway/proxy IP. Enabling limiting unconditionally then collapses all
 * clients into one bucket, so a few failed attempts — including the failures a
 * stale post-upgrade session produces — lock the whole instance out with 429s.
 * That self-inflicted login outage is worse than the brute-force it prevents
 * for a self-hosted app, so the default is OFF: login can never be throttled
 * out of the box.
 *
 * Operators who terminate TLS at a proxy that forwards the real client IP via
 * X-Forwarded-For / X-Real-IP can set LOGIN_RATE_LIMIT=true to enable it.
 * Limits are then keyed on that client IP so a limited client can never lock
 * out a different client (or the operator) on the same account. State lives in
 * module memory: multi-instance deployments bound attempts per instance; put a
 * shared limiter (WAF, reverse proxy) in front for stronger guarantees.
 */
import type { NextRequest } from 'next/server';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES_PER_IP_ACCOUNT = 5;
const MAX_FAILURES_PER_IP = 15;
// Bound memory when attackers spray random usernames or spoofed IPs.
const MAX_TRACKED_KEYS = 10_000;

const failures = new Map<string, number[]>();

function isEnabled(): boolean {
  return ['1', 'true', 'yes', 'on'].includes(
    (process.env.LOGIN_RATE_LIMIT || '').toLowerCase(),
  );
}

// Returns the forwarded client IP, or null when none is available. Null means
// "cannot safely attribute this request to a client" and disables limiting.
export function getClientIp(
  request: Pick<NextRequest, 'headers'>,
): string | null {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0].trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  return realIp && realIp.trim() ? realIp.trim() : null;
}

function normalizeAccount(username: string): string {
  return username.trim().toLowerCase();
}

// Buckets are keyed on the client IP so a limited client can never lock out a
// different client (or the operator) on the same account. Returns [] when the
// limiter is disabled or no client IP is available, which skips limiting.
function keysFor(request: Pick<NextRequest, 'headers'>, username: string) {
  if (!isEnabled()) return [];

  const ip = getClientIp(request);
  if (!ip) return [];

  const account = normalizeAccount(username);
  return [
    { key: `combo:${ip}:${account}`, max: MAX_FAILURES_PER_IP_ACCOUNT },
    // Bound one IP spraying many usernames, still scoped to that IP only.
    { key: `ip:${ip}`, max: MAX_FAILURES_PER_IP },
  ];
}

function recentFailures(key: string, now: number): number[] {
  const timestamps = (failures.get(key) || []).filter(
    (at) => at > now - WINDOW_MS,
  );
  if (timestamps.length === 0) {
    failures.delete(key);
  } else {
    failures.set(key, timestamps);
  }
  return timestamps;
}

export function checkLoginRateLimit(
  request: Pick<NextRequest, 'headers'>,
  username: string,
  now = Date.now(),
): { limited: boolean; retryAfterSeconds: number } {
  let retryAfterMs = 0;

  for (const { key, max } of keysFor(request, username)) {
    const timestamps = recentFailures(key, now);
    if (timestamps.length >= max) {
      const oldestCounted = timestamps[timestamps.length - max];
      retryAfterMs = Math.max(retryAfterMs, oldestCounted + WINDOW_MS - now);
    }
  }

  return {
    limited: retryAfterMs > 0,
    retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
  };
}

export function recordLoginFailure(
  request: Pick<NextRequest, 'headers'>,
  username: string,
  now = Date.now(),
): void {
  if (failures.size >= MAX_TRACKED_KEYS) {
    const oldestKey = failures.keys().next().value;
    if (oldestKey !== undefined) failures.delete(oldestKey);
  }

  for (const { key } of keysFor(request, username)) {
    failures.set(key, [...recentFailures(key, now), now]);
  }
}

export function recordLoginSuccess(
  request: Pick<NextRequest, 'headers'>,
  username: string,
): void {
  for (const { key } of keysFor(request, username)) {
    failures.delete(key);
  }
}

export function resetLoginRateLimitForTests(): void {
  failures.clear();
}
