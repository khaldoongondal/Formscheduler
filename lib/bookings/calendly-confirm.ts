/**
 * Calendly booking confirmations (P3.7): the browser fast path, checked
 * against the Calendly API with the tenant's token, and the signed webhook.
 * Both record through recordCalendlyBooking, idempotent on the invitee uri.
 */
import { PublicError } from "@/lib/api/responses";
import { createOutcomeRecorder } from "@/lib/bookings/outcomes";
import { getEvent, getInvitee } from "@/lib/calendly/client";
import { CALENDLY_COPY } from "@/lib/calendly/constants";
import { matchesLead, parseCalendlyInviteePayload, type CalendlyInvitee } from "@/lib/calendly/mapping";
import { verifyCalendlySignature } from "@/lib/calendly/signature";
import {
  calendlyFormSettings,
  calendlyToken,
  cancelCalendlyBooking,
  findLeadForInvitee,
  recordCalendlyBooking
} from "@/lib/connections/calendly";
import { getConnectionRowForTenant, getConnectionRowForWebhook } from "@/lib/connections/service";
import { assertFunnelServesPublic } from "@/lib/funnels/public-gate";
import { getLeadSession } from "@/lib/lead-sessions/service";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import { decryptSecret } from "@/lib/security/encryption";
import { calendlyConfirmSchema } from "@/lib/validation/calendly";

const NOT_AVAILABLE = "Booking is not available for this form right now. Please try again later.";

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}

/** POST /api/bookings/calendly. Throws PublicError for anything the visitor should see. */
export async function confirmCalendlyFromClient(input: unknown): Promise<{ metaEvents: Array<QueuedMetaEvent | null> }> {
  const parsed = calendlyConfirmSchema.parse(input);
  let session;
  try {
    session = await getLeadSession(parsed.lead_session_id);
  } catch {
    throw new PublicError("This booking session was not found.", 404);
  }
  if (session.status === "disqualified") throw new PublicError("This lead is not eligible to book an appointment.");
  const funnel = await assertFunnelServesPublic(session.funnel_id);
  if ((funnel.calendar_provider ?? "ghl") !== "calendly" || !funnel.calendar_connection_id) {
    throw new PublicError(NOT_AVAILABLE, 400);
  }
  const connection = await getConnectionRowForTenant(funnel.tenant_id, funnel.calendar_connection_id);
  if (!connection || connection.provider !== "calendly" || connection.status !== "connected") {
    throw new PublicError(NOT_AVAILABLE, 503);
  }
  if (session.status === "booked") return { metaEvents: [] };

  const recorder = createOutcomeRecorder();
  const refuse = async (message: string): Promise<never> => {
    await recorder
      .record("booking_error", session, funnel, { provider: "calendly", phase: "calendly_confirm", message })
      .catch(() => console.error("[calendly] outcome record failed"));
    throw new PublicError(CALENDLY_COPY.confirmPending, 409);
  };

  const { eventTypeUri } = calendlyFormSettings(funnel);
  if (!parsed.invitee_uri.startsWith(`${parsed.event_uri}/invitees/`)) return refuse("invitee_event_mismatch");

  let invitee: CalendlyInvitee | null;
  let event;
  try {
    const token = calendlyToken(connection);
    [invitee, event] = await Promise.all([getInvitee(token, parsed.invitee_uri), getEvent(token, parsed.event_uri)]);
  } catch (error) {
    console.error("[calendly] confirm lookup failed", errorName(error));
    return refuse("lookup_failed");
  }
  if (!invitee || !event) return refuse("not_found");
  if (!eventTypeUri || event.eventTypeUri !== eventTypeUri) return refuse("event_type_mismatch");
  if (event.status !== "active") return refuse("event_not_active");
  if (!session.external_ref || !matchesLead(invitee, { externalRef: session.external_ref, email: session.email })) {
    return refuse("lead_mismatch");
  }

  const { metaEvents } = await recordCalendlyBooking({
    funnel,
    session,
    connectionId: connection.id,
    invitee: { ...invitee, eventUri: event.uri, eventTypeUri: event.eventTypeUri, start: event.start, end: event.end },
    source: "client"
  });
  return { metaEvents };
}

export type CalendlyWebhookResult = { status: 200 | 401 | 404; metaEvents: Array<QueuedMetaEvent | null> };

/** POST /api/webhooks/calendly/[connectionId]. Always 200 after a valid signature. */
export async function handleCalendlyWebhook(
  connectionId: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<CalendlyWebhookResult> {
  const connection = await getConnectionRowForWebhook(connectionId, "calendly");
  if (!connection) return { status: 404, metaEvents: [] };
  if (!connection.signing_secret_ciphertext) return { status: 401, metaEvents: [] };
  let signingKey: string;
  try {
    signingKey = decryptSecret(connection.signing_secret_ciphertext);
  } catch {
    return { status: 401, metaEvents: [] };
  }
  if (!verifyCalendlySignature(signatureHeader, rawBody, signingKey, Math.floor(Date.now() / 1000))) {
    console.error("[calendly] bad signature");
    return { status: 401, metaEvents: [] };
  }

  try {
    let body: unknown = null;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return { status: 200, metaEvents: [] };
    }
    const { event, invitee } = parseCalendlyInviteePayload(body);
    if (!invitee) return { status: 200, metaEvents: [] };

    if (event === "invitee.canceled") {
      await cancelCalendlyBooking(connection, invitee.uri);
      return { status: 200, metaEvents: [] };
    }
    if (event !== "invitee.created") return { status: 200, metaEvents: [] };

    const found = await findLeadForInvitee(connection, invitee);
    if (!found || found.session.status === "disqualified") {
      console.error("[calendly] unmatched booking");
      return { status: 200, metaEvents: [] };
    }
    const { eventTypeUri } = calendlyFormSettings(found.funnel);
    let invitedEventType = invitee.eventTypeUri;
    let start = invitee.start;
    let end = invitee.end;
    if ((!invitedEventType || !start) && invitee.eventUri) {
      const scheduled = await getEvent(calendlyToken(connection), invitee.eventUri).catch(() => null);
      invitedEventType = invitedEventType ?? scheduled?.eventTypeUri ?? null;
      start = start ?? scheduled?.start ?? null;
      end = end ?? scheduled?.end ?? null;
    }
    if (!eventTypeUri || invitedEventType !== eventTypeUri) {
      console.error("[calendly] booking for another event type");
      return { status: 200, metaEvents: [] };
    }
    const { metaEvents } = await recordCalendlyBooking({
      funnel: found.funnel,
      session: found.session,
      connectionId: connection.id,
      invitee: { ...invitee, eventTypeUri: invitedEventType, start, end },
      source: "webhook"
    });
    return { status: 200, metaEvents };
  } catch (error) {
    // Calendly retries non-2xx; a processing error is logged and answered with 500 so it does.
    console.error("[calendly] webhook processing failed", errorName(error));
    throw error;
  }
}
