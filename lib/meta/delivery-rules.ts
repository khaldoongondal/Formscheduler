/**
 * Retry rules for Meta deliveries, ported from Mission Control.
 * Pure: no Next.js or Supabase imports.
 */

import { META_SEND_TIMEOUT_MS } from "@/lib/meta/constants";

/**
 * A 4xx is a request Meta will refuse the same way forever, so it fails.
 * 429, 5xx and network errors are retried. Meta's own error body wins over
 * the HTTP status: transient faults and rate limits come back as HTTP 400
 * with `is_transient` or codes 1, 2, 4, 17, 32, 613. Unknown shapes retry.
 */
export function classifyFailure(status: number | null, response?: unknown): "retry" | "failed" {
  if (status === null) return "retry";

  const error =
    response && typeof response === "object" && "error" in response
      ? ((response as { error?: unknown }).error as Record<string, unknown> | null | undefined)
      : null;
  if (error && typeof error === "object") {
    if (error.is_transient === true) return "retry";
    const code = typeof error.code === "number" ? error.code : null;
    if (code !== null && [1, 2, 4, 17, 32, 613].includes(code)) return "retry";
  }

  if (status === 429) return "retry";
  if (status >= 500) return "retry";
  if (status >= 400) return "failed";
  return "retry";
}

/** Seconds to wait after a failed attempt; mirrors settle_meta_delivery. */
export function retryDelaySeconds(attemptsAfterClaim: number): number {
  const n = Math.max(1, Math.floor(attemptsAfterClaim));
  return Math.min(30 * 2 ** (n - 1), 3600);
}

/** One send at worst: the Meta timeout plus room for claim and settle round trips. */
export const WORST_CASE_DELIVERY_MS = META_SEND_TIMEOUT_MS + 4000;

export function shouldStopClaiming(startedMs: number, nowMs: number, budgetMs: number): boolean {
  return budgetMs - (nowMs - startedMs) <= WORST_CASE_DELIVERY_MS;
}
