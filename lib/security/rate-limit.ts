import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/security/client-ip";
import { DAILY_CAPS, IP_LIMITS, type IpLimitScope } from "@/lib/security/limits";
import {
  buildBucketKey,
  hashSubject,
  isOverLimit,
  utcDayStartSeconds,
  windowResetSeconds,
  windowStartSeconds
} from "@/lib/security/rate-limit-core";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Fixed-window rate limiter backed by Postgres (table rate_limit_counters and
 * the atomic RPC rate_limit_hit, migration 0021), so limits hold across
 * serverless instances. If the RPC fails the limiter fails open and logs, so a
 * database hiccup never takes public forms down.
 */

export function getIpHashSalt(): string {
  return process.env.FORMBOOK_IP_HASH_SALT ?? "";
}

/** Hashed client IP, used as the subject of IP limits and stored on reports. */
export function getHashedClientIp(headers: Headers): string {
  return hashSubject(getClientIp(headers), getIpHashSalt());
}

export async function hitRateLimit(opts: {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
  nowMs?: number;
}): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const nowMs = opts.nowMs ?? Date.now();
  const retryAfterSeconds = windowResetSeconds(nowMs, opts.windowSeconds);
  const bucketKey = buildBucketKey(opts.scope, opts.subject, windowStartSeconds(nowMs, opts.windowSeconds));

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_bucket_key: bucketKey,
      p_window_seconds: opts.windowSeconds
    });
    if (error || typeof data !== "number") {
      console.error("rate_limit_hit failed", opts.scope);
      return { allowed: true, retryAfterSeconds };
    }
    return { allowed: !isOverLimit(data, opts.limit), retryAfterSeconds };
  } catch {
    console.error("rate_limit_hit failed", opts.scope);
    return { allowed: true, retryAfterSeconds };
  }
}

function tooManyRequests(retryAfterSeconds: number) {
  return NextResponse.json(
    { error: "Too many requests. Please try again shortly." },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) }
    }
  );
}

/** Per-IP limit for a route. Returns a 429 response, or null when allowed. */
export async function enforceRateLimit(request: Request, scope: IpLimitScope): Promise<NextResponse | null> {
  const { limit, windowSeconds } = IP_LIMITS[scope];
  const result = await hitRateLimit({
    scope,
    subject: getHashedClientIp(request.headers),
    limit,
    windowSeconds
  });
  return result.allowed ? null : tooManyRequests(result.retryAfterSeconds);
}

/** Per-IP limit for server actions (pass `await headers()`). Returns true when allowed. */
export async function checkActionRateLimit(headers: Headers, scope: IpLimitScope): Promise<boolean> {
  const { limit, windowSeconds } = IP_LIMITS[scope];
  const result = await hitRateLimit({
    scope,
    subject: getHashedClientIp(headers),
    limit,
    windowSeconds
  });
  return result.allowed;
}

const DAILY_CAP_CONFIG = {
  lead: { scope: "cap-lead", perForm: DAILY_CAPS.leadSessionsPerForm, perTenant: DAILY_CAPS.leadSessionsPerTenant },
  analytics: { scope: "cap-analytics", perForm: DAILY_CAPS.analyticsPerForm, perTenant: DAILY_CAPS.analyticsPerTenant },
  report: { scope: "cap-report", perForm: DAILY_CAPS.reportsPerForm, perTenant: null }
} as const;

/** Daily caps per form and per tenant (UTC day). Returns true when allowed. */
export async function enforceDailyCap(
  kind: "lead" | "analytics" | "report",
  ids: { funnelId: string; tenantId?: string }
): Promise<boolean> {
  const config = DAILY_CAP_CONFIG[kind];
  const nowMs = Date.now();
  // The UTC day start is part of the key, so each day starts from zero.
  const dayStart = utcDayStartSeconds(nowMs);
  const windowSeconds = 86400;

  const checks: Array<Promise<{ allowed: boolean }>> = [
    hitRateLimit({ scope: config.scope, subject: `form-${ids.funnelId}`, limit: config.perForm, windowSeconds, nowMs: dayStart * 1000 })
  ];
  if (ids.tenantId && config.perTenant !== null) {
    checks.push(
      hitRateLimit({
        scope: config.scope,
        subject: `tenant-${ids.tenantId}`,
        limit: config.perTenant,
        windowSeconds,
        nowMs: dayStart * 1000
      })
    );
  }

  const results = await Promise.all(checks);
  return results.every((result) => result.allowed);
}
