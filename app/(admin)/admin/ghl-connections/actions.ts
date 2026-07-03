"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import {
  createGhlConnection,
  deleteGhlConnection,
  getGhlConnection,
  updateGhlConnection
} from "@/lib/ghl/connections";

function optionalString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : undefined;
}

async function assertAdminConnection(id: string) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const connection = await getGhlConnection(id);
  if (connection.tenant_id !== tenantId) {
    throw new Error("GHL connection not found.");
  }
  return tenantId;
}

export async function createGhlConnectionAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const connection = await createGhlConnection({
    tenant_id: tenantId,
    name: String(formData.get("name") ?? ""),
    location_id: String(formData.get("location_id") ?? ""),
    calendar_id: optionalString(formData, "calendar_id"),
    private_token: optionalString(formData, "private_token"),
    api_base_url: optionalString(formData, "api_base_url") ?? "https://services.leadconnectorhq.com",
    api_version: optionalString(formData, "api_version") ?? "2023-02-21",
    is_active: formData.get("is_active") === "on"
  });
  revalidatePath("/admin/ghl-connections");
  revalidatePath("/admin/funnels");
  redirect(`/admin/ghl-connections?saved=created&connection=${connection.id}`);
}

export async function updateGhlConnectionAction(formData: FormData) {
  const tenantId = await assertAdminConnection(String(formData.get("id") ?? ""));
  const connection = await updateGhlConnection({
    id: String(formData.get("id") ?? ""),
    tenant_id: tenantId,
    name: String(formData.get("name") ?? ""),
    location_id: String(formData.get("location_id") ?? ""),
    calendar_id: optionalString(formData, "calendar_id"),
    private_token: optionalString(formData, "private_token"),
    api_base_url: optionalString(formData, "api_base_url") ?? "https://services.leadconnectorhq.com",
    api_version: optionalString(formData, "api_version") ?? "2023-02-21",
    is_active: formData.get("is_active") === "on"
  });
  revalidatePath("/admin/ghl-connections");
  revalidatePath("/admin/funnels");
  redirect(`/admin/ghl-connections?saved=connection&connection=${connection.id}`);
}

export async function deleteGhlConnectionAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await assertAdminConnection(id);
  await deleteGhlConnection(id);
  revalidatePath("/admin/ghl-connections");
  revalidatePath("/admin/funnels");
  redirect("/admin/ghl-connections?saved=deleted");
}
