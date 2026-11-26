import { createServiceClient } from "@/lib/supabase/server";

export const TAKEDOWN_REASON_MAX = 500;

/**
 * Platform-owner takedown switch for one form. Taking down sets
 * taken_down_at, taken_down_reason and is_published = false in one update.
 * Restoring clears both columns; the form stays a draft and the client can
 * activate it again. The owner area (P4) calls this; tenants cannot set these
 * columns because the funnel Zod schemas do not include them.
 */
export async function setFunnelTakedown(funnelId: string, takenDown: boolean, reason?: string): Promise<void> {
  const supabase = createServiceClient();
  const payload = takenDown
    ? {
        taken_down_at: new Date().toISOString(),
        taken_down_reason: reason?.trim().slice(0, TAKEDOWN_REASON_MAX) || null,
        is_published: false
      }
    : { taken_down_at: null, taken_down_reason: null };

  const { data, error } = await supabase.from("funnels").update(payload).eq("id", funnelId).select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Form not found.");
}
