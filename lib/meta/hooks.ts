import { after } from "next/server";
import { getRequestGeoMetadata } from "@/lib/analytics/country-filter";
import { drainMetaDeliveriesByIds } from "@/lib/meta/drain";
import { isValidEventRef } from "@/lib/meta/events";
import type { UserDataInput } from "@/lib/meta/hash";
import {
  enqueueMetaEvent,
  linkVisitorEventsToLead,
  loadPixelGate,
  type QueuedMetaEvent
} from "@/lib/meta/queue";
import { getClientIp, toStorableIp } from "@/lib/security/client-ip";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel, Json, LeadSession } from "@/lib/types/database";

/**
 * The six points where FormBook events go to Meta. Every function returns
 * quickly, never throws, and makes no query at all when the form has no pixel.
 * This is the only Meta module that uses `after()`.
 */

export type ClientMetaEvent = { event_name: string; event_id: string };

type MetadataRecord = Record<string, unknown>;

function asRecord(value: Json | Record<string, unknown> | null | undefined): MetadataRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as MetadataRecord) : {};
}

function stringField(record: MetadataRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberField(record: MetadataRecord, key: string): number | null {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d{10,16}$/.test(value)) return Number(value);
  return null;
}

function logError(message: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`[meta] ${message}`, detail.slice(0, 200));
}

/** Only events that may still go to Meta are told to the browser (decision M11). */
export function toClientEvents(rows: Array<QueuedMetaEvent | null | undefined>): ClientMetaEvent[] {
  return rows
    .filter((row): row is QueuedMetaEvent => Boolean(row) && (row!.status === "pending" || row!.status === "held"))
    .map((row) => ({ event_name: row.eventName, event_id: row.eventId }));
}

function scheduleDrainIds(ids: string[]) {
  if (!ids.length) return;
  try {
    after(async () => {
      try {
        await drainMetaDeliveriesByIds(ids);
      } catch (error) {
        logError("drain after response failed", error);
      }
    });
  } catch (error) {
    // Outside a request scope; the cron drain picks the rows up.
    logError("could not schedule drain", error);
  }
}

/** Sends the rows just queued right after the response; the cron covers anything left. */
export function scheduleMetaDrain(rows: Array<QueuedMetaEvent | null | undefined>): void {
  try {
    const ids = rows
      .filter((row): row is QueuedMetaEvent => Boolean(row) && row!.status === "pending")
      .map((row) => row.id);
    scheduleDrainIds(ids);
  } catch (error) {
    logError("schedule failed", error);
  }
}

type BrowserEventContext = {
  funnel: Funnel;
  request: Request;
  visitorId?: string;
  pageLoadId?: string;
  analyticsRowId: string;
  splitTestId: string | null;
  sourceUrl?: string;
  metadata: Record<string, unknown>;
};

function browserEventUser(ctx: BrowserEventContext): UserDataInput {
  const geo = getRequestGeoMetadata(ctx.request);
  return {
    clientIp: toStorableIp(getClientIp(ctx.request.headers)),
    userAgent: ctx.request.headers.get("user-agent"),
    fbc: stringField(ctx.metadata, "fbc"),
    fbp: stringField(ctx.metadata, "fbp"),
    city: geo.city ?? null,
    region: geo.region ?? null,
    country: geo.country_code ?? null,
    externalIds: [ctx.visitorId]
  };
}

async function onBrowserEvent(key: "form_view" | "form_start", ctx: BrowserEventContext) {
  if (!ctx.funnel.meta_pixel_id) return null;
  try {
    const eventRef = isValidEventRef(ctx.pageLoadId) ? ctx.pageLoadId : ctx.analyticsRowId;
    return await enqueueMetaEvent({
      key,
      funnel: ctx.funnel,
      lead: null,
      visitorId: ctx.visitorId ?? null,
      splitTestId: ctx.splitTestId,
      eventRef,
      eventTimeMs: Date.now(),
      sourceUrl: ctx.sourceUrl ?? null,
      landingPageUrl: stringField(ctx.metadata, "landing_page_url"),
      user: browserEventUser(ctx),
      fbclid: stringField(ctx.metadata, "fbclid"),
      fbclidSeenAtMs: numberField(ctx.metadata, "fbclid_seen_at")
    });
  } catch (error) {
    logError(`${key} hook failed`, error);
    return null;
  }
}

export async function onFormView(ctx: BrowserEventContext): Promise<QueuedMetaEvent | null> {
  return onBrowserEvent("form_view", ctx);
}

export async function onFormStart(ctx: BrowserEventContext): Promise<QueuedMetaEvent | null> {
  return onBrowserEvent("form_start", ctx);
}

function leadUser(session: LeadSession): UserDataInput {
  const metadata = asRecord(session.metadata);
  return {
    email: session.email,
    phone: session.phone,
    firstName: session.first_name,
    lastName: session.last_name,
    city: stringField(metadata, "city"),
    region: stringField(metadata, "region"),
    country: stringField(metadata, "country_code") ?? stringField(metadata, "country"),
    externalIds: [session.visitor_id ?? session.id],
    clientIp: session.ip_address ? toStorableIp(String(session.ip_address)) : null,
    userAgent: session.user_agent,
    fbc: stringField(metadata, "fbc"),
    fbp: stringField(metadata, "fbp")
  };
}

function leadEnqueueInput(session: LeadSession, funnel: Funnel) {
  const metadata = asRecord(session.metadata);
  return {
    funnel,
    lead: session,
    visitorId: session.visitor_id,
    splitTestId: session.split_test_id ?? null,
    eventRef: session.id,
    eventTimeMs: Date.now(),
    sourceUrl: session.source_url,
    landingPageUrl: stringField(metadata, "landing_page_url"),
    user: leadUser(session),
    fbclid: stringField(metadata, "fbclid"),
    fbclidSeenAtMs: numberField(metadata, "fbclid_seen_at")
  };
}

/** After the response: send the visitor's earlier rows that the link just released. */
function scheduleLinkedRowsDrain(session: LeadSession, excludeId: string | null) {
  try {
    after(async () => {
      try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
          .from("meta_event_deliveries")
          .select("id")
          .eq("tenant_id", session.tenant_id)
          .eq("lead_session_id", session.id)
          .eq("status", "pending")
          .limit(20);
        if (error) throw new Error(error.message);
        const ids = (data ?? []).map((row) => row.id as string).filter((id) => id !== excludeId);
        if (ids.length) await drainMetaDeliveriesByIds(ids);
      } catch (error) {
        logError("linked rows drain failed", error);
      }
    });
  } catch (error) {
    logError("could not schedule linked rows drain", error);
  }
}

/** Lead (decision M15): link the visitor's earlier rows, apply consent, queue Lead. */
export async function onLead(session: LeadSession, funnel: Funnel): Promise<QueuedMetaEvent | null> {
  if (!funnel.meta_pixel_id) return null;
  try {
    const pixel = await loadPixelGate(funnel);
    if (!pixel) return null;
    const hold = pixel.sending_mode === "hold" && !session.meta_released_at;
    await linkVisitorEventsToLead(funnel, session, hold);
    const queued = await enqueueMetaEvent({ key: "lead", ...leadEnqueueInput(session, funnel), pixel });
    if (session.visitor_id) scheduleLinkedRowsDrain(session, queued?.id ?? null);
    return queued;
  } catch (error) {
    logError("lead hook failed", error);
    return null;
  }
}

export async function onLeadStage(
  key: "qualified_lead" | "disqualified_lead" | "booked_call",
  session: LeadSession,
  funnel: Funnel
): Promise<QueuedMetaEvent | null> {
  if (!funnel.meta_pixel_id) return null;
  try {
    return await enqueueMetaEvent({ key, ...leadEnqueueInput(session, funnel) });
  } catch (error) {
    logError(`${key} hook failed`, error);
    return null;
  }
}
