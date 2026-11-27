import type { PlanState } from "@/lib/billing/plans";

/**
 * Plan changes sent by the sales-side automation (/api/provision) for an
 * existing tenant. Pure module, so node:test can load it.
 *
 * Mirrors setTenantPlan / suspendTenant / restoreTenant in
 * lib/owner/service.ts so the suspension fields always match the plan:
 * - "suspended" saves the paid plan in plan_before_suspension, so Restore in
 *   Client Management brings the customer back to the plan they paid for.
 * - "free" or "scaling" clears the suspension fields.
 *
 * An automation call may lift only a suspension the automation itself made
 * (marked by AUTOMATION_SUSPENSION_REASON). An owner suspension stays in place:
 * the new plan is saved as the plan to restore to, and the owner decides.
 */

export const AUTOMATION_SUSPENSION_REASON = "Suspended by the billing automation.";

export type TenantPlanFields = {
  plan: PlanState;
  plan_before_suspension: string | null;
  suspended_at: string | null;
  suspension_reason: string | null;
};

export type TenantPlanUpdate = Partial<{
  plan: PlanState;
  plan_before_suspension: "free" | "scaling" | null;
  suspended_at: string | null;
  suspension_reason: string | null;
}>;

export type ProvisionPlanChange = {
  /** Null when nothing needs to change. */
  update: TenantPlanUpdate | null;
  /** The plan the tenant is on after the change. */
  resultingPlan: PlanState;
  /** True when an owner suspension blocked the requested reactivation. */
  keptOwnerSuspension: boolean;
};

function isOwnerSuspension(current: TenantPlanFields): boolean {
  return current.plan === "suspended" && current.suspension_reason !== AUTOMATION_SUSPENSION_REASON;
}

export function resolveProvisionPlanChange(
  current: TenantPlanFields,
  requested: PlanState,
  nowIso: string
): ProvisionPlanChange {
  if (requested === "suspended") {
    if (current.plan === "suspended") {
      // Already suspended (by the owner or the automation): keep the saved plan,
      // date and reason as they are.
      return { update: null, resultingPlan: "suspended", keptOwnerSuspension: false };
    }
    return {
      update: {
        plan: "suspended",
        plan_before_suspension: current.plan,
        suspended_at: nowIso,
        suspension_reason: AUTOMATION_SUSPENSION_REASON
      },
      resultingPlan: "suspended",
      keptOwnerSuspension: false
    };
  }

  if (isOwnerSuspension(current)) {
    // Keep the owner's suspension; remember the paid plan for Restore.
    const update =
      current.plan_before_suspension === requested ? null : { plan_before_suspension: requested };
    return { update, resultingPlan: "suspended", keptOwnerSuspension: true };
  }

  const alreadyClean =
    current.plan === requested &&
    current.plan_before_suspension === null &&
    current.suspended_at === null &&
    current.suspension_reason === null;
  return {
    update: alreadyClean
      ? null
      : { plan: requested, plan_before_suspension: null, suspended_at: null, suspension_reason: null },
    resultingPlan: requested,
    keptOwnerSuspension: false
  };
}
