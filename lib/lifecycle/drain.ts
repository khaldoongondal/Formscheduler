/**
 * Sends queued account lifecycle events to the owner's CRM webhook (Sprint 4, P3.4).
 * Rows are claimed with a lease (in order per tenant, enforced by the claim
 * function), sent one at a time and settled through settle_lifecycle_delivery,
 * which owns the backoff. Anything still leased when time runs out is released.
 * Logs carry counts and status codes only, never the URL, body or contact data.
 */
import { classifyHttpOutcome, shouldStopClaiming } from "@/lib/crm/retry";
import {
  buildLifecyclePayload,
  lifecycleConfig,
  lifecycleHeaders,
  parseLifecycleSnapshot,
  type LifecycleConfig,
  type LifecycleEvent,
  type LifecycleSnapshot
} from "@/lib/lifecycle/events";
import { createServiceClient } from "@/lib/supabase/server";
import type { LifecycleEventDelivery } from "@/lib/types/database";
import { safePostJson, type SafePostResult } from "@/lib/webhooks/safe-post";

export type LifecycleDrainTally = {
  claimed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
  configured: boolean;
};

export type LifecycleSettle = {
  outcome: "sent" | "retry" | "failed" | "skipped";
  status?: number | null;
  error?: string | null;
  reason?: string | null;
};

export type LifecycleClaimedRow = Pick<LifecycleEventDelivery, "id" | "tenant_id" | "event" | "occurred_at" | "details">;

export type LifecycleDrainDeps = {
  config: () => LifecycleConfig | null;
  claim: (owner: string, limit: number) => Promise<LifecycleClaimedRow[]>;
  claimByIds: (owner: string, ids: string[]) => Promise<LifecycleClaimedRow[]>;
  settle: (row: LifecycleClaimedRow, owner: string, args: LifecycleSettle) => Promise<boolean>;
  release: (row: LifecycleClaimedRow, owner: string) => Promise<void>;
  loadSnapshot: (tenantId: string) => Promise<LifecycleSnapshot | null>;
  post: (url: URL, body: string, headers: Record<string, string>) => Promise<SafePostResult>;
  now: () => number;
};

const ERROR_TEXT_MAX = 200;

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}

function clip(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, ERROR_TEXT_MAX);
}

const defaultDeps: LifecycleDrainDeps = {
  config: () => lifecycleConfig(process.env),
  async claim(owner, limit) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("claim_lifecycle_deliveries", {
      p_owner: owner,
      p_limit: limit,
      p_lease_seconds: 60
    });
    if (error) throw new Error(`claim_lifecycle_deliveries: ${error.code ?? "error"}`);
    return (data ?? []) as LifecycleClaimedRow[];
  },
  async claimByIds(owner, ids) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("claim_lifecycle_deliveries_by_ids", {
      p_ids: ids,
      p_owner: owner,
      p_lease_seconds: 60
    });
    if (error) throw new Error(`claim_lifecycle_deliveries_by_ids: ${error.code ?? "error"}`);
    return (data ?? []) as LifecycleClaimedRow[];
  },
  async settle(row, owner, args) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("settle_lifecycle_delivery", {
      p_id: row.id,
      p_owner: owner,
      p_outcome: args.outcome,
      p_status: args.status ?? null,
      p_error: clip(args.error),
      p_reason: args.reason ? args.reason.slice(0, 60) : null
    });
    if (error) {
      console.error("[lifecycle] settle failed", error.code ?? "unknown");
      return false;
    }
    return data === true;
  },
  async release(row, owner) {
    const supabase = createServiceClient();
    const { error } = await supabase.rpc("release_lifecycle_delivery", { p_id: row.id, p_owner: owner });
    if (error) console.error("[lifecycle] release failed", error.code ?? "unknown");
  },
  async loadSnapshot(tenantId) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.rpc("lifecycle_tenant_snapshot", { p_tenant_id: tenantId });
    if (error) throw new Error(`lifecycle_tenant_snapshot: ${error.code ?? "error"}`);
    return parseLifecycleSnapshot(data);
  },
  post: safePostJson,
  now: () => Date.now()
};

type RowResult = "sent" | "retried" | "failed" | "skipped";

/** Sends one claimed row and settles it. Never throws. */
export async function deliverLifecycleRow(
  row: LifecycleClaimedRow,
  owner: string,
  config: LifecycleConfig,
  deps: LifecycleDrainDeps
): Promise<RowResult> {
  try {
    const snapshot = await deps.loadSnapshot(row.tenant_id);
    if (!snapshot) {
      await deps.settle(row, owner, { outcome: "skipped", reason: "tenant_missing" });
      return "skipped";
    }
    const nowMs = deps.now();
    const details = row.details && typeof row.details === "object" && !Array.isArray(row.details) ? (row.details as Record<string, unknown>) : {};
    const payload = buildLifecyclePayload(
      { id: row.id, event: row.event, occurred_at: row.occurred_at, details },
      snapshot,
      new Date(nowMs).toISOString()
    );
    if (!payload) {
      await deps.settle(row, owner, { outcome: "skipped", reason: "bad_event" });
      return "skipped";
    }
    const rawBody = JSON.stringify(payload);
    const headers = lifecycleHeaders({
      secret: config.secret,
      timestampSec: Math.floor(nowMs / 1000),
      rawBody,
      event: payload.event as LifecycleEvent,
      eventId: payload.event_id
    });
    let result: SafePostResult;
    try {
      result = await deps.post(config.url, rawBody, headers);
    } catch (error) {
      result = { status: null, bodySnippet: "", error: errorName(error) };
    }
    const outcome = classifyHttpOutcome(result.status);
    const errorText = outcome === "sent" ? null : result.error ?? (result.status !== null ? `HTTP ${result.status}` : "no_response");
    const acknowledged = await deps.settle(row, owner, { outcome, status: result.status, error: errorText });
    if (!acknowledged) return "retried";
    if (outcome !== "sent") console.error("[lifecycle] delivery not sent", outcome, result.status ?? "no status");
    return outcome === "sent" ? "sent" : outcome === "retry" ? "retried" : "failed";
  } catch (error) {
    // Database trouble: try again later.
    console.error("[lifecycle] delivery failed", errorName(error));
    await deps.settle(row, owner, { outcome: "retry", error: errorName(error) }).catch(() => false);
    return "retried";
  }
}

function tally(result: RowResult, counts: LifecycleDrainTally) {
  if (result === "sent") counts.sent += 1;
  else if (result === "retried") counts.retried += 1;
  else if (result === "failed") counts.failed += 1;
  else counts.skipped += 1;
}

export async function drainLifecycleDeliveries(
  owner: string,
  opts: { budgetMs: number; limit: number; ids?: string[] },
  overrides: Partial<LifecycleDrainDeps> = {}
): Promise<LifecycleDrainTally> {
  const deps: LifecycleDrainDeps = { ...defaultDeps, ...overrides };
  const counts: LifecycleDrainTally = { claimed: 0, sent: 0, retried: 0, failed: 0, skipped: 0, configured: false };
  const config = deps.config();
  if (!config) return counts;
  counts.configured = true;

  const startedMs = deps.now();
  const limit = Math.max(1, Math.floor(opts.limit));

  const runBatch = async (rows: LifecycleClaimedRow[]): Promise<boolean> => {
    counts.claimed += rows.length;
    for (let index = 0; index < rows.length; index += 1) {
      if (shouldStopClaiming(startedMs, deps.now(), opts.budgetMs)) {
        for (const left of rows.slice(index)) await deps.release(left, owner);
        return false;
      }
      tally(await deliverLifecycleRow(rows[index], owner, config, deps), counts);
    }
    return true;
  };

  try {
    if (opts.ids) {
      const ids = opts.ids.filter((id) => typeof id === "string" && id.length > 0).slice(0, 5);
      if (!ids.length) return counts;
      await runBatch(await deps.claimByIds(owner, ids));
      return counts;
    }
    while (counts.claimed < limit && !shouldStopClaiming(startedMs, deps.now(), opts.budgetMs)) {
      const rows = await deps.claim(owner, Math.min(10, limit - counts.claimed));
      if (!rows.length) break;
      if (!(await runBatch(rows))) break;
    }
  } catch (error) {
    console.error("[lifecycle] claim failed", errorName(error));
  }
  return counts;
}
