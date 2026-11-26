/**
 * Pure rate limit maths and key building. No Next.js or Supabase imports, so
 * node:test can load it. I/O lives in lib/security/rate-limit.ts.
 */
import { createHash } from "node:crypto";

const SCOPE_PATTERN = /^[a-z0-9:_-]{1,40}$/;

/** Start of the fixed window that contains `nowMs`, in whole seconds. */
export function windowStartSeconds(nowMs: number, windowSeconds: number): number {
  return Math.floor(nowMs / 1000 / windowSeconds) * windowSeconds;
}

/** Seconds until the current window ends, at least 1. */
export function windowResetSeconds(nowMs: number, windowSeconds: number): number {
  const end = windowStartSeconds(nowMs, windowSeconds) + windowSeconds;
  return Math.max(1, Math.ceil(end - nowMs / 1000));
}

/** sha256(`${salt}:${subject}`) as hex, first 32 characters. */
export function hashSubject(subject: string, salt: string): string {
  return createHash("sha256").update(`${salt}:${subject}`).digest("hex").slice(0, 32);
}

/** `${scope}:${subject}:${windowStart}`. Throws on an invalid scope name. */
export function buildBucketKey(scope: string, subject: string, windowStart: number): string {
  if (!SCOPE_PATTERN.test(scope)) {
    throw new Error(`Invalid rate limit scope: ${scope}`);
  }
  return `${scope}:${subject}:${windowStart}`;
}

/** Start of the UTC day that contains `nowMs`, in seconds. */
export function utcDayStartSeconds(nowMs: number): number {
  return windowStartSeconds(nowMs, 86400);
}

/** The counter includes the current hit, so `limit` hits are allowed. */
export function isOverLimit(hits: number, limit: number): boolean {
  return hits > limit;
}
