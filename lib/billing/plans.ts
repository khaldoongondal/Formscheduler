/**
 * FormBook plan definitions and pure limit logic.
 *
 * This module must stay free of Supabase and Next.js imports so it can be
 * unit tested with node:test. I/O lives in lib/billing/plan-service.ts.
 */

export type PlanId = "free" | "scaling";
export type PlanState = PlanId | "suspended";

export type PlanDefinition = {
  id: PlanId;
  /** "Bootstrapping" | "Scaling" */
  name: string;
  /** 0 | 1447 */
  monthlyPriceCents: number;
  maxActiveForms: number;
  maxDraftForms: number;
  /** Meta pixels per tenant. The pixel table arrives in Sprint 2. */
  maxPixels: number;
};

/** The one owner contact address. Every message or page imports this constant. */
export const CONTACT_EMAIL = "khaldoon@gondaltech.com";

/**
 * Must equal the seed in supabase/migrations/0020_plans_and_form_limits.sql
 * (table public.plan_limits). The database trigger is the authority; these
 * values drive the friendly pre-checks and the admin usage display.
 */
export const PLANS: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Bootstrapping",
    monthlyPriceCents: 0,
    maxActiveForms: 3,
    maxDraftForms: 10,
    maxPixels: 1
  },
  scaling: {
    id: "scaling",
    name: "Scaling",
    monthlyPriceCents: 1447,
    maxActiveForms: 30,
    maxDraftForms: 100,
    maxPixels: 3
  }
};

export const PLAN_IDS: readonly PlanId[] = ["free", "scaling"];
export const LEGACY_PLAN_IDS = ["tier1", "tier2", "tier3"] as const;

export function isPlanId(value: unknown): value is PlanId {
  return value === "free" || value === "scaling";
}

export function isPlanState(value: unknown): value is PlanState {
  return isPlanId(value) || value === "suspended";
}

/** tier1/tier2/tier3 -> "scaling"; free/scaling/suspended pass through; anything else -> "free". */
export function parsePlanState(value: unknown): PlanState {
  if (isPlanState(value)) return value;
  if ((LEGACY_PLAN_IDS as readonly unknown[]).includes(value)) return "scaling";
  return "free";
}

export function formatPlanPrice(plan: PlanDefinition): string {
  if (plan.monthlyPriceCents <= 0) return "Free";
  return `$${(plan.monthlyPriceCents / 100).toFixed(2)} a month`;
}

export type FormUsage = { activeForms: number; draftForms: number };
export type FormLimitAction = "create_draft" | "activate" | "deactivate";
export type FormLimitReason = "suspended" | "active_forms" | "draft_forms";
export type FormLimitResult =
  | { allowed: true }
  | { allowed: false; reason: FormLimitReason; message: string };

export const SUSPENDED_MESSAGE = `This account is suspended. Email ${CONTACT_EMAIL} to restore it.`;
export const PLAN_CHECK_FAILED_MESSAGE = `We could not check your plan. Please try again or email ${CONTACT_EMAIL}.`;
export const TAKEN_DOWN_MESSAGE = `This form was taken down by FormBook. Email ${CONTACT_EMAIL} if you think this is a mistake.`;

export function activeLimitMessage(plan: PlanDefinition): string {
  const base = `You have reached the limit of ${plan.maxActiveForms} active forms on the ${plan.name} plan. Switch another form to draft first`;
  return plan.id === "free" ? `${base}, or email ${CONTACT_EMAIL} about the Scaling plan.` : `${base}.`;
}

export function draftLimitMessage(plan: PlanDefinition): string {
  return `You have reached the limit of ${plan.maxDraftForms} draft forms on the ${plan.name} plan. Delete a draft you no longer need, then try again.`;
}

/** Pure decision mirroring the SQL trigger. `usage` excludes the form being changed. */
export function checkFormLimit(state: PlanState, usage: FormUsage, action: FormLimitAction): FormLimitResult {
  if (action === "deactivate") return { allowed: true };
  if (state === "suspended") {
    return { allowed: false, reason: "suspended", message: SUSPENDED_MESSAGE };
  }

  const plan = PLANS[state];
  if (action === "activate") {
    return usage.activeForms < plan.maxActiveForms
      ? { allowed: true }
      : { allowed: false, reason: "active_forms", message: activeLimitMessage(plan) };
  }

  return usage.draftForms < plan.maxDraftForms
    ? { allowed: true }
    : { allowed: false, reason: "draft_forms", message: draftLimitMessage(plan) };
}

/**
 * Maps "FORMBOOK_LIMIT:<reason>" anywhere in a message (raised by the database
 * triggers) to the user message, else null. Without a known plan state the
 * active and draft messages fall back to the free plan wording.
 */
export function planLimitMessageFromError(message: string, state?: PlanState): string | null {
  const match = /FORMBOOK_LIMIT:([a-z_]+)/.exec(message ?? "");
  if (!match) return null;

  const plan = state && state !== "suspended" ? PLANS[state] : PLANS.free;
  switch (match[1]) {
    case "active_forms":
      return activeLimitMessage(plan);
    case "draft_forms":
      return draftLimitMessage(plan);
    case "suspended":
      return SUSPENDED_MESSAGE;
    case "taken_down":
      return TAKEN_DOWN_MESSAGE;
    case "tenant_missing":
    case "unknown_plan":
    default:
      return PLAN_CHECK_FAILED_MESSAGE;
  }
}
