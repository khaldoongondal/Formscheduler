import { getGhlConnectionForTenant, resolveGhlRuntimeConfig } from "@/lib/ghl/connections";
import { createServiceClient } from "@/lib/supabase/server";

export async function getFunnelGhlConfig(funnelId: string) {
  const supabase = createServiceClient();
  const { data: funnel, error: funnelError } = await supabase
    .from("funnels")
    .select("*")
    .eq("id", funnelId)
    .single();

  if (funnelError) throw new Error(funnelError.message);
  if (!funnel.ghl_connection_id) {
    throw new Error("This form is not connected to GoHighLevel.");
  }

  // Scoped by tenant: a form can only use a connection from its own account.
  const connection = await getGhlConnectionForTenant(funnel.ghl_connection_id, funnel.tenant_id);
  if (!connection) {
    throw new Error("This form is not connected to GoHighLevel.");
  }
  if (!connection.is_active) {
    throw new Error(`GHL connection "${connection.name}" is inactive.`);
  }

  const calendarId = funnel.calendar_id ?? connection.calendar_id;
  if (!calendarId) {
    throw new Error("No GHL calendar is configured for this funnel.");
  }

  return {
    funnel,
    connection,
    config: await resolveGhlRuntimeConfig(connection),
    calendarId,
    slotDurationMinutes: funnel.slot_duration_minutes,
    availabilityWindowDays: funnel.availability_window_days ?? 14
  };
}
