"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminActorEmail, requireTenantRole } from "@/lib/auth/tenant";
import { fireHeldForLead } from "@/lib/meta/controls";

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

/** Send one lead's held Meta events now (hold mode). */
export async function fireLeadHeldAction(formData: FormData) {
  const leadSessionId = String(formData.get("lead_session_id") ?? "").trim();
  const path = `/admin/leads/${encodeURIComponent(leadSessionId)}`;
  let fired = 0;
  try {
    const { tenantId } = await requireTenantRole(["owner", "admin"]);
    const actor = await getAdminActorEmail();
    fired = await fireHeldForLead(tenantId, leadSessionId, actor);
  } catch (error) {
    redirect(`${path}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(path);
  redirect(`${path}?saved=${fired > 0 ? "fired" : "nothing-held"}&n=${fired}`);
}
