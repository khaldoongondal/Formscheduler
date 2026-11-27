/**
 * Webhook as a CrmProvider (P3.5): signed JSON POST of the FormBook event to
 * the tenant's address, for n8n, Zapier, Make and any other tool.
 */
import { webhookOutcome } from "@/lib/connections/webhook-outcome";
import type { ConnectionRow } from "@/lib/connections/service";
import type { CrmDeliveryOutcome, CrmProvider, FormBookEvent } from "@/lib/connections/types";
import { decryptSecret } from "@/lib/security/encryption";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import { safePostJson } from "@/lib/webhooks/safe-post";
import { webhookHeaders } from "@/lib/webhooks/signing";
import { checkWebhookUrl } from "@/lib/webhooks/url-safety";

export type WebhookCtx = { connectionId: string; endpointUrl: string; secret: string };

/** Null when the address or the secret is missing. */
export function webhookContext(row: ConnectionRow): WebhookCtx | null {
  if (row.provider !== "webhook" || !row.endpoint_url || !row.signing_secret_ciphertext) return null;
  return { connectionId: row.id, endpointUrl: row.endpoint_url, secret: decryptSecret(row.signing_secret_ciphertext) };
}

export async function postWebhookEvent(ctx: WebhookCtx, event: FormBookEvent, deliveryId: string): Promise<CrmDeliveryOutcome> {
  // The address is checked again at every send (it was valid when saved; rules may have changed).
  const checked = checkWebhookUrl(ctx.endpointUrl);
  if (!checked.ok) return { outcome: "failed", httpStatus: null, summary: WEBHOOK_COPY.blockedAddress };
  const rawBody = JSON.stringify(event);
  const headers = webhookHeaders({
    secret: ctx.secret,
    timestampSec: Math.floor(Date.now() / 1000),
    rawBody,
    eventType: event.type,
    deliveryId,
    eventId: event.id
  });
  return webhookOutcome(await safePostJson(checked.url, rawBody, headers));
}

export const webhookCrmProvider: CrmProvider<WebhookCtx> = {
  kind: "webhook",
  deliver(ctx, event, _lead, delivery) {
    return postWebhookEvent(ctx, event, delivery?.id ?? event.id);
  }
};
