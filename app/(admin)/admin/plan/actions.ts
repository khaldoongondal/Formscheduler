"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import { FREEZE_COPY } from "@/lib/billing/freeze";
import { reactivateFrozenPixel, swapFrozenForm } from "@/lib/billing/plan-change-service";
import { updateFunnel } from "@/lib/funnels/service";
import { createServiceClient } from "@/lib/supabase/server";

const PLAN_PATH = "/admin/plan";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function uuidField(formData: FormData, key: string): string {
  const value = field(formData, key);
  if (!UUID_PATTERN.test(value)) throw new Error("Not found.");
  return value.toLowerCase();
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

/** Only the Plan page or the editor of the form being reactivated; anything else goes to the Plan page. */
function returnPath(formData: FormData, funnelId: string | null): string {
  const value = field(formData, "return_to");
  if (funnelId && value.toLowerCase() === `/admin/funnels/${funnelId}`) return `/admin/funnels/${funnelId}`;
  return PLAN_PATH;
}

function withParam(path: string, key: "saved" | "error", value: string) {
  return `${path}?${key}=${encodeURIComponent(value)}`;
}

function revalidateAll() {
  revalidatePath(PLAN_PATH);
  revalidatePath("/admin/funnels", "layout");
  revalidatePath("/admin/pixels", "layout");
}

/** Reactivates one of the tenant's frozen forms through the normal activation path (readiness and limit checks). */
export async function reactivateFrozenFormAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const rawId = field(formData, "funnel_id");
  const funnelId = UUID_PATTERN.test(rawId) ? rawId.toLowerCase() : null;
  const back = returnPath(formData, funnelId);
  let destination: string;
  try {
    if (!funnelId) throw new Error("Not found.");
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("funnels")
      .select("id,frozen_at,is_published")
      .eq("tenant_id", tenantId)
      .eq("id", funnelId)
      .maybeSingle();
    if (error) throw new Error(error.code === "42703" ? FREEZE_COPY.notFrozen : "Something went wrong. Please try again.");
    if (!data) throw new Error("Not found.");
    const row = data as { frozen_at?: string | null; is_published: boolean };
    if (!row.frozen_at || row.is_published) throw new Error(FREEZE_COPY.notFrozen);
    await updateFunnel({ id: funnelId, is_published: true });
    destination = withParam(back, "saved", "reactivated");
  } catch (error) {
    destination = withParam(back, "error", errorMessage(error));
  }
  revalidateAll();
  redirect(destination);
}

/** Freezes one active form and activates one frozen form in one transaction. */
export async function swapFrozenFormAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  let destination: string;
  try {
    const restoreId = uuidField(formData, "restore_id");
    const freezeId = uuidField(formData, "freeze_id");
    await swapFrozenForm(tenantId, freezeId, restoreId);
    destination = withParam(PLAN_PATH, "saved", "swapped");
  } catch (error) {
    destination = withParam(PLAN_PATH, "error", errorMessage(error));
  }
  revalidateAll();
  redirect(destination);
}

/** Unfreezes one of the tenant's frozen pixels when a pixel slot is free. */
export async function reactivateFrozenPixelAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const rawId = field(formData, "pixel_id");
  const pixelId = UUID_PATTERN.test(rawId) ? rawId.toLowerCase() : null;
  // The pixel page may post here too; it gets its own page back.
  const requested = field(formData, "return_to");
  const back = pixelId && requested.toLowerCase() === `/admin/pixels/${pixelId}` ? `/admin/pixels/${pixelId}` : PLAN_PATH;
  let destination: string;
  try {
    if (!pixelId) throw new Error("Not found.");
    await reactivateFrozenPixel(tenantId, pixelId);
    destination = withParam(back, "saved", back === PLAN_PATH ? "pixel" : "pixel-reactivated");
  } catch (error) {
    destination = withParam(back, "error", errorMessage(error));
  }
  revalidateAll();
  redirect(destination);
}
