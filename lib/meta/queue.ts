import { META_MAX_ATTEMPTS } from "@/lib/meta/constants";
import { buildMetaEventId, type MetaEventKey, type PixelSwitches } from "@/lib/meta/events";
import { consentAnswerForLead, decideEnqueue, type SendingMode } from "@/lib/meta/gating";
import type { UserDataInput } from "@/lib/meta/hash";
import { buildMetaServerEvent } from "@/lib/meta/payload";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel, Json, LeadSession, MetaDeliveryStatus } from "@/lib/types/database";

/**
 * Writes Meta events into the durable queue (table meta_event_deliveries).
 * Nothing here ever throws to the caller: a Meta problem must never fail or
 * slow lead capture or booking. Errors are logged without personal data.
 */

export type QueuedMetaEvent = {
  id: string;
  eventName: string;
  eventId: string;
  status: "awaiting_consent" | "held" | "pending";
};

export type PixelGate = PixelSwitches & { sending_mode: SendingMode };

type FunnelMeta = Pick<Funnel, "id" | "tenant_id"> &
  Partial<Pick<Funnel, "meta_pixel_id" | "meta_consent_confirmed_at" | "meta_consent_checkbox_enabled">>;

const GATE_COLUMNS =
  "sending_mode,send_form_view,send_form_start,send_lead,send_qualified_lead,send_disqualified_lead,send_booked_call";

function logError(message: string, error: unknown) {
  // Never log payloads, tokens or personal data.
  const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "unknown error";
  console.error(`[meta] ${message}`, detail.slice(0, 200));
}

function isWaitingStatus(value: unknown): value is QueuedMetaEvent["status"] {
  return value === "awaiting_consent" || value === "held" || value === "pending";
}

/**
 * Switches and sending mode of the form's pixel (same tenant only), or null.
 * One query. A pixel frozen by a plan change (migration 0032) gives null, so
 * no new Meta row is ever queued for it.
 */
export async function loadPixelGate(funnel: FunnelMeta): Promise<PixelGate | null> {
  if (!funnel.meta_pixel_id) return null;
  try {
    const supabase = createServiceClient();
    const read = (columns: string) =>
      supabase
        .from("meta_pixels")
        .select(columns)
        .eq("id", funnel.meta_pixel_id as string)
        .eq("tenant_id", funnel.tenant_id)
        .maybeSingle();
    let result = await read(`${GATE_COLUMNS},frozen_at`);
    if (result.error?.code === "42703") result = await read(GATE_COLUMNS);
    const { data, error } = result;
    if (error) throw new Error(error.message);
    if (!data) return null;
    const row = data as unknown as PixelGate & { frozen_at?: string | null };
    if (row.frozen_at) return null;
    const { frozen_at: _frozenAt, ...gate } = row;
    void _frozenAt;
    return { ...gate, sending_mode: gate.sending_mode === "hold" ? "hold" : "automatic" };
  } catch (error) {
    logError("pixel lookup failed", error);
    return null;
  }
}

export type EnqueueInput = {
  key: MetaEventKey;
  funnel: FunnelMeta;
  lead: Pick<LeadSession, "id" | "meta_consent" | "meta_released_at"> | null;
  visitorId: string | null;
  splitTestId: string | null;
  /** Page load id for view and start, lead session id for lead events (decision M5). */
  eventRef: string;
  eventTimeMs: number;
  sourceUrl?: string | null;
  landingPageUrl?: string | null;
  user: UserDataInput;
  fbclid?: string | null;
  fbclidSeenAtMs?: number | null;
  /** Already loaded pixel gate, to save a query; undefined loads it. */
  pixel?: PixelGate | null;
};

/**
 * Builds the payload (hashing happens here) and inserts it once per
 * (pixel, event id). A retried request returns the existing row, so the
 * browser gets the same event id. Returns null when nothing is queued.
 */
export async function enqueueMetaEvent(input: EnqueueInput): Promise<QueuedMetaEvent | null> {
  const pixelId = input.funnel.meta_pixel_id;
  if (!pixelId) return null;

  try {
    const pixel = input.pixel === undefined ? await loadPixelGate(input.funnel) : input.pixel;
    const gate = decideEnqueue({
      key: input.key,
      funnel: {
        meta_pixel_id: pixelId,
        meta_consent_confirmed_at: input.funnel.meta_consent_confirmed_at ?? null,
        meta_consent_checkbox_enabled: input.funnel.meta_consent_checkbox_enabled === true
      },
      pixel,
      lead: input.lead
        ? { meta_consent: input.lead.meta_consent ?? null, meta_released_at: input.lead.meta_released_at ?? null }
        : null
    });
    if (gate.action === "none") return null;

    const nowMs = Date.now();
    const eventId = buildMetaEventId(input.key, input.eventRef);
    const { event, matchKeys } = buildMetaServerEvent({
      key: input.key,
      eventId,
      eventTimeMs: input.eventTimeMs,
      sourceUrl: input.sourceUrl,
      landingPageUrl: input.landingPageUrl,
      user: input.user,
      fbclid: input.fbclid,
      fbclidSeenAtMs: input.fbclidSeenAtMs,
      nowMs
    });

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("meta_event_deliveries")
      .upsert(
        {
          tenant_id: input.funnel.tenant_id,
          pixel_id: pixelId,
          funnel_id: input.funnel.id,
          lead_session_id: input.lead?.id ?? null,
          split_test_id: input.splitTestId,
          visitor_id: input.visitorId ? input.visitorId.slice(0, 128) : null,
          event_key: input.key,
          event_name: event.event_name,
          event_id: eventId,
          event_time: new Date(event.event_time * 1000).toISOString(),
          payload: event as unknown as Json,
          match_keys: matchKeys,
          status: gate.status satisfies MetaDeliveryStatus,
          max_attempts: META_MAX_ATTEMPTS
        },
        { onConflict: "pixel_id,event_id", ignoreDuplicates: true }
      )
      .select("id,event_name,event_id,status");
    if (error) throw new Error(error.message);

    type Row = { id: string; event_name: string; event_id: string; status: string };
    let row = (data ?? [])[0] as Row | undefined;
    if (!row) {
      // Duplicate (a retried request): read the row that is already there.
      const existing = await supabase
        .from("meta_event_deliveries")
        .select("id,event_name,event_id,status")
        .eq("pixel_id", pixelId)
        .eq("event_id", eventId)
        .eq("tenant_id", input.funnel.tenant_id)
        .maybeSingle();
      if (existing.error) throw new Error(existing.error.message);
      row = (existing.data as Row | null) ?? undefined;
    }
    if (!row || !isWaitingStatus(row.status)) return null;
    return { id: row.id, eventName: row.event_name, eventId: row.event_id, status: row.status };
  } catch (error) {
    logError(`enqueue ${input.key} failed`, error);
    return null;
  }
}

/**
 * After a lead session exists: attach the visitor's earlier view and start
 * rows to the lead and apply its consent answer (RPC meta_link_visitor_events).
 */
export async function linkVisitorEventsToLead(
  funnel: FunnelMeta,
  lead: Pick<LeadSession, "id" | "visitor_id" | "meta_consent">,
  hold: boolean
): Promise<void> {
  if (!funnel.meta_pixel_id || !lead.visitor_id) return;
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("meta_link_visitor_events", {
      p_tenant_id: funnel.tenant_id,
      p_funnel_id: funnel.id,
      p_visitor_id: lead.visitor_id,
      p_lead_session_id: lead.id,
      p_consent: consentAnswerForLead(funnel.meta_consent_checkbox_enabled === true, lead.meta_consent ?? null),
      p_hold: hold
    });
    if (error) throw new Error(error.message);
  } catch (error) {
    logError("link visitor events failed", error);
  }
}
