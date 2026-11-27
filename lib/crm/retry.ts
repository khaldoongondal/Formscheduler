/**
 * CRM delivery retry rules (decision C19). Pure: no imports.
 * crmRetryDelaySeconds mirrors settle_crm_delivery in migration 0031.
 */

export const CRM_MAX_ATTEMPTS = 8;
export const CRM_SEND_TIMEOUT_MS = 10_000;
const MAX_DELAY_SECONDS = 21_600;

/** Seconds until the next try after `attemptsAfterClaim` attempts: min(60 * 2^(n-1), 21600). */
export function crmRetryDelaySeconds(attemptsAfterClaim: number): number {
  const n = Math.max(1, Math.floor(Number.isFinite(attemptsAfterClaim) ? attemptsAfterClaim : 1));
  if (n > 20) return MAX_DELAY_SECONDS;
  return Math.min(60 * 2 ** (n - 1), MAX_DELAY_SECONDS);
}

/** null (network error or timeout) retries; 2xx sent; 408, 425, 429, 5xx retry; anything else fails. */
export function classifyHttpOutcome(status: number | null): "sent" | "retry" | "failed" {
  if (status === null || !Number.isFinite(status)) return "retry";
  if (status >= 200 && status < 300) return "sent";
  if (status === 408 || status === 425 || status === 429 || status >= 500) return "retry";
  return "failed";
}

/** Stop claiming new rows when what is left of the budget could not finish one more send. */
export function shouldStopClaiming(startedMs: number, nowMs: number, budgetMs: number): boolean {
  return budgetMs - (nowMs - startedMs) <= CRM_SEND_TIMEOUT_MS + 4000;
}

/** Total wait across every retry, for copy such as "about 2 hours". */
export function totalRetryWindowSeconds(maxAttempts = CRM_MAX_ATTEMPTS): number {
  let total = 0;
  for (let attempt = 1; attempt < maxAttempts; attempt += 1) total += crmRetryDelaySeconds(attempt);
  return total;
}
