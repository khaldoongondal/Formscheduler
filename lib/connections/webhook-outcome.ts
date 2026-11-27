/**
 * Turns a webhook POST result into a delivery outcome (P3.5). Pure.
 */
import type { CrmDeliveryOutcome } from "@/lib/connections/types";
import { classifyHttpOutcome } from "@/lib/crm/retry";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";

export type PostResult = { status: number | null; bodySnippet: string; error: string | null };

export function webhookOutcome(result: PostResult): CrmDeliveryOutcome {
  if (result.error === "blocked_address") {
    return { outcome: "failed", httpStatus: null, summary: WEBHOOK_COPY.blockedAddress };
  }
  if (result.error === "Redirects are not followed.") {
    return { outcome: "failed", httpStatus: result.status, summary: `HTTP ${result.status ?? ""} ${WEBHOOK_COPY.redirectNotFollowed}`.trim() };
  }
  if (result.status === null) {
    return {
      outcome: "retry",
      httpStatus: null,
      summary: result.error === "timed_out" ? WEBHOOK_COPY.timedOut : WEBHOOK_COPY.networkError
    };
  }
  // eslint-disable-next-line no-control-regex
  const snippet = result.bodySnippet.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 200);
  return {
    outcome: classifyHttpOutcome(result.status),
    httpStatus: result.status,
    summary: `HTTP ${result.status}${snippet ? ` ${snippet}` : ""}`.slice(0, 500)
  };
}
