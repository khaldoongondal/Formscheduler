"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTenantRole } from "@/lib/auth/tenant";
import { createPixel, deletePixel, updatePixel } from "@/lib/meta/pixels";

const LIST_PATH = "/admin/pixels";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong. Please try again.";
}

function detailPath(pixelId: string) {
  return `${LIST_PATH}/${encodeURIComponent(pixelId)}`;
}

function pixelInput(formData: FormData) {
  return {
    name: field(formData, "name"),
    dataset_id: field(formData, "dataset_id"),
    access_token: field(formData, "access_token"),
    test_event_code: field(formData, "test_event_code")
  };
}

async function adminTenantId() {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  return tenantId;
}

export async function createPixelAction(formData: FormData) {
  let pixelId: string;
  try {
    const tenantId = await adminTenantId();
    pixelId = await createPixel(tenantId, pixelInput(formData));
  } catch (error) {
    redirect(`${LIST_PATH}?error=${encodeURIComponent(errorMessage(error))}#add-pixel`);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(pixelId)}?saved=created`);
}

export async function updatePixelAction(formData: FormData) {
  const pixelId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await updatePixel(tenantId, pixelId, pixelInput(formData));
  } catch (error) {
    redirect(`${detailPath(pixelId)}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(LIST_PATH);
  redirect(`${detailPath(pixelId)}?saved=saved`);
}

export async function deletePixelAction(formData: FormData) {
  const pixelId = field(formData, "id");
  try {
    const tenantId = await adminTenantId();
    await deletePixel(tenantId, pixelId);
  } catch (error) {
    redirect(`${detailPath(pixelId)}?error=${encodeURIComponent(errorMessage(error))}`);
  }
  revalidatePath(LIST_PATH);
  revalidatePath("/admin/funnels");
  redirect(`${LIST_PATH}?saved=deleted`);
}
