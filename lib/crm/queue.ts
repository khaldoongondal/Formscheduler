/**
 * Inserts one CRM event for one target into the durable queue (decision C19).
 * The expression unique index cannot be a PostgREST conflict target, so a
 * duplicate insert (23505) means "already queued".
 */
import type { CrmKind, FormBookEvent } from "@/lib/connections/types";
import { CRM_MAX_ATTEMPTS } from "@/lib/crm/retry";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

export type EnqueueInput = {
  tenantId: string;
  provider: CrmKind;
  connectionId: string | null;
  ghlConnectionId: string | null;
  funnelId: string | null;
  leadSessionId: string | null;
  event: FormBookEvent;
};

/** The row id, or null on a duplicate or an error (logged, never thrown). */
export async function enqueueCrmEvent(input: EnqueueInput): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("crm_event_deliveries")
      .insert({
        tenant_id: input.tenantId,
        provider: input.provider,
        connection_id: input.provider === "ghl" ? null : input.connectionId,
        ghl_connection_id: input.provider === "ghl" ? input.ghlConnectionId : null,
        funnel_id: input.funnelId,
        lead_session_id: input.leadSessionId,
        event_type: input.event.type,
        event_id: input.event.id.slice(0, 160),
        payload: input.event as unknown as Json,
        status: "pending",
        max_attempts: CRM_MAX_ATTEMPTS
      })
      .select("id")
      .single();
    if (error) {
      if (error.code === "23505") return null;
      console.error("[crm] enqueue failed", input.provider, error.code ?? "unknown");
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (error) {
    console.error("[crm] enqueue failed", input.provider, error instanceof Error ? error.name : "unknown");
    return null;
  }
}
