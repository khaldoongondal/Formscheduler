"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requirePlatformOwner } from "@/lib/auth/owner-server";
import { ownerBadgeSchema, ownerPlanSchema } from "@/lib/owner/format";
import {
  restoreForm,
  restoreTenant,
  resolveReport,
  setTenantBadge,
  setTenantPlan,
  suspendTenant,
  takeDownForm
} from "@/lib/owner/service";

const CLIENTS_PATH = "/admin/clients";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Only the owner list or one client's page; anything else falls back to the list. */
function returnPath(formData: FormData) {
  const value = field(formData, "return_to");
  if (value === CLIENTS_PATH) return CLIENTS_PATH;
  const match = /^\/admin\/clients\/([0-9a-f-]{36})$/i.exec(value);
  if (match && UUID_PATTERN.test(match[1])) return value;
  return CLIENTS_PATH;
}

function errorMessage(error: unknown) {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Please check the form and try again.";
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

function withParam(path: string, key: "saved" | "error", value: string) {
  return `${path}?${key}=${encodeURIComponent(value)}`;
}

async function runOwnerAction(formData: FormData, saved: string, work: (actor: string) => Promise<void>) {
  // The owner check runs before any input is read (non-owners get a 404).
  const owner = await requirePlatformOwner();
  const path = returnPath(formData);
  let destination: string;
  try {
    await work(owner.email);
    destination = withParam(path, "saved", saved);
  } catch (error) {
    console.error("[owner] action failed:", error instanceof Error ? error.message : "unknown error");
    destination = withParam(path, "error", errorMessage(error));
  }
  revalidatePath(CLIENTS_PATH, "layout");
  redirect(destination);
}

export async function setClientPlanAction(formData: FormData) {
  await runOwnerAction(formData, "plan", async (actor) => {
    const plan = ownerPlanSchema.parse(field(formData, "plan"));
    await setTenantPlan(actor, field(formData, "tenant_id"), plan);
  });
}

export async function setClientBadgeAction(formData: FormData) {
  await runOwnerAction(formData, "badge", async (actor) => {
    const enabled = ownerBadgeSchema.parse(field(formData, "badge"));
    await setTenantBadge(actor, field(formData, "tenant_id"), enabled);
  });
}

export async function suspendClientAction(formData: FormData) {
  await runOwnerAction(formData, "suspended", async (actor) => {
    await suspendTenant(actor, field(formData, "tenant_id"), field(formData, "reason"));
  });
}

export async function restoreClientAction(formData: FormData) {
  await runOwnerAction(formData, "restored", async (actor) => {
    await restoreTenant(actor, field(formData, "tenant_id"));
  });
}

export async function takeDownFormAction(formData: FormData) {
  await runOwnerAction(formData, "form-taken-down", async (actor) => {
    await takeDownForm(actor, field(formData, "funnel_id"), field(formData, "reason"));
  });
}

export async function restoreFormAction(formData: FormData) {
  await runOwnerAction(formData, "form-restored", async (actor) => {
    await restoreForm(actor, field(formData, "funnel_id"));
  });
}

export async function dismissReportAction(formData: FormData) {
  await runOwnerAction(formData, "report-dismissed", async (actor) => {
    await resolveReport(actor, field(formData, "report_id"), "dismissed");
  });
}
