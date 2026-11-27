/**
 * Calendly as a CalendarProvider in embed mode (P3.7, decisions C6, C15, C16).
 * The last step shows Calendly's scheduler; FormBook records the booking when
 * Calendly confirms it, through the browser fast path (checked against the
 * Calendly API) or the signed webhook. Both are idempotent on the invitee uri.
 */
import { randomBytes } from "node:crypto";
import { createOutcomeRecorder } from "@/lib/bookings/outcomes";
import {
  createWebhookSubscription,
  deleteWebhookSubscription,
  getCurrentUser,
  listEventTypes,
  listWebhookSubscriptions
} from "@/lib/calendly/client";
import {
  CALENDLY_COPY,
  EVENT_TYPE_URI_PATTERN,
  ORGANIZATION_URI_PATTERN,
  SCHEDULING_URL_PATTERN,
  USER_URI_PATTERN
} from "@/lib/calendly/constants";
import { buildCalendlyEmbed } from "@/lib/calendly/embed";
import { isUpgradeRefusal, type CalendlyEventType, type CalendlyInvitee } from "@/lib/calendly/mapping";
import { ProviderHttpError } from "@/lib/connections/http";
import { getConnectionRowForTenant, markConnectionStatus, type ConnectionRow } from "@/lib/connections/service";
import type { CalendarProvider } from "@/lib/connections/types";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { createServiceClient } from "@/lib/supabase/server";
import type { BookingAttempt, Funnel, Json, LeadSession } from "@/lib/types/database";

export type CalendlyCtx = { connectionId: string; schedulingUrl: string };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function calendlyFormSettings(funnel: Pick<Funnel, "calendar_settings">): { eventTypeUri: string | null; schedulingUrl: string | null } {
  const settings = asRecord(funnel.calendar_settings);
  const eventTypeUri = typeof settings.event_type_uri === "string" && EVENT_TYPE_URI_PATTERN.test(settings.event_type_uri) ? settings.event_type_uri : null;
  const schedulingUrl =
    typeof settings.scheduling_url === "string" && SCHEDULING_URL_PATTERN.test(settings.scheduling_url) ? settings.scheduling_url : null;
  return { eventTypeUri, schedulingUrl };
}

/** Null when the form has no event type or confirmations are not set up. */
export function calendlyContext(row: ConnectionRow, funnel: Funnel): CalendlyCtx | null {
  if (row.provider !== "calendly" || !row.secret_ciphertext) return null;
  const { eventTypeUri, schedulingUrl } = calendlyFormSettings(funnel);
  if (!eventTypeUri || !schedulingUrl) return null;
  return { connectionId: row.id, schedulingUrl };
}

export const calendlyProvider: CalendarProvider<CalendlyCtx> = {
  kind: "calendly",
  mode: "embed",
  async embed(ctx, lead, tracking) {
    return buildCalendlyEmbed({ schedulingUrl: ctx.schedulingUrl, lead, tracking });
  }
};

export function calendlyToken(row: ConnectionRow): string {
  if (!row.secret_ciphertext) throw new Error("calendly_no_token");
  return decryptSecret(row.secret_ciphertext);
}

export function calendlySettings(row: ConnectionRow): { userUri: string | null; organizationUri: string | null; subscriptionUri: string | null } {
  const settings = asRecord(row.settings);
  return {
    userUri: typeof settings.user_uri === "string" && USER_URI_PATTERN.test(settings.user_uri) ? settings.user_uri : null,
    organizationUri:
      typeof settings.organization_uri === "string" && ORGANIZATION_URI_PATTERN.test(settings.organization_uri) ? settings.organization_uri : null,
    subscriptionUri: typeof settings.webhook_subscription_uri === "string" ? settings.webhook_subscription_uri : null
  };
}

export function calendlyWebhookUrl(connectionId: string): string | null {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (!appUrl || !/^https:\/\//i.test(appUrl)) return null;
  return `${appUrl}/api/webhooks/calendly/${connectionId}`;
}

function statusOf(error: unknown) {
  return error instanceof ProviderHttpError ? error.status : null;
}

/** Network errors and timeouts (no status), rate limits and server errors may pass on their own. */
export function isTemporaryFailure(status: number | null): boolean {
  return status === null || status === 408 || status === 429 || status >= 500;
}

/** Fixed messages for the create and replace forms. */
export async function verifyCalendlyToken(token: string) {
  try {
    return await getCurrentUser(token);
  } catch (error) {
    if (statusOf(error) === 401 || statusOf(error) === 403) throw new Error(CALENDLY_COPY.tokenRejected);
    console.error("[calendly] token check failed", statusOf(error) ?? "unknown");
    throw new Error(CALENDLY_COPY.tokenCheckFailed);
  }
}

/**
 * Creates the webhook subscription with a fresh signing key (P3.7 steps 1 to 4).
 * Never throws for a Calendly refusal: the connection keeps `needs_attention`
 * with a fixed message, which blocks activation (C16).
 */
export async function setupCalendlyConfirmations(row: ConnectionRow): Promise<{ ok: boolean; message: string }> {
  const supabase = createServiceClient();
  const settings = asRecord(row.settings);
  const { userUri, organizationUri } = calendlySettings(row);
  const callbackUrl = calendlyWebhookUrl(row.id);

  // True once the subscription that signs with the stored key is known to be gone at Calendly.
  let oldSubscriptionGone = !row.signing_secret_ciphertext;

  /**
   * The stored signing key is cleared only when its subscription is gone,
   * since that subscription still signs live webhooks with it. A temporary
   * failure (network, timeout, 429 or 5xx) before anything changed at
   * Calendly leaves the connection exactly as it was.
   */
  const fail = async (message: string, options: { temporary?: boolean } = {}) => {
    if (options.temporary && !oldSubscriptionGone) {
      return { ok: false, message: CALENDLY_COPY.setupTemporaryFailure };
    }
    const nextSettings = { ...settings };
    if (oldSubscriptionGone) delete nextSettings.webhook_subscription_uri;
    await supabase
      .from("connections")
      .update({
        settings: nextSettings as Json,
        ...(oldSubscriptionGone ? { signing_secret_ciphertext: null, signing_secret_last_four: null } : {}),
        ...(row.status === "disabled" ? {} : { status: "needs_attention" as const, status_message: message.slice(0, 300) })
      })
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id);
    return { ok: false, message };
  };

  if (!callbackUrl) return fail(CALENDLY_COPY.appUrlMissing);
  if (!userUri || !organizationUri) return fail(CALENDLY_COPY.setupFailed);

  let token: string;
  try {
    token = calendlyToken(row);
  } catch {
    return fail(CALENDLY_COPY.setupFailed);
  }

  const signingKey = randomBytes(32).toString("base64url");
  try {
    // Old subscriptions for our address carry a key we no longer know.
    // A delete that fails stops here, so the old key is kept while its subscription may still exist.
    const existing = await listWebhookSubscriptions(token, { organization: organizationUri, user: userUri });
    for (const subscription of existing) {
      if (subscription.callbackUrl === callbackUrl) {
        await deleteWebhookSubscription(token, subscription.uri);
      }
    }
    oldSubscriptionGone = true;
    const subscription = await createWebhookSubscription(token, {
      url: callbackUrl,
      organization: organizationUri,
      user: userUri,
      signingKey
    });
    const { error } = await supabase
      .from("connections")
      .update({
        settings: { ...settings, webhook_subscription_uri: subscription.uri } as Json,
        signing_secret_ciphertext: encryptSecret(signingKey),
        signing_secret_last_four: null,
        ...(row.status === "disabled" ? {} : { status: "connected" as const, status_message: null })
      })
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id);
    if (error) throw new Error(error.message);
    return { ok: true, message: CALENDLY_COPY.confirmationsSetUp };
  } catch (error) {
    const status = statusOf(error);
    console.error("[calendly] confirmations setup failed", status ?? (error instanceof Error ? error.name : "unknown"));
    if (status === 401) return fail(CALENDLY_COPY.tokenNoLongerAccepted);
    if (status === 403) {
      const message = error instanceof Error ? error.message : "";
      return fail(isUpgradeRefusal(message) ? CALENDLY_COPY.refusedUpgrade : CALENDLY_COPY.refused);
    }
    return fail(CALENDLY_COPY.setupFailed, { temporary: isTemporaryFailure(status) });
  }
}

/** Best effort, before the connection row is deleted. */
export async function removeCalendlySubscription(row: ConnectionRow): Promise<void> {
  const { subscriptionUri } = calendlySettings(row);
  if (!subscriptionUri || !row.secret_ciphertext) return;
  await deleteWebhookSubscription(calendlyToken(row), subscriptionUri);
}

export async function checkCalendlyConnection(row: ConnectionRow): Promise<{ ok: boolean; summary: string }> {
  try {
    await getCurrentUser(calendlyToken(row));
    return { ok: true, summary: CALENDLY_COPY.checkOk };
  } catch (error) {
    if (statusOf(error) === 401 || statusOf(error) === 403) {
      await markConnectionStatus(row.id, "needs_attention", CALENDLY_COPY.tokenNoLongerAccepted).catch(() => undefined);
      return { ok: false, summary: CALENDLY_COPY.tokenNoLongerAccepted };
    }
    return { ok: false, summary: CALENDLY_COPY.checkFailed };
  }
}

export type CalendlyEventTypesResult = { ok: true; eventTypes: CalendlyEventType[] } | { ok: false };

/** Active event types of a tenant's own Calendly connection (editor picker and save re-validation, C23). */
export async function loadCalendlyEventTypes(tenantId: string, connectionId: string): Promise<CalendlyEventTypesResult> {
  try {
    const row = await getConnectionRowForTenant(tenantId, connectionId);
    if (!row || row.provider !== "calendly" || !row.secret_ciphertext) return { ok: false };
    const { userUri } = calendlySettings(row);
    if (!userUri) return { ok: false };
    return { ok: true, eventTypes: await listEventTypes(calendlyToken(row), userUri) };
  } catch (error) {
    console.error("[calendly] event types failed", statusOf(error) ?? "unknown");
    return { ok: false };
  }
}

/**
 * Records a confirmed Calendly booking once (unique invitee uri per
 * connection, migration 0031). Another booking at the same start (a group
 * event) cannot get a row under the 0030 slot index; the lead is then still
 * recorded as booked without a booking_attempts row.
 *
 * A repeat confirmation (webhook retry, or the other source) always re-reads
 * the lead and runs the recorder again: if the first run stopped after the
 * attempt row was written, the retry finishes the job. The recorder's atomic
 * booked transition keeps it to one recording per lead. Throws when the
 * booked status could not be saved, so the webhook answers 500 and Calendly
 * retries.
 */
export async function recordCalendlyBooking(input: {
  funnel: Funnel;
  session: LeadSession;
  connectionId: string;
  invitee: CalendlyInvitee;
  source: "client" | "webhook";
}): Promise<{ attempt: BookingAttempt | null; metaEvents: Array<QueuedMetaEvent | null> }> {
  const { funnel, connectionId, invitee, source } = input;
  let session = input.session;
  const supabase = createServiceClient();
  const timezone = invitee.timezone ?? "UTC";
  const { data: attempt, error } = await supabase
    .from("booking_attempts")
    .insert({
      tenant_id: session.tenant_id,
      funnel_id: session.funnel_id,
      lead_session_id: session.id,
      provider: "calendly",
      calendar_connection_id: connectionId,
      external_booking_id: invitee.uri,
      slot_start: invitee.start,
      slot_end: invitee.end,
      timezone,
      status: "booked",
      request_payload: { source } as Json,
      response_payload: { event_uri: invitee.eventUri, event_type_uri: invitee.eventTypeUri, status: invitee.status } as Json
    })
    .select("*")
    .single();

  if (error) {
    if (error.code !== "23505") throw new Error(error.message);
    const { data: existing, error: existingError } = await supabase
      .from("booking_attempts")
      .select("id")
      .eq("tenant_id", session.tenant_id)
      .eq("calendar_connection_id", connectionId)
      .eq("external_booking_id", invitee.uri)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) console.error("[calendly] booking recorded without attempt row");
    // The other confirmation source, or an earlier run that stopped part way, wrote the row:
    // read the current status so the recorder records the booking only if it is still missing.
    const { data: fresh, error: freshError } = await supabase
      .from("lead_sessions")
      .select("*")
      .eq("id", session.id)
      .eq("tenant_id", session.tenant_id)
      .maybeSingle();
    if (freshError) throw new Error(freshError.message);
    if (fresh) session = fresh as LeadSession;
  }

  const recorder = createOutcomeRecorder();
  const { metaEvents, incomplete } = await recorder.record("booked", session, funnel, {
    provider: "calendly",
    externalBookingId: invitee.uri,
    booking: {
      provider: "calendly",
      start: invitee.start ?? new Date().toISOString(),
      end: invitee.end ?? invitee.start ?? new Date().toISOString(),
      timezone,
      externalId: invitee.uri,
      meetingUrl: null
    }
  });
  if (incomplete) throw new Error("calendly_booked_status_not_saved");
  return { attempt: attempt ?? null, metaEvents };
}

/** Sets the matching attempt to cancelled (C27); nothing else changes. */
export async function cancelCalendlyBooking(row: ConnectionRow, inviteeUri: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("booking_attempts")
    .update({ status: "cancelled" })
    .eq("tenant_id", row.tenant_id)
    .eq("calendar_connection_id", row.id)
    .eq("external_booking_id", inviteeUri);
  if (error) throw new Error(error.message);
}

const MATCHABLE_STATUSES = ["potential", "qualified", "slots_shown"] as const;

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Finds the lead a webhook booking belongs to, within the connection's tenant
 * and forms that use this connection: (a) by the opaque reference, else (b)
 * by the most recent open lead with the same email in the last 7 days.
 */
export async function findLeadForInvitee(
  row: ConnectionRow,
  invitee: CalendlyInvitee
): Promise<{ session: LeadSession; funnel: Funnel } | null> {
  const supabase = createServiceClient();
  const { data: funnels, error: funnelsError } = await supabase
    .from("funnels")
    .select("*")
    .eq("tenant_id", row.tenant_id)
    .eq("calendar_provider", "calendly")
    .eq("calendar_connection_id", row.id);
  if (funnelsError) throw new Error(funnelsError.message);
  const forms = (funnels ?? []) as Funnel[];
  if (!forms.length) return null;
  const formIds = forms.map((form) => form.id);

  const ref = invitee.tracking.salesforce_uuid;
  if (ref && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) {
    const { data, error } = await supabase
      .from("lead_sessions")
      .select("*")
      .eq("tenant_id", row.tenant_id)
      .eq("external_ref", ref.toLowerCase())
      .in("funnel_id", formIds)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) {
      const funnel = forms.find((form) => form.id === data.funnel_id);
      if (funnel) return { session: data as LeadSession, funnel };
    }
  }

  // PostgREST reads "*" in a like pattern as a wildcard and it cannot be escaped: no fuzzy matches.
  if (!invitee.email || invitee.email.includes("*")) return null;
  const { data: byEmail, error: emailError } = await supabase
    .from("lead_sessions")
    .select("*")
    .eq("tenant_id", row.tenant_id)
    .in("funnel_id", formIds)
    .ilike("email", escapeLike(invitee.email))
    .in("status", [...MATCHABLE_STATUSES])
    .gte("created_at", new Date(Date.now() - 7 * 86_400_000).toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (emailError) throw new Error(emailError.message);
  const session = (byEmail ?? [])[0] as LeadSession | undefined;
  if (!session) return null;
  const funnel = forms.find((form) => form.id === session.funnel_id);
  return funnel ? { session, funnel } : null;
}
