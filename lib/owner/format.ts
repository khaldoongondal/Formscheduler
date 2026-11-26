import { z } from "zod";
import { PLANS, type PlanState } from "@/lib/billing/plans";

/**
 * Pure helpers for the platform-owner area (/admin/clients): input schemas,
 * labels and limit warnings. No Next.js or Supabase imports.
 */

export const OWNER_REASON_MAX = 500;

export const ownerUuidSchema = z.string().trim().uuid("That record id is not valid.");
export const ownerPlanSchema = z.enum(["free", "scaling", "suspended"], {
  errorMap: () => ({ message: "Choose a valid plan." })
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
  errorMap: () => ({ message: "Choose a valid report status." })
});
export const ownerBadgeSchema = z.enum(["on", "off"]).transform((value) => value === "on");

export function planStateLabel(state: PlanState): string {
  return state === "suspended" ? "Suspended" : PLANS[state].name;
}

export type ClientFormStatus = "Active" | "Draft" | "Taken down";

export function clientFormStatus(form: { is_published: boolean; taken_down_at: string | null }): ClientFormStatus {
  if (form.taken_down_at) return "Taken down";
  return form.is_published ? "Active" : "Draft";
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
  return `This client has ${activeForms} active forms and the ${plan.name} plan allows ${plan.maxActiveForms}. Their current forms stay live; they cannot activate more until they are under the limit.`;
}

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
