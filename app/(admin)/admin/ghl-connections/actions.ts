"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { listActiveFormsUsingConnection } from "@/lib/connections/service";
import {
  createGhlConnection,
  deleteGhlConnection,
  getGhlConnectionForTenant,
  updateGhlConnection
} from "@/lib/ghl/connections";

function optionalString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : undefined;
}

async function assertAdminConnection(id: string) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const connection = id ? await getGhlConnectionForTenant(id, tenantId) : null;
  if (!connection) {
    throw new Error(CONNECTIONS_COPY.notFound);
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
  revalidatePath("/admin/connections");
  revalidatePath("/admin/funnels");
  redirect(`/admin/connections?saved=created&connection=${connection.id}`);
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
  revalidatePath("/admin/connections");
  revalidatePath("/admin/funnels");
  redirect(`/admin/connections?saved=connection&connection=${connection.id}`);
}

export async function deleteGhlConnectionAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const tenantId = await assertAdminConnection(id);
  // Decision C9: an Active form using this connection blocks the delete.
  const activeForms = await listActiveFormsUsingConnection(tenantId, id, "ghl");
  if (activeForms.length) {
    redirect(`/admin/connections?error=${encodeURIComponent(CONNECTIONS_COPY.deleteBlocked(activeForms.map((form) => form.name)))}`);
  }
  await deleteGhlConnection(id);
  revalidatePath("/admin/connections");
  revalidatePath("/admin/funnels");
  redirect("/admin/connections?saved=deleted");
}
