import { randomUUID } from "node:crypto";
import { unstable_noStore as noStore } from "next/cache";
import { after } from "next/server";
import { drainMetaDeliveriesByIds } from "@/lib/meta/drain";
import { buildMetaEventId, type PixelSwitches } from "@/lib/meta/events";
import {
  META_CONTROLS_COPY,
  logRangeStart,
  leadLabel,
  normalizeCoverageRow,
  type CoverageRow,
  type LogFilter
} from "@/lib/meta/log-format";
import { buildMetaServerEvent } from "@/lib/meta/payload";
import { PIXEL_MESSAGES } from "@/lib/meta/pixel-input";
import { TokenUnreadableError, getPixel, isUuid, loadPixelSendConfig } from "@/lib/meta/pixels";
import { describeMetaResult } from "@/lib/meta/response";
import { postMetaEvents } from "@/lib/meta/send";
import { toStorableIp } from "@/lib/security/client-ip";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json, MetaDeliveryStatus } from "@/lib/types/database";

/**
 * Hold and fire, the test event, the event log and match key coverage.
 * Every function takes the tenant id, filters by it and verifies every id it
 * receives. Nothing here reads or returns a payload or a token.
 */

export const LOG_PAGE_SIZE = 50;
const DRAIN_NOW_LIMIT = 20;
const GENERIC_MESSAGE = "Something went wrong. Please try again.";

const DELIVERY_LIST_COLUMNS =
  "id,event_key,event_name,event_time,status,status_reason,match_keys,attempts,meta_response,last_error,created_at,sent_at,fired_by,lead_session_id,funnel_id,test_event_code_used";

export type DeliveryListRow = {
  id: string;
  event_key: string;
  event_name: string;
  event_time: string;
  status: MetaDeliveryStatus;
  status_reason: string | null;
  match_keys: string[];
  attempts: number;
  meta_response: Json | null;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  fired_by: string | null;
  lead_session_id: string | null;
  funnel_id: string | null;
  /** The test event code the row was sent with; Meta does not count such events for ads. */
  test_event_code_used: string | null;
  funnel_name: string | null;
  lead_label: string;
};

type RawDeliveryRow = Omit<DeliveryListRow, "funnel_name" | "lead_label">;

class UserFacingError extends Error {}

function logError(message: string, error: unknown) {
  const detail = error instanceof Error ? error.message : "unknown error";
  console.error(`[meta] ${message}`, detail.slice(0, 200));
}

async function guard<T>(label: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UserFacingError) throw new Error(error.message);
    logError(label, error);
    throw new Error(GENERIC_MESSAGE);
  }
}

async function requirePixel(tenantId: string, pixelId: string) {
  const pixel = await getPixel(tenantId, pixelId);
  if (!pixel) throw new UserFacingError(PIXEL_MESSAGES.notFound);
  return pixel;
}

async function requireLead(tenantId: string, leadSessionId: string) {
  if (!isUuid(leadSessionId)) throw new UserFacingError(PIXEL_MESSAGES.notFound);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_sessions")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", leadSessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError(PIXEL_MESSAGES.notFound);
}

/** Sends released rows right after the response, 20 at a time; the cron covers anything left. */
function scheduleDrain(ids: string[], limit: number) {
  const chunk = ids.slice(0, limit);
  if (!chunk.length) return;
  try {
    after(async () => {
      for (let index = 0; index < chunk.length; index += DRAIN_NOW_LIMIT) {
        try {
          await drainMetaDeliveriesByIds(chunk.slice(index, index + DRAIN_NOW_LIMIT));
        } catch (error) {
          logError("drain after fire failed", error);
        }
      }
    });
  } catch (error) {
    logError("could not schedule drain after fire", error);
  }
}

export async function updatePixelSending(
  tenantId: string,
  pixelId: string,
  input: { sending_mode: "automatic" | "hold"; switches: PixelSwitches }
): Promise<void> {
  return guard("sending settings failed", async () => {
    await requirePixel(tenantId, pixelId);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("meta_pixels")
      .update({
        sending_mode: input.sending_mode === "hold" ? "hold" : "automatic",
        send_form_view: input.switches.send_form_view === true,
        send_form_start: input.switches.send_form_start === true,
        send_lead: input.switches.send_lead === true,
        send_qualified_lead: input.switches.send_qualified_lead === true,
        send_disqualified_lead: input.switches.send_disqualified_lead === true,
        send_booked_call: input.switches.send_booked_call === true
      })
      .eq("tenant_id", tenantId)
      .eq("id", pixelId);
    if (error) throw new Error(error.message);
  });
}

/** Rows of a pixel that are queued to send now (pending), for example after Fire all. */
export async function countQueued(tenantId: string, pixelId: string): Promise<number> {
  noStore();
  if (!isUuid(pixelId)) return 0;
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("meta_event_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("pixel_id", pixelId)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countHeld(tenantId: string, pixelId: string): Promise<number> {
  noStore();
  if (!isUuid(pixelId)) return 0;
  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("meta_event_deliveries")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("pixel_id", pixelId)
    .eq("status", "held");
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function releaseHeld(
  tenantId: string,
  target: { pixelId: string | null; leadSessionId: string | null },
  actorEmail: string
): Promise<string[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("meta_release_held", {
    p_tenant_id: tenantId,
    p_pixel_id: target.pixelId,
    p_lead_session_id: target.leadSessionId,
    p_by: actorEmail.slice(0, 254)
  });
  if (error) throw new Error(error.message);
  // A setof uuid comes back as an array of strings (or objects keyed by the function name).
  return ((data ?? []) as unknown[])
    .map((value) =>
      typeof value === "string"
        ? value
        : value && typeof value === "object"
          ? String(Object.values(value as Record<string, unknown>)[0] ?? "")
          : ""
    )
    .filter(isUuid);
}

/** Fire one lead's held events (every pixel of the tenant) and mark the lead released. */
export async function fireHeldForLead(tenantId: string, leadSessionId: string, actorEmail: string): Promise<number> {
  return guard("fire for lead failed", async () => {
    await requireLead(tenantId, leadSessionId);
    const ids = await releaseHeld(tenantId, { pixelId: null, leadSessionId }, actorEmail);
    scheduleDrain(ids, ids.length);
    return ids.length;
  });
}

/** Fire every held event of a pixel. Up to 20 go out right after the response; the cron sends the rest. */
export async function fireAllHeld(tenantId: string, pixelId: string, actorEmail: string): Promise<number> {
  return guard("fire all failed", async () => {
    await requirePixel(tenantId, pixelId);
    const ids = await releaseHeld(tenantId, { pixelId, leadSessionId: null }, actorEmail);
    scheduleDrain(ids, DRAIN_NOW_LIMIT);
    return ids.length;
  });
}

/**
 * Decision M18: one ViewContent straight to Meta with the pixel's test event
 * code. The only Meta call made at the user's request.
 */
export async function sendTestEvent(
  tenantId: string,
  pixelId: string,
  request: { ip: string; userAgent: string }
): Promise<{ ok: boolean; message: string }> {
  return guard("test event failed", async () => {
    await requirePixel(tenantId, pixelId);

    let config;
    try {
      config = await loadPixelSendConfig(pixelId);
    } catch (error) {
      if (error instanceof TokenUnreadableError) throw new UserFacingError(error.message);
      throw error;
    }
    if (!config || config.tenantId !== tenantId) throw new UserFacingError(PIXEL_MESSAGES.notFound);
    if (!config.testEventCode) throw new UserFacingError(META_CONTROLS_COPY.testNoCode);

    const limit = await hitRateLimit({
      scope: "meta-test",
      subject: `tenant-${tenantId}`,
      limit: 10,
      windowSeconds: 3600
    });
    if (!limit.allowed) throw new UserFacingError(META_CONTROLS_COPY.testRateLimited);

    const nowMs = Date.now();
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
    const eventId = buildMetaEventId("test_event", randomUUID());
    const { event, matchKeys } = buildMetaServerEvent({
      key: "test_event",
      eventId,
      eventTimeMs: nowMs,
      sourceUrl: `${appUrl}/admin/pixels/${pixelId}`,
      user: {
        clientIp: toStorableIp(request.ip),
        userAgent: request.userAgent || null,
        externalIds: [tenantId]
      },
      nowMs
    });

    const result = await postMetaEvents({
      datasetId: config.datasetId,
      accessToken: config.accessToken,
      events: [event],
      testEventCode: config.testEventCode
    });
    const summaryText = describeMetaResult(result.ok, result.status, result.summary);
    const nowIso = new Date(nowMs).toISOString();

    const supabase = createServiceClient();
    const [logResult, pixelResult] = await Promise.all([
      supabase.from("meta_event_deliveries").insert({
        tenant_id: tenantId,
        pixel_id: pixelId,
        event_key: "test_event",
        event_name: event.event_name,
        event_id: eventId,
        event_time: nowIso,
        payload: null,
        match_keys: matchKeys,
        status: result.ok ? "sent" : "failed",
        attempts: 1,
        meta_response: result.summary as unknown as Json,
        last_error: result.ok ? null : summaryText.slice(0, 500),
        test_event_code_used: config.testEventCode,
        sent_at: result.ok ? nowIso : null
      }),
      supabase
        .from("meta_pixels")
        .update({ last_test_at: nowIso, last_test_ok: result.ok, last_test_summary: summaryText.slice(0, 500) })
        .eq("tenant_id", tenantId)
        .eq("id", pixelId)
    ]);
    if (logResult.error) logError("test event log insert failed", new Error(logResult.error.message));
    if (pixelResult.error) logError("test event result update failed", new Error(pixelResult.error.message));

    return result.ok
      ? { ok: true, message: META_CONTROLS_COPY.testOk }
      : { ok: false, message: META_CONTROLS_COPY.testFailed(summaryText) };
  });
}

/** Adds the form name and lead label; reads only the tenant's own forms and leads. */
async function decorate(tenantId: string, rows: RawDeliveryRow[]): Promise<DeliveryListRow[]> {
  const funnelIds = [...new Set(rows.map((row) => row.funnel_id).filter((id): id is string => Boolean(id)))];
  const leadIds = [...new Set(rows.map((row) => row.lead_session_id).filter((id): id is string => Boolean(id)))];
  const supabase = createServiceClient();
  const [funnels, leads] = await Promise.all([
    funnelIds.length
      ? supabase.from("funnels").select("id,name").eq("tenant_id", tenantId).in("id", funnelIds)
      : Promise.resolve({ data: [], error: null }),
    leadIds.length
      ? supabase
          .from("lead_sessions")
          .select("id,full_name,first_name,last_name,email")
          .eq("tenant_id", tenantId)
          .in("id", leadIds)
      : Promise.resolve({ data: [], error: null })
  ]);
  if (funnels.error) throw new Error(funnels.error.message);
  if (leads.error) throw new Error(leads.error.message);

  const funnelNames = new Map(
    ((funnels.data ?? []) as Array<{ id: string; name: string }>).map((row) => [row.id, row.name])
  );
  type LeadRow = { id: string; full_name: string | null; first_name: string | null; last_name: string | null; email: string | null };
  const leadRows = new Map(((leads.data ?? []) as LeadRow[]).map((row) => [row.id, row]));

  return rows.map((row) => ({
    ...row,
    match_keys: Array.isArray(row.match_keys) ? row.match_keys : [],
    funnel_name: row.funnel_id ? funnelNames.get(row.funnel_id) ?? null : null,
    lead_label: leadLabel(row.lead_session_id ? leadRows.get(row.lead_session_id) ?? null : null)
  }));
}

/** 50 rows per page, newest first; `before` is the created_at of the last row shown. */
export async function listDeliveries(
  tenantId: string,
  pixelId: string,
  filter: LogFilter
): Promise<{ rows: DeliveryListRow[]; nextBefore: string | null }> {
  noStore();
  if (!isUuid(pixelId)) return { rows: [], nextBefore: null };
  const supabase = createServiceClient();
  let query = supabase
    .from("meta_event_deliveries")
    .select(DELIVERY_LIST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("pixel_id", pixelId)
    .gte("created_at", logRangeStart(filter.preset, new Date()).toISOString());
  if (filter.status !== "all") query = query.eq("status", filter.status);
  if (filter.event !== "all") query = query.eq("event_key", filter.event);
  if (filter.before) query = query.lt("created_at", new Date(filter.before).toISOString());
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LOG_PAGE_SIZE + 1);
  if (error) throw new Error(error.message);

  const raw = (data ?? []) as unknown as RawDeliveryRow[];
  const page = raw.slice(0, LOG_PAGE_SIZE);
  const rows = await decorate(tenantId, page);
  const nextBefore = raw.length > LOG_PAGE_SIZE && page.length ? page[page.length - 1].created_at : null;
  return { rows, nextBefore };
}

/** Every event of one lead across the tenant's pixels (newest first, at most 200). */
export async function listLeadDeliveries(tenantId: string, leadSessionId: string): Promise<DeliveryListRow[]> {
  noStore();
  if (!isUuid(leadSessionId)) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("meta_event_deliveries")
    .select(DELIVERY_LIST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("lead_session_id", leadSessionId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return decorate(tenantId, (data ?? []) as unknown as RawDeliveryRow[]);
}

export async function getMatchCoverage(
  tenantId: string,
  pixelId: string,
  range: { from: Date; to: Date }
): Promise<CoverageRow[]> {
  noStore();
  if (!isUuid(pixelId)) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("meta_match_key_coverage", {
    p_tenant_id: tenantId,
    p_pixel_id: pixelId,
    p_from: range.from.toISOString(),
    p_to: range.to.toISOString()
  });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<Partial<CoverageRow>>).map(normalizeCoverageRow);
}

export async function getLatestFailure(tenantId: string, pixelId: string): Promise<DeliveryListRow | null> {
  noStore();
  if (!isUuid(pixelId)) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("meta_event_deliveries")
    .select(DELIVERY_LIST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("pixel_id", pixelId)
    .eq("status", "failed")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const rows = await decorate(tenantId, (data ?? []) as unknown as RawDeliveryRow[]);
  return rows[0] ?? null;
}
