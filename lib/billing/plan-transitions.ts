/**
 * Plan change directions and the owner's Client Management plan semantics.
 * Pure: no Next.js or Supabase imports.
 */

import { PLANS, type PlanState } from "@/lib/billing/plans";
import type { TenantPlanFields, TenantPlanUpdate } from "@/lib/provisioning/plan-change";

export type { TenantPlanFields, TenantPlanUpdate } from "@/lib/provisioning/plan-change";

export type PlanDirection = "none" | "upgrade" | "downgrade" | "suspend" | "restore";

export type PlanLimits = { maxActiveForms: number; maxDraftForms: number; maxPixels: number };

/** Limits of a plan state; null for suspended. */
export function limitsOf(state: PlanState): PlanLimits | null {
  if (state === "suspended") return null;
  const plan = PLANS[state];
  return { maxActiveForms: plan.maxActiveForms, maxDraftForms: plan.maxDraftForms, maxPixels: plan.maxPixels };
}

/**
 * none: same state; suspend: to suspended; restore: from suspended; otherwise
 * upgrade or downgrade by the active form limit, then the pixel limit.
 */
export function planDirection(from: PlanState, to: PlanState): PlanDirection {
  if (from === to) return "none";
  if (to === "suspended") return "suspend";
  if (from === "suspended") return "restore";
  const a = PLANS[from];
  const b = PLANS[to];
  if (b.maxActiveForms !== a.maxActiveForms) return b.maxActiveForms > a.maxActiveForms ? "upgrade" : "downgrade";
  if (b.maxPixels !== a.maxPixels) return b.maxPixels > a.maxPixels ? "upgrade" : "downgrade";
  return "none";
}

/**
 * Whether a plan change may be saved without the freeze (only when the
 * apply_tenant_plan_change RPC is missing). True only when nothing could need
 * freezing: same limits, an upgrade, or a suspension. A downgrade, or leaving a
 * suspension, must wait for the RPC so extra forms and pixels are frozen.
 */
export function canSaveWithoutFreeze(from: PlanState, to: PlanState): boolean {
  const direction = planDirection(from, to);
  return direction === "none" || direction === "upgrade" || direction === "suspend";
}

export type OwnerPlanRequest =
  | { kind: "set"; plan: "free" | "scaling" }
  | { kind: "suspend"; reason: string | null }
  | { kind: "restore" };

export type OwnerPlanResolution = {
  /** Null when nothing needs to change. */
  update: TenantPlanUpdate | null;
  resultingPlan: PlanState;
  /** True for a second suspension that only changes the reason (a direct update, no history). */
  reasonOnly: boolean;
};

/** Mirrors the Client Management plan, suspend and restore actions. */
export function resolveOwnerPlanChange(
  current: TenantPlanFields,
  request: OwnerPlanRequest,
  nowIso: string
): OwnerPlanResolution {
  if (request.kind === "set") {
    const alreadyClean =
      current.plan === request.plan &&
      current.plan_before_suspension === null &&
      current.suspended_at === null &&
      current.suspension_reason === null;
    return {
      update: alreadyClean
        ? null
        : { plan: request.plan, plan_before_suspension: null, suspended_at: null, suspension_reason: null },
      resultingPlan: request.plan,
      reasonOnly: false
    };
  }

  if (request.kind === "suspend") {
    if (current.plan === "suspended") {
      return {
        update: { suspension_reason: request.reason, suspended_at: current.suspended_at ?? nowIso },
        resultingPlan: "suspended",
        reasonOnly: true
      };
    }
    return {
      update: {
        plan: "suspended",
        plan_before_suspension: current.plan,
        suspended_at: nowIso,
        suspension_reason: request.reason
      },
      resultingPlan: "suspended",
      reasonOnly: false
    };
  }

  if (current.plan !== "suspended") {
    return { update: null, resultingPlan: current.plan, reasonOnly: false };
  }
  const restored = current.plan_before_suspension === "scaling" ? "scaling" : "free";
  return {
    update: { plan: restored, plan_before_suspension: null, suspended_at: null, suspension_reason: null },
    resultingPlan: restored,
    reasonOnly: false
  };
}

/** The tenant's plan fields after an update is applied over the current ones. */
export function mergePlanUpdate(current: TenantPlanFields, update: TenantPlanUpdate): TenantPlanFields {
  return {
    plan: update.plan ?? current.plan,
    plan_before_suspension:
      update.plan_before_suspension !== undefined ? update.plan_before_suspension : current.plan_before_suspension,
    suspended_at: update.suspended_at !== undefined ? update.suspended_at : current.suspended_at,
    suspension_reason: update.suspension_reason !== undefined ? update.suspension_reason : current.suspension_reason
  };
}
