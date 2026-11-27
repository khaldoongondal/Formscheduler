import {
  CRON_DRAIN_BATCH_SIZE,
  CRON_DRAIN_ROW_LIMIT,
  classifyFailure,
  funnelStillSends,
  shouldStopClaiming,
  type FunnelSendState
} from "@/lib/meta/delivery-rules";
import { isEventEnabled, isMetaEventKey } from "@/lib/meta/events";
import type { MetaServerEvent } from "@/lib/meta/payload";
import { TokenUnreadableError, loadPixelSendConfig } from "@/lib/meta/pixels";
import { describeMetaResult } from "@/lib/meta/response";
import { postMetaEvents } from "@/lib/meta/send";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json, MetaEventDelivery } from "@/lib/types/database";

/**
 * Delivers queued Meta events (ported from Mission Control capi-delivery).
 *
 * Rows are claimed with a lease, sent one at a time, and settled through
 * settle_meta_delivery, which owns the retry and backoff. Anything still
 * leased when time runs out is released so the next run can take it at once.
 */

export type DeliveryOutcome = "sent" | "retry" | "failed" | "skipped";

export type DrainTally = {
  claimed: number;
  sent: number;
  retry: number;
  failed: number;
  skipped: number;
  released: number;
  deadlineHit: boolean;
};

type SettleArgs = { outcome: DeliveryOutcome; error?: string | null; reason?: string | null; response?: Json | null };

export type DeliverDeps = {
  send?: typeof postMetaEvents;
  loadPixel?: typeof loadPixelSendConfig;
  now?: () => number;
  /** Reads the lead's consent answer; injectable for tests. */
  loadLeadConsent?: (leadSessionId: string, tenantId: string) => Promise<boolean | null>;
  /** Reads the row's form and tenant state at send time; injectable for tests. */
  loadFunnelState?: (funnelId: string, tenantId: string) => Promise<FunnelSendState | null>;
  settle?: (row: MetaEventDelivery, owner: string, args: SettleArgs) => Promise<boolean>;
  recordTestCode?: (row: MetaEventDelivery, owner: string, code: string | null) => Promise<void>;
};

function errorText(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? "unknown error");
  return text.slice(0, 200);
}

async function defaultSettle(row: MetaEventDelivery, owner: string, args: SettleArgs): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("settle_meta_delivery", {
    p_id: row.id,
    p_owner: owner,
    p_outcome: args.outcome,
    p_error: args.error ?? null,
    p_reason: args.reason ?? null,
    p_response: args.response ?? null
  });
  if (error) throw new Error(`settle_meta_delivery not acknowledged: ${error.message}`);
  return data === true;
}

async function defaultLoadLeadConsent(leadSessionId: string, tenantId: string): Promise<boolean | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_sessions")
    .select("meta_consent")
    .eq("id", leadSessionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { meta_consent?: boolean | null } | null)?.meta_consent ?? null;
}

async function defaultLoadFunnelState(funnelId: string, tenantId: string): Promise<FunnelSendState | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("id,meta_pixel_id,meta_consent_confirmed_at,is_published,taken_down_at")
    .eq("id", funnelId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  const funnel = data as unknown as Partial<Omit<FunnelSendState, "tenant_plan">>;
  return {
    meta_pixel_id: funnel.meta_pixel_id ?? null,
    meta_consent_confirmed_at: funnel.meta_consent_confirmed_at ?? null,
    is_published: funnel.is_published === true,
    taken_down_at: funnel.taken_down_at ?? null,
    tenant_plan: (tenant as { plan?: string | null } | null)?.plan ?? null
  };
}

async function defaultRecordTestCode(row: MetaEventDelivery, owner: string, code: string | null): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("meta_event_deliveries")
    .update({ test_event_code_used: code })
    .eq("id", row.id)
    .eq("lease_owner", owner);
  if (error) throw new Error(error.message);
}

/** Send one claimed row and settle it. Throws when the settlement is not acknowledged. */
export async function deliverMetaRow(row: MetaEventDelivery, owner: string, deps: DeliverDeps = {}): Promise<DeliveryOutcome> {
  const send = deps.send ?? postMetaEvents;
  const loadPixel = deps.loadPixel ?? loadPixelSendConfig;
  const settleRow = deps.settle ?? defaultSettle;
  const loadLeadConsent = deps.loadLeadConsent ?? defaultLoadLeadConsent;
  const loadFunnelState = deps.loadFunnelState ?? defaultLoadFunnelState;
  const recordTestCode = deps.recordTestCode ?? defaultRecordTestCode;

  const settle = async (args: SettleArgs): Promise<DeliveryOutcome> => {
    const acknowledged = await settleRow(row, owner, args);
    if (!acknowledged) {
      // Lease lost or row gone: the outcome is unproven, so the drain counts it as a retry.
      throw new Error(`settle_meta_delivery(${row.id}) not acknowledged`);
    }
    return args.outcome;
  };

  let pixel;
  try {
    pixel = await loadPixel(row.pixel_id);
  } catch (error) {
    if (error instanceof TokenUnreadableError) {
      return settle({ outcome: "failed", reason: "token_unreadable", error: error.message });
    }
    throw error;
  }
  if (!pixel || pixel.tenantId !== row.tenant_id) {
    return settle({ outcome: "skipped", reason: "pixel_removed" });
  }

  // The form is re-read at send time: a form that dropped or changed its pixel,
  // lost its consent confirmation, went offline, or whose tenant was suspended
  // sends nothing it queued earlier.
  const funnelState = row.funnel_id ? await loadFunnelState(row.funnel_id, row.tenant_id) : null;
  if (!funnelStillSends(row, funnelState)) {
    return settle({ outcome: "skipped", reason: "pixel_detached" });
  }

  // Switches are re-read at send time: an event switched off while it waited is not sent.
  if (isMetaEventKey(row.event_key) && !isEventEnabled(row.event_key, pixel.switches)) {
    return settle({ outcome: "skipped", reason: "event_off" });
  }

  if (row.lead_session_id) {
    const consent = await loadLeadConsent(row.lead_session_id, row.tenant_id);
    if (consent === false) return settle({ outcome: "skipped", reason: "consent_declined" });
  }

  if (!row.payload || typeof row.payload !== "object") {
    return settle({ outcome: "skipped", reason: "no_payload" });
  }

  await recordTestCode(row, owner, pixel.testEventCode);

  const result = await send({
    datasetId: pixel.datasetId,
    accessToken: pixel.accessToken,
    events: [row.payload as unknown as MetaServerEvent],
    testEventCode: pixel.testEventCode
  });
  const response = result.summary as unknown as Json;

  if (result.ok) return settle({ outcome: "sent", response });

  const outcome = classifyFailure(result.status, result.summary);
  return settle({
    outcome,
    error: describeMetaResult(false, result.status, result.summary),
    response
  });
}

async function releaseRows(owner: string, rows: readonly MetaEventDelivery[]): Promise<number> {
  const supabase = createServiceClient();
  let released = 0;
  for (const row of rows) {
    try {
      const { data, error } = await supabase.rpc("release_meta_delivery", { p_id: row.id, p_owner: owner });
      if (!error && data === true) released++;
    } catch (error) {
      console.error("[meta] release failed", errorText(error));
    }
  }
  return released;
}

/** Sequential sends of claimed rows within the time budget. Mutates the tally. */
async function deliverBatch(
  rows: MetaEventDelivery[],
  owner: string,
  tally: DrainTally,
  started: number,
  budgetMs: number,
  now: () => number
): Promise<boolean> {
  for (const [index, row] of rows.entries()) {
    if (shouldStopClaiming(started, now(), budgetMs)) {
      tally.released += await releaseRows(owner, rows.slice(index));
      tally.deadlineHit = true;
      return false;
    }
    try {
      tally[await deliverMetaRow(row, owner)]++;
    } catch (error) {
      // Unproven outcome: the lease lapses and the row is claimed again; the attempt was already charged.
      console.error("[meta] delivery failed", errorText(error));
      tally.retry++;
    }
  }
  return true;
}

function emptyTally(): DrainTally {
  return { claimed: 0, sent: 0, retry: 0, failed: 0, skipped: 0, released: 0, deadlineHit: false };
}

/**
 * The cron drain: claim batches (oldest events first, see claim_meta_deliveries)
 * until the time budget or the row cap is reached, so a large release clears
 * in a few runs instead of trickling out.
 */
export async function drainMetaDeliveries(
  owner: string,
  opts: { budgetMs?: number; batchSize?: number; limit?: number; now?: () => number } = {}
): Promise<DrainTally> {
  const now = opts.now ?? Date.now;
  const started = now();
  const budgetMs = opts.budgetMs ?? 45000;
  const batchSize = opts.batchSize ?? CRON_DRAIN_BATCH_SIZE;
  const maxRows = opts.limit ?? CRON_DRAIN_ROW_LIMIT;
  const tally = emptyTally();
  const supabase = createServiceClient();

  while (tally.claimed < maxRows && !shouldStopClaiming(started, now(), budgetMs)) {
    const room = Math.min(batchSize, maxRows - tally.claimed);
    const { data, error } = await supabase.rpc("claim_meta_deliveries", {
      p_owner: owner,
      p_limit: room,
      p_lease_seconds: 120
    });
    if (error) throw new Error(`claim_meta_deliveries: ${error.message}`);
    const rows = (data ?? []) as MetaEventDelivery[];
    if (rows.length === 0) break;
    tally.claimed += rows.length;
    const finished = await deliverBatch(rows, owner, tally, started, budgetMs, now);
    if (!finished) return tally;
  }

  if (shouldStopClaiming(started, now(), budgetMs)) tally.deadlineHit = true;
  return tally;
}

/** Drains only the given rows (just queued by a request), right after the response. */
export async function drainMetaDeliveriesByIds(ids: string[]): Promise<DrainTally> {
  const tally = emptyTally();
  const unique = [...new Set(ids)].slice(0, 20);
  if (!unique.length) return tally;
  const owner = crypto.randomUUID();
  const started = Date.now();
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("claim_meta_deliveries_by_ids", {
    p_ids: unique,
    p_owner: owner,
    p_lease_seconds: 60
  });
  if (error) throw new Error(`claim_meta_deliveries_by_ids: ${error.message}`);
  const rows = (data ?? []) as MetaEventDelivery[];
  tally.claimed = rows.length;
  await deliverBatch(rows, owner, tally, started, 20000, Date.now);
  return tally;
}
