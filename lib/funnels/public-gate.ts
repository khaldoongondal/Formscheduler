import { PublicError } from "@/lib/api/responses";
import { parsePlanState } from "@/lib/billing/plans";
import { FORM_NOT_AVAILABLE_MESSAGE } from "@/lib/funnels/public-copy";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel } from "@/lib/types/database";

export { FORM_NOT_AVAILABLE_MESSAGE };

/**
 * The one gate for every public write (analytics, lead sessions, slots,
 * bookings). Loads the funnel by id and throws PublicError(404) unless it is
 * active, not taken down, and its tenant is not suspended.
 */
export async function assertFunnelServesPublic(funnelId: string): Promise<Funnel> {
  const supabase = createServiceClient();
  const { data: funnel, error } = await supabase.from("funnels").select("*").eq("id", funnelId).maybeSingle();

  if (error) {
    console.error("[public-gate] funnel lookup failed", error.message);
    throw new PublicError(FORM_NOT_AVAILABLE_MESSAGE, 404);
  }
  if (!funnel || !funnel.is_published || funnel.taken_down_at) {
    throw new PublicError(FORM_NOT_AVAILABLE_MESSAGE, 404);
  }

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("plan")
    .eq("id", funnel.tenant_id)
    .maybeSingle();

  if (tenantError || !tenant || parsePlanState(tenant.plan) === "suspended") {
    if (tenantError) console.error("[public-gate] tenant lookup failed", tenantError.message);
    throw new PublicError(FORM_NOT_AVAILABLE_MESSAGE, 404);
  }

  return funnel;
}
