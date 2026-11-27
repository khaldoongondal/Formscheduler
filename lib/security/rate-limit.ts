import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/security/client-ip";
import { DAILY_CAPS, EMAIL_SEND_COOLDOWNS, IP_LIMITS, type EmailSendScope, type IpLimitScope } from "@/lib/security/limits";
import {
  buildBucketKey,
  buildDailyCapChecks,
  hashSubject,
  isOverLimit,
  runCapChecks,
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

/**
 * Like hitRateLimit, but only adds the hit while under the limit (RPC
 * rate_limit_hit_capped, migration 0024), so refused requests do not count.
 * Falls back to the counting RPC if 0024 is not applied yet.
 */
export async function hitCappedLimit(opts: {
  scope: string;
  subject: string;
  limit: number;
  windowSeconds: number;
  nowMs?: number;
}): Promise<{ allowed: boolean }> {
  const nowMs = opts.nowMs ?? Date.now();
  const bucketKey = buildBucketKey(opts.scope, opts.subject, windowStartSeconds(nowMs, opts.windowSeconds));

  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("rate_limit_hit_capped", {
      p_bucket_key: bucketKey,
      p_window_seconds: opts.windowSeconds,
      p_limit: opts.limit
    });
    if (!error && typeof data === "boolean") return { allowed: data };
    console.error("rate_limit_hit_capped failed", opts.scope);
  } catch {
    console.error("rate_limit_hit_capped failed", opts.scope);
  }
  return hitRateLimit(opts);
}

/**
 * Per-address cooldown for outgoing emails (verification, password reset).
 * Returns true when an email may be sent to this address now.
 */
export async function allowEmailSend(scope: EmailSendScope, email: string): Promise<boolean> {
  const { limit, windowSeconds } = EMAIL_SEND_COOLDOWNS[scope];
  const result = await hitCappedLimit({
    scope,
    subject: hashSubject(email.trim().toLowerCase(), getIpHashSalt()),
    limit,
    windowSeconds
  });
  return result.allowed;
}

const DAILY_CAP_CONFIG = {
  lead: {
    scope: "cap-lead",
    perIpPerForm: DAILY_CAPS.leadSessionsPerIpPerForm,
    perForm: DAILY_CAPS.leadSessionsPerForm,
    perTenant: DAILY_CAPS.leadSessionsPerTenant
  },
  analytics: {
    scope: "cap-analytics",
    perIpPerForm: DAILY_CAPS.analyticsPerIpPerForm,
    perForm: DAILY_CAPS.analyticsPerForm,
    perTenant: DAILY_CAPS.analyticsPerTenant
  },
  report: {
    scope: "cap-report",
    perIpPerForm: DAILY_CAPS.reportsPerIpPerForm,
    perForm: DAILY_CAPS.reportsPerForm,
    perTenant: null
  }
} as const;

/**
 * Daily caps (UTC day): per IP and form, then per form, then per tenant.
 * Checks stop at the first block, and the shared form and tenant counters
 * only count requests that are allowed. Returns true when allowed.
 */
export async function enforceDailyCap(
  kind: "lead" | "analytics" | "report",
  ids: { funnelId: string; tenantId?: string; headers?: Headers }
): Promise<boolean> {
  const config = DAILY_CAP_CONFIG[kind];
  // The UTC day start is part of the key, so each day starts from zero.
  const dayStartMs = utcDayStartSeconds(Date.now()) * 1000;
  const windowSeconds = 86400;

  const checks = buildDailyCapChecks({
    scope: config.scope,
    funnelId: ids.funnelId,
    tenantId: ids.tenantId,
    ipHash: ids.headers ? getHashedClientIp(ids.headers) : undefined,
    perIpPerForm: config.perIpPerForm,
    perForm: config.perForm,
    perTenant: config.perTenant
  });

  return runCapChecks(checks, async (check) => {
    const args = { scope: check.scope, subject: check.subject, limit: check.limit, windowSeconds, nowMs: dayStartMs };
    const result = check.mode === "capped" ? await hitCappedLimit(args) : await hitRateLimit(args);
    return result.allowed;
  });
}
