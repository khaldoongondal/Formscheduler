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

/** What the drain re-reads about a row's form at send time. */
export type FunnelSendState = {
  meta_pixel_id: string | null;
  meta_consent_confirmed_at: string | null;
  is_published: boolean;
  taken_down_at: string | null;
  tenant_plan: string | null;
};

/**
 * True when a queued row may still go to Meta: its form exists for the same
 * tenant, still uses the row's pixel with the customer's consent
 * confirmation, is live and not taken down, and the tenant is not suspended.
 * A form that changed or dropped its pixel stops every row it queued.
 */
export function funnelStillSends(
  row: { pixel_id: string; funnel_id: string | null },
  funnel: FunnelSendState | null
): boolean {
  if (!row.funnel_id || !funnel) return false;
  if (!funnel.meta_pixel_id || funnel.meta_pixel_id !== row.pixel_id) return false;
  if (!funnel.meta_consent_confirmed_at) return false;
  if (funnel.is_published !== true || funnel.taken_down_at) return false;
  if (!funnel.tenant_plan || funnel.tenant_plan === "suspended") return false;
  return true;
}

/** Rows one cron run may claim; sends take a fraction of a second each. */
export const CRON_DRAIN_ROW_LIMIT = 400;
export const CRON_DRAIN_BATCH_SIZE = 20;
