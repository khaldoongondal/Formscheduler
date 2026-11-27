/**
 * Lifecycle queue I/O for the owner pages (Sprint 4, P3.4). Real lifecycle
 * events are queued by database triggers (migration 0034); this module only
 * queues the owner's test event and reads the queue status.
 */
import { randomUUID } from "node:crypto";
import { createServiceClient } from "@/lib/supabase/server";

export type LifecycleStatus = { pending: number; failed7d: number; lastSentAt: string | null; lastError: string | null };

/** Queues a test_ping for the owner's own account. Returns the row id, or null when it was not queued. */
export async function enqueueLifecycleTest(tenantId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("enqueue_lifecycle_event", {
    p_tenant_id: tenantId,
    p_event: "test_ping",
    p_dedupe_key: `test:${randomUUID()}`,
    p_details: {}
  });
  if (error) {
    console.error("[lifecycle] test enqueue failed", error.code ?? "unknown");
    return null;
  }
  return typeof data === "string" ? data : null;
}

function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** Null when migration 0034 is missing or the read fails. */
export async function getLifecycleStatus(): Promise<LifecycleStatus | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("owner_lifecycle_status");
  if (error || !data || typeof data !== "object" || Array.isArray(data)) {
    if (error) console.error("[lifecycle] status read failed", error.code ?? "unknown");
    return null;
  }
  const row = data as Record<string, unknown>;
  return {
    pending: num(row.pending),
    failed7d: num(row.failed_7d),
    lastSentAt: typeof row.last_sent_at === "string" ? row.last_sent_at : null,
    lastError: typeof row.last_error === "string" ? row.last_error.slice(0, 200) : null
  };
}
