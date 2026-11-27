/**
 * Delivers queued CRM events (P3.3). Rows are claimed with a lease (in order
 * per lead and target, enforced by the claim function), delivered one at a
 * time, and settled through settle_crm_delivery, which owns the backoff.
 * Anything still leased when time runs out is released.
 */
import { randomUUID } from "node:crypto";
import { ADAPTERS } from "@/lib/connections/adapters";
import { getConnectionRowForTenant } from "@/lib/connections/service";
import type { CrmDeliveryOutcome, CrmKind, CrmLeadState, FormBookEvent } from "@/lib/connections/types";
import { shouldStopClaiming } from "@/lib/crm/retry";
import { getGhlConnectionForTenant } from "@/lib/ghl/connections";
import { createServiceClient } from "@/lib/supabase/server";
import type { CrmEventDelivery, Funnel, GhlConnection, LeadSession } from "@/lib/types/database";
import type { ConnectionRow } from "@/lib/connections/service";

export type CrmDrainTally = { claimed: number; sent: number; retried: number; failed: number; skipped: number };

type Settle = { outcome: "sent" | "retry" | "failed" | "skipped"; status?: number | null; summary?: string | null; error?: string | null; reason?: string | null };

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}

export function leadStateOf(session: Pick<LeadSession, "crm_contact_id" | "crm_deal_id" | "ghl_contact_id" | "ghl_opportunity_id">): CrmLeadState {
  return {
    crmContactId: session.crm_contact_id ?? null,
    crmDealId: session.crm_deal_id ?? null,
    ghlContactId: session.ghl_contact_id ?? null,
    ghlOpportunityId: session.ghl_opportunity_id ?? null
  };
}

/** Writes only the given ids, filtered by lead and tenant. */
export async function applyCrmUpdates(
  sessionId: string,
  tenantId: string,
  updates: CrmDeliveryOutcome["updates"],
  ghlConnectionId?: string | null
): Promise<void> {
  if (!updates) return;
  const patch: Record<string, string> = {};
  if (updates.crmContactId) patch.crm_contact_id = updates.crmContactId.slice(0, 200);
  if (updates.crmDealId) patch.crm_deal_id = updates.crmDealId.slice(0, 200);
  if (updates.ghlContactId) patch.ghl_contact_id = updates.ghlContactId;
  if (updates.ghlOpportunityId) patch.ghl_opportunity_id = updates.ghlOpportunityId;
  if (!Object.keys(patch).length) return;
  if (ghlConnectionId && (updates.ghlContactId || updates.ghlOpportunityId)) patch.ghl_connection_id = ghlConnectionId;
  const supabase = createServiceClient();
  const { error } = await supabase.from("lead_sessions").update(patch).eq("id", sessionId).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

async function settle(row: CrmEventDelivery, owner: string, args: Settle): Promise<boolean> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("settle_crm_delivery", {
    p_id: row.id,
    p_owner: owner,
    p_outcome: args.outcome,
    p_status: args.status ?? null,
    p_summary: args.summary ? args.summary.slice(0, 500) : null,
    p_error: args.error ? args.error.slice(0, 500) : null,
    p_reason: args.reason ?? null
  });
  if (error) {
    console.error("[crm] settle failed", error.code ?? "unknown");
    return false;
  }
  return data === true;
}

async function release(row: CrmEventDelivery, owner: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("release_crm_delivery", { p_id: row.id, p_owner: owner });
  if (error) console.error("[crm] release failed", error.code ?? "unknown");
}

async function loadFunnel(row: CrmEventDelivery): Promise<Funnel | null> {
  if (!row.funnel_id) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("funnels").select("*").eq("id", row.funnel_id).eq("tenant_id", row.tenant_id).maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Funnel | null) ?? null;
}

async function loadLeadState(row: CrmEventDelivery): Promise<CrmLeadState> {
  if (!row.lead_session_id) return { crmContactId: null, crmDealId: null, ghlContactId: null, ghlOpportunityId: null };
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_sessions")
    .select("crm_contact_id,crm_deal_id,ghl_contact_id,ghl_opportunity_id")
    .eq("id", row.lead_session_id)
    .eq("tenant_id", row.tenant_id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return leadStateOf((data ?? {}) as LeadSession);
}

/** Re-reads the target with the row's own tenant. */
async function loadTarget(row: CrmEventDelivery): Promise<{ target: ConnectionRow | GhlConnection; ghlConnectionId: string | null } | { skip: string }> {
  if (row.provider === "ghl") {
    if (!row.ghl_connection_id) return { skip: "connection_removed" };
    const connection = await getGhlConnectionForTenant(row.ghl_connection_id, row.tenant_id);
    if (!connection) return { skip: "connection_removed" };
    if (!connection.is_active) return { skip: "connection_off" };
    return { target: connection, ghlConnectionId: connection.id };
  }
  if (!row.connection_id) return { skip: "connection_removed" };
  const connection = await getConnectionRowForTenant(row.tenant_id, row.connection_id);
  if (!connection || connection.provider !== row.provider) return { skip: "connection_removed" };
  if (connection.status === "disabled") return { skip: "connection_off" };
  return { target: connection, ghlConnectionId: null };
}

type RowResult = "sent" | "retried" | "failed" | "skipped";

/** Delivers one claimed row and settles it. Never throws. */
export async function deliverCrmRow(row: CrmEventDelivery, owner: string): Promise<RowResult> {
  const skip = async (reason: string): Promise<RowResult> => {
    await settle(row, owner, { outcome: "skipped", reason });
    return "skipped";
  };
  try {
    if (!row.payload) return skip("no_payload");
    const loaded = await loadTarget(row);
    if ("skip" in loaded) return skip(loaded.skip);
    const entry = ADAPTERS[row.provider as CrmKind];
    if (!entry?.crm || !entry.crmContext) return skip("connection_removed");
    const funnel = await loadFunnel(row);
    const ctx = await entry.crmContext(loaded.target, funnel);
    if (!ctx) return skip(row.provider === "ghl" && !funnel ? "form_removed" : "connection_off");
    const leadState = await loadLeadState(row);

    let outcome: CrmDeliveryOutcome;
    try {
      outcome = await entry.crm.deliver(ctx, row.payload as unknown as FormBookEvent, leadState, { id: row.id });
    } catch (error) {
      outcome = { outcome: "retry", httpStatus: null, summary: `Delivery error: ${errorName(error)}.` };
    }
    if (row.lead_session_id && outcome.updates) {
      await applyCrmUpdates(row.lead_session_id, row.tenant_id, outcome.updates, loaded.ghlConnectionId).catch((error) => {
        console.error("[crm] lead update failed", row.provider, errorName(error));
      });
    }
    const acknowledged = await settle(row, owner, {
      outcome: outcome.outcome,
      status: outcome.httpStatus,
      summary: outcome.summary,
      error: outcome.outcome === "sent" ? null : outcome.summary
    });
    if (!acknowledged) return "retried";
    if (outcome.outcome !== "sent") console.error("[crm] delivery not sent", row.provider, outcome.outcome, outcome.httpStatus ?? "no status");
    return outcome.outcome === "sent" ? "sent" : outcome.outcome === "retry" ? "retried" : "failed";
  } catch (error) {
    // Database or decryption trouble: try again later.
    console.error("[crm] delivery failed", row.provider, errorName(error));
    await settle(row, owner, { outcome: "retry", summary: `Delivery error: ${errorName(error)}.`, error: errorName(error) });
    return "retried";
  }
}

function tally(result: RowResult, counts: CrmDrainTally) {
  if (result === "sent") counts.sent += 1;
  else if (result === "retried") counts.retried += 1;
  else if (result === "failed") counts.failed += 1;
  else counts.skipped += 1;
}

export async function drainCrmDeliveries(owner: string, opts: { budgetMs: number; limit?: number }): Promise<CrmDrainTally> {
  const startedMs = Date.now();
  const counts: CrmDrainTally = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  const limit = opts.limit ?? 200;
  const supabase = createServiceClient();

  while (counts.claimed < limit && !shouldStopClaiming(startedMs, Date.now(), opts.budgetMs)) {
    const { data, error } = await supabase.rpc("claim_crm_deliveries", {
      p_owner: owner,
      p_limit: Math.min(10, limit - counts.claimed),
      p_lease_seconds: 120
    });
    if (error) {
      console.error("[crm] claim failed", error.code ?? "unknown");
      break;
    }
    const rows = (data ?? []) as CrmEventDelivery[];
    if (!rows.length) break;
    counts.claimed += rows.length;
    for (let index = 0; index < rows.length; index += 1) {
      if (shouldStopClaiming(startedMs, Date.now(), opts.budgetMs)) {
        for (const left of rows.slice(index)) await release(left, owner);
        return counts;
      }
      tally(await deliverCrmRow(rows[index], owner), counts);
    }
  }
  return counts;
}

/** Right after the response: delivers just these rows when they can go now. Never throws. */
export async function drainCrmDeliveriesByIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try {
    const owner = randomUUID();
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("claim_crm_deliveries_by_ids", { p_ids: ids, p_owner: owner, p_lease_seconds: 60 });
    if (error) {
      console.error("[crm] claim by ids failed", error.code ?? "unknown");
      return;
    }
    for (const row of (data ?? []) as CrmEventDelivery[]) await deliverCrmRow(row, owner);
  } catch (error) {
    console.error("[crm] drain by ids failed", errorName(error));
  }
}
