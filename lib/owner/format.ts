import { z } from "zod";
import { PLANS, type PlanState } from "@/lib/billing/plans";

/**
 * Pure helpers for the platform-owner area (/admin/clients): input schemas,
 * labels and limit warnings. No Next.js or Supabase imports.
 */

export const OWNER_REASON_MAX = 500;

export const ownerUuidSchema = z.string().trim().guid("That record id is not valid.");
export const ownerPlanSchema = z.enum(["free", "scaling", "suspended"], {
  error: "Choose a valid plan."
});
export const ownerOptionalReasonSchema = z
  .string()
  .trim()
  .max(OWNER_REASON_MAX, `Keep the reason under ${OWNER_REASON_MAX} characters.`)
  .optional()
  .transform((value) => (value ? value : undefined));
export const ownerRequiredReasonSchema = z
  .string()
  .trim()
  .min(1, "Enter a reason for the takedown.")
  .max(OWNER_REASON_MAX, `Keep the reason under ${OWNER_REASON_MAX} characters.`);
export const ownerReportStatusSchema = z.enum(["actioned", "dismissed"], {
  error: "Choose a valid report status."
});
export const ownerBadgeSchema = z.enum(["on", "off"]).transform((value) => value === "on");

export function planStateLabel(state: PlanState): string {
  return state === "suspended" ? "Suspended" : PLANS[state].name;
}

export type ClientFormStatus = "Active" | "Draft" | "Taken down" | "Frozen";

/** Taken down wins, then active, then frozen, then draft. */
export function clientFormStatus(form: {
  is_published: boolean;
  taken_down_at: string | null;
  frozen_at?: string | null;
}): ClientFormStatus {
  if (form.taken_down_at) return "Taken down";
  if (form.is_published) return "Active";
  return form.frozen_at ? "Frozen" : "Draft";
}

/** Limits shown in the owner table; suspended accounts are measured against zero. */
export function planLimitsFor(state: PlanState): { maxActiveForms: number; maxDraftForms: number } {
  if (state === "suspended") return { maxActiveForms: 0, maxDraftForms: 0 };
  return { maxActiveForms: PLANS[state].maxActiveForms, maxDraftForms: PLANS[state].maxDraftForms };
}

export function isOverActiveLimit(state: PlanState, activeForms: number): boolean {
  return activeForms > planLimitsFor(state).maxActiveForms;
}

/**
 * Warning on the client detail page when a plan's active form limit is below
 * the client's current usage. Null when the plan fits (or for suspended).
 */
export function planDowngradeWarning(target: PlanState, activeForms: number): string | null {
  if (target === "suspended") return null;
  const plan = PLANS[target];
  if (activeForms <= plan.maxActiveForms) return null;
  return `This client has ${activeForms} active forms and the ${plan.name} plan allows ${plan.maxActiveForms}. Switching freezes ${activeForms - plan.maxActiveForms} of them, the ones with the oldest leads. Nothing is deleted, and the client can choose which forms stay active.`;
}

/** Same warning for Meta pixels. Null when the plan fits (or for suspended). */
export function pixelDowngradeWarning(target: PlanState, unfrozenPixels: number): string | null {
  if (target === "suspended") return null;
  const plan = PLANS[target];
  if (unfrozenPixels <= plan.maxPixels) return null;
  return `This client has ${unfrozenPixels} Meta pixels and the ${plan.name} plan allows ${plan.maxPixels}. Switching freezes ${unfrozenPixels - plan.maxPixels} of them. Nothing is deleted.`;
}

/** "Would freeze: a, b" under a downgrade warning; null when there are no names. */
export function wouldFreezeLine(names: string[]): string | null {
  const clean = names.filter((name) => name.trim().length > 0);
  return clean.length ? `Would freeze: ${clean.join(", ")}` : null;
}

export type PlanChangeCounts = {
  frozenForms: number;
  frozenPixels: number;
  restoredForms: number;
  restoredPixels: number;
};

export const PLAN_CHANGE_PARAMS = {
  frozenForms: "frozen_forms",
  frozenPixels: "frozen_pixels",
  restoredForms: "restored_forms",
  restoredPixels: "restored_pixels"
} as const;

/** Query parameters for the non-zero counts of a plan change (for the redirect after an owner action). */
export function planChangeParams(counts: PlanChangeCounts): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, name] of Object.entries(PLAN_CHANGE_PARAMS) as Array<[keyof PlanChangeCounts, string]>) {
    const value = Math.floor(Number(counts[key]) || 0);
    if (value > 0) params[name] = String(value);
  }
  return params;
}

function parseCount(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,4}$/.test(value)) return 0;
  const n = Number(value);
  return n >= 0 && n <= 1000 ? n : 0;
}

/** Counts read back from the query (integers 0 to 1000; anything else is ignored). */
export function parsePlanChangeParams(query: Record<string, unknown>): PlanChangeCounts {
  return {
    frozenForms: parseCount(query[PLAN_CHANGE_PARAMS.frozenForms]),
    frozenPixels: parseCount(query[PLAN_CHANGE_PARAMS.frozenPixels]),
    restoredForms: parseCount(query[PLAN_CHANGE_PARAMS.restoredForms]),
    restoredPixels: parseCount(query[PLAN_CHANGE_PARAMS.restoredPixels])
  };
}

function countsSentence(forms: number, pixels: number, verb: string): string | null {
  const parts: string[] = [];
  if (forms > 0) parts.push(forms === 1 ? "1 form" : `${forms} forms`);
  if (pixels > 0) parts.push(pixels === 1 ? "1 Meta pixel" : `${pixels} Meta pixels`);
  if (parts.length === 0) return null;
  const plural = forms + pixels > 1;
  return `${parts.join(" and ")} ${plural ? "were" : "was"} ${verb}.`;
}

/** "2 forms and 1 Meta pixel were frozen." plus the restored line; parts that are zero are left out. */
export function planChangeNotice(counts: PlanChangeCounts): string[] {
  return [
    countsSentence(counts.frozenForms, counts.frozenPixels, "frozen"),
    countsSentence(counts.restoredForms, counts.restoredPixels, "restored")
  ].filter((line): line is string => Boolean(line));
}

export const PLAN_HISTORY_COPY = {
  heading: "Plan history",
  empty: "No plan changes recorded yet.",
  accountRef: "Account reference",
  sourceProvision: "Billing automation",
  sourceOwner: "Client Management",
  created: "Created"
} as const;

export function defaultTakedownReason(reasonLabel: string): string {
  return `Reported as ${reasonLabel}`.slice(0, OWNER_REASON_MAX);
}

/** Short date for owner tables, in UTC so server rendering is stable. */
export function formatOwnerDate(value: string | null | undefined): string {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
}
