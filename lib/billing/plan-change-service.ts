import { PublicError } from "@/lib/api/responses";
import {
  FREEZE_COPY,
  freezeMessageFromError,
  planFormFreeze,
  rankPixels,
  rankRestorableForms,
  type FormActivity,
  type PixelActivity
} from "@/lib/billing/freeze";
import { planLimitMessageForTenant } from "@/lib/billing/plan-service";
import { canSaveWithoutFreeze, mergePlanUpdate } from "@/lib/billing/plan-transitions";
import { PLANS, parsePlanState, planLimitMessageFromError, type PlanState } from "@/lib/billing/plans";
import { listConnections } from "@/lib/connections/service";
import { formSetupError, type FormConnectionColumns } from "@/lib/connections/setup-state";
import { assertFunnelReadyToPublish } from "@/lib/funnels/service";
import { listGhlConnections } from "@/lib/ghl/connections";
import type { TenantPlanFields, TenantPlanUpdate } from "@/lib/provisioning/plan-change";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json, TenantFormActivityRow, TenantPixelActivityRow } from "@/lib/types/database";

/**
 * The one way a tenant's plan changes (decision D1): /api/provision and the
 * owner's Client Management page both call applyPlanChange, which runs the
 * apply_tenant_plan_change RPC (migration 0032): plan fields, downgrade
 * freeze, upgrade restore, split tests that lose a form, and plan history in
 * one transaction. Callers check access first; every query is tenant scoped.
 */

export type PlanChangeSource = "provision" | "owner";

export type AppliedPlanChange = {
  changed: boolean;
  historyId: string | null;
  from: PlanState;
  to: PlanState;
  frozenForms: number;
  frozenPixels: number;
  restoredForms: number;
  restoredPixels: number;
  endedSplitTests: number;
};

export const PLAN_CHANGED_MESSAGE = "The plan changed while we were saving. Please try again.";
export const CLIENT_NOT_FOUND_MESSAGE = "Client not found.";
/** 503 so the billing automation retries; the plan is left unchanged. */
export const PLAN_UPDATE_PAUSED_MESSAGE = "Plan changes are paused for an update. Please try again in a few minutes.";

type DbError = { message: string; code?: string };

function isMissingFunction(error: DbError | null | undefined): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

function isMissingColumn(error: DbError | null | undefined): boolean {
  return error?.code === "42703";
}

function noChange(plan: PlanState): AppliedPlanChange {
  return {
    changed: false,
    historyId: null,
    from: plan,
    to: plan,
    frozenForms: 0,
    frozenPixels: 0,
    restoredForms: 0,
    restoredPixels: 0,
    endedSplitTests: 0
  };
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The tenant's forms with their most recent lead; empty before migration 0032. */
export async function loadFormActivity(tenantId: string): Promise<FormActivity[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("tenant_form_activity", { p_tenant_id: tenantId });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as TenantFormActivityRow[]).map((row) => ({
    id: row.funnel_id,
    name: row.name,
    isPublished: row.is_published === true,
    frozenAt: row.frozen_at ?? null,
    takenDownAt: row.taken_down_at ?? null,
    createdAt: row.created_at,
    metaPixelId: row.meta_pixel_id ?? null,
    lastLeadAt: row.last_lead_at ?? null
  }));
}

/** The tenant's Meta pixels with their most recent event; empty before migration 0032. */
export async function loadPixelActivity(tenantId: string): Promise<PixelActivity[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("tenant_pixel_activity", { p_tenant_id: tenantId });
  if (error) {
    if (isMissingFunction(error)) return [];
    throw new Error(error.message);
  }
  return ((data ?? []) as TenantPixelActivityRow[]).map((row) => ({
    id: row.pixel_id,
    name: row.name,
    frozenAt: row.frozen_at ?? null,
    createdAt: row.created_at,
    lastEventAt: row.last_event_at ?? null
  }));
}

/** Slugs of the given forms of the tenant (for the Plan page list). */
export async function loadFormSlugs(tenantId: string, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("funnels").select("id,slug").eq("tenant_id", tenantId).in("id", ids);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as Array<{ id: string; slug: string }>).map((row) => [row.id, row.slug]));
}

/**
 * Ids of the tenant's frozen forms that pass the activation rule now (formSetupError is null).
 * Connection read errors are thrown, never treated as "no connections": an
 * upgrade would otherwise restore nothing and still report success. The plan
 * change reads this before the RPC, so a throw leaves the plan unchanged and
 * /api/provision answers 5xx, which the billing automation retries.
 */
export async function readyFrozenFormIds(tenantId: string, forms: FormActivity[]): Promise<Set<string>> {
  const frozenIds = forms.filter((form) => form.frozenAt && !form.isPublished && !form.takenDownAt).map((form) => form.id);
  if (frozenIds.length === 0) return new Set();
  const supabase = createServiceClient();
  const [rowsResult, ghlConnections, connections] = await Promise.all([
    supabase.from("funnels").select("*").eq("tenant_id", tenantId).in("id", frozenIds),
    listGhlConnections(tenantId),
    listConnections(tenantId)
  ]);
  if (rowsResult.error) throw new Error(rowsResult.error.message);
  const ready = new Set<string>();
  for (const row of (rowsResult.data ?? []) as unknown as Array<FormConnectionColumns & { id: string }>) {
    if (formSetupError(row, ghlConnections, connections) === null) ready.add(row.id);
  }
  return ready;
}

async function readPlanFields(tenantId: string): Promise<TenantPlanFields> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("plan,plan_before_suspension,suspended_at,suspension_reason")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(CLIENT_NOT_FOUND_MESSAGE);
  return {
    plan: parsePlanState(data.plan),
    plan_before_suspension: data.plan_before_suspension ?? null,
    suspended_at: data.suspended_at ?? null,
    suspension_reason: data.suspension_reason ?? null
  };
}

/**
 * apply_tenant_plan_change is missing (migration 0032 not applied, or a stale
 * schema cache). Only a change that cannot need a freeze (upgrade, suspension,
 * same limits) is saved directly, without history. A downgrade or a restore
 * from suspension is refused with a 503 so the caller retries once the RPC is
 * back, instead of leaving extra forms live on the smaller plan.
 */
async function applyWithoutFreeze(
  tenantId: string,
  update: TenantPlanUpdate,
  from: PlanState,
  to: PlanState
): Promise<AppliedPlanChange> {
  if (!canSaveWithoutFreeze(from, to)) {
    console.error(`[plan] apply_tenant_plan_change missing, refused ${from}->${to}`);
    throw new PublicError(PLAN_UPDATE_PAUSED_MESSAGE, 503);
  }
  console.warn("[plan] apply_tenant_plan_change missing, plan saved without freeze");
  const supabase = createServiceClient();
  const { error } = await supabase.from("tenants").update(update).eq("id", tenantId);
  if (error) throw new Error(error.message);
  return { ...noChange(from), changed: true, to };
}

class PlanChangedError extends Error {}

async function attempt(input: {
  tenantId: string;
  resolve: (current: TenantPlanFields) => { update: TenantPlanUpdate | null; resultingPlan: PlanState };
  source: PlanChangeSource;
  actor: string;
  note?: string | null;
}): Promise<AppliedPlanChange> {
  const current = await readPlanFields(input.tenantId);
  const { update } = input.resolve(current);
  if (!update) return noChange(current.plan);

  const next = mergePlanUpdate(current, update);
  const target = next.plan;

  let formKeepOrder: string[] = [];
  let pixelKeepOrder: string[] = [];
  let restorable: string[] = [];
  if (target !== "suspended") {
    const [forms, pixels] = await Promise.all([loadFormActivity(input.tenantId), loadPixelActivity(input.tenantId)]);
    const formPlan = planFormFreeze(forms, PLANS[target].maxActiveForms);
    formKeepOrder = [...formPlan.keep, ...formPlan.freeze];
    const keptIds = new Set(formPlan.keep);
    pixelKeepOrder = rankPixels(
      pixels,
      forms.filter((form) => keptIds.has(form.id))
    );
    restorable = rankRestorableForms(forms, await readyFrozenFormIds(input.tenantId, forms));
  }

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("apply_tenant_plan_change", {
    p_tenant_id: input.tenantId,
    p_expected_plan: current.plan,
    p_plan: next.plan,
    p_plan_before_suspension: next.plan_before_suspension,
    p_suspended_at: next.suspended_at,
    p_suspension_reason: next.suspension_reason,
    p_form_keep_order: formKeepOrder,
    p_pixel_keep_order: pixelKeepOrder,
    p_restorable_form_ids: restorable,
    p_source: input.source,
    p_actor: input.actor ? input.actor.slice(0, 254) : null,
    p_note: input.note ? input.note.slice(0, 500) : null
  });
  if (error) {
    if (isMissingFunction(error)) return applyWithoutFreeze(input.tenantId, update, current.plan, target);
    if (error.message.includes("FORMBOOK_PLAN:changed")) throw new PlanChangedError(PLAN_CHANGED_MESSAGE);
    if (error.message.includes("FORMBOOK_PLAN:tenant_missing")) throw new Error(CLIENT_NOT_FOUND_MESSAGE);
    const limit = planLimitMessageFromError(error.message, target);
    if (limit) throw new Error(limit);
    throw new Error(error.message);
  }

  const result = (data ?? {}) as Record<string, Json>;
  const applied: AppliedPlanChange = {
    changed: true,
    historyId: typeof result.history_id === "string" ? result.history_id : null,
    from: current.plan,
    to: next.plan,
    frozenForms: count(result.frozen_forms),
    frozenPixels: count(result.frozen_pixels),
    restoredForms: count(result.restored_forms),
    restoredPixels: count(result.restored_pixels),
    endedSplitTests: count(result.ended_split_tests)
  };
  console.info(
    `[plan] applied ${applied.from}->${applied.to} frozen=${applied.frozenForms}/${applied.frozenPixels} restored=${applied.restoredForms}/${applied.restoredPixels}`
  );
  return applied;
}

/**
 * Applies a plan change for one tenant. `resolve` turns the current plan fields
 * into the update (null: nothing to do, no history row). A concurrent change
 * between the read and the write is retried once.
 */
export async function applyPlanChange(input: {
  tenantId: string;
  resolve: (current: TenantPlanFields) => { update: TenantPlanUpdate | null; resultingPlan: PlanState };
  source: PlanChangeSource;
  /** Owner email, or "billing automation". */
  actor: string;
  note?: string | null;
}): Promise<AppliedPlanChange> {
  try {
    return await attempt(input);
  } catch (error) {
    if (!(error instanceof PlanChangedError)) throw error;
  }
  try {
    return await attempt(input);
  } catch (error) {
    if (error instanceof PlanChangedError) throw new Error(PLAN_CHANGED_MESSAGE);
    throw error;
  }
}

/** Freeze one active form and activate one frozen form of the tenant, in one transaction. */
export async function swapFrozenForm(
  tenantId: string,
  freezeId: string,
  restoreId: string
): Promise<{ endedSplitTests: number }> {
  if (freezeId === restoreId) throw new Error(FREEZE_COPY.sameForm);
  const supabase = createServiceClient();
  const { data: owned, error: ownedError } = await supabase
    .from("funnels")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", [freezeId, restoreId]);
  if (ownedError) throw new Error(ownedError.message);
  if ((owned ?? []).length !== 2) throw new Error("Not found.");

  await assertFunnelReadyToPublish(tenantId, restoreId);

  const { data, error } = await supabase.rpc("swap_frozen_form", {
    p_tenant_id: tenantId,
    p_freeze_id: freezeId,
    p_restore_id: restoreId
  });
  if (error) {
    const freeze = freezeMessageFromError(error.message);
    if (freeze) throw new Error(freeze);
    const limit = await planLimitMessageForTenant(error.message, tenantId);
    if (limit) throw new Error(limit);
    console.error("[plan] swap failed", error.message);
    throw new Error("Something went wrong. Please try again.");
  }
  const result = (data ?? {}) as Record<string, Json>;
  return { endedSplitTests: count(result.ended_split_tests) };
}

/** Unfreeze one of the tenant's frozen pixels; the database trigger enforces the pixel limit. */
export async function reactivateFrozenPixel(tenantId: string, pixelId: string): Promise<void> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("meta_pixels")
    .update({ frozen_at: null })
    .eq("tenant_id", tenantId)
    .eq("id", pixelId)
    .not("frozen_at", "is", null)
    .select("id");
  if (error) {
    if (isMissingColumn(error)) throw new Error(FREEZE_COPY.pixelNotFrozen);
    const limit = await planLimitMessageForTenant(error.message, tenantId);
    if (limit) throw new Error(limit);
    console.error("[plan] pixel reactivation failed", error.message);
    throw new Error("Something went wrong. Please try again.");
  }
  if (!data || data.length === 0) throw new Error(FREEZE_COPY.pixelNotFrozen);
}
