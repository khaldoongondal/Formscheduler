"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { requirePlatformOwner } from "@/lib/auth/owner-server";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { drainLifecycleDeliveries } from "@/lib/lifecycle/drain";
import { LIFECYCLE_COPY, lifecycleConfig } from "@/lib/lifecycle/events";
import { enqueueLifecycleTest } from "@/lib/lifecycle/queue";
import { hitRateLimit } from "@/lib/security/rate-limit";
import { ownerBadgeSchema, ownerPlanSchema, planChangeParams, type PlanChangeCounts } from "@/lib/owner/format";
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

function withParams(path: string, params: Record<string, string>) {
  return `${path}?${new URLSearchParams(params).toString()}`;
}

/** Runs an owner action; a plan change's frozen and restored counts are added to the redirect. */
async function runOwnerAction(
  formData: FormData,
  saved: string,
  work: (actor: string) => Promise<PlanChangeCounts | void>
) {
  // The owner check runs before any input is read (non-owners get a 404).
  const owner = await requirePlatformOwner();
  const path = returnPath(formData);
  let destination: string;
  try {
    const counts = await work(owner.email);
    destination = withParams(path, { saved, ...(counts ? planChangeParams(counts) : {}) });
  } catch (error) {
    console.error("[owner] action failed:", error instanceof Error ? error.message : "unknown error");
    destination = withParams(path, { error: errorMessage(error) });
  }
  revalidatePath(CLIENTS_PATH, "layout");
  redirect(destination);
}

export async function setClientPlanAction(formData: FormData) {
  await runOwnerAction(formData, "plan", async (actor) => {
    const plan = ownerPlanSchema.parse(field(formData, "plan"));
    return setTenantPlan(actor, field(formData, "tenant_id"), plan);
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
    return suspendTenant(actor, field(formData, "tenant_id"), field(formData, "reason"));
  });
}

export async function restoreClientAction(formData: FormData) {
  await runOwnerAction(formData, "restored", async (actor) => {
    return restoreTenant(actor, field(formData, "tenant_id"));
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

/** Queues a test event for the owner's own account and sends it straight away (decision D20). */
export async function sendLifecycleTestAction(formData: FormData) {
  await runOwnerAction(formData, "lifecycle_test", async (actor) => {
    if (!lifecycleConfig(process.env)) throw new Error(LIFECYCLE_COPY.testOff);
    const limit = await hitRateLimit({ scope: "lifecycle-test", subject: actor, limit: 10, windowSeconds: 3600 });
    if (!limit.allowed) throw new Error(LIFECYCLE_COPY.testLimit);
    const tenantId = await getAdminTenantId();
    const id = await enqueueLifecycleTest(tenantId);
    if (!id) throw new Error(LIFECYCLE_COPY.testFailed);
    const result = await drainLifecycleDeliveries(randomUUID(), { budgetMs: 20000, limit: 1, ids: [id] });
    if (result.sent !== 1) throw new Error(LIFECYCLE_COPY.testFailed);
  });
}

export async function dismissReportAction(formData: FormData) {
  await runOwnerAction(formData, "report-dismissed", async (actor) => {
    await resolveReport(actor, field(formData, "report_id"), "dismissed");
  });
}
