/**
 * Owner activation funnel (Sprint 4, decision D24). Pure: plan types only.
 */
import type { PlanState } from "@/lib/billing/plans";

export type ActivationRow = {
  tenantId: string;
  signupSource: "legacy" | "provisioned" | "self_serve";
  plan: PlanState;
  createdAt: string;
  firstConnectionAt: string | null;
  firstFormActivatedAt: string | null;
  firstLeadAt: string | null;
  firstBookingAt: string | null;
  everScaling: boolean;
};

export type ActivationStepKey =
  | "signed_up"
  | "verified"
  | "connected"
  | "first_active_form"
  | "first_lead"
  | "first_booking"
  | "upgraded";

export type ActivationStep = {
  key: ActivationStepKey;
  label: string;
  count: number;
  pctOfSignups: number | null;
  pctOfBase: number | null;
  baseLabel: string | null;
};

export type Period = "all" | "90" | "30";

export const ACTIVATION_COPY = {
  title: "Activation funnel",
  periods: { all: "All time", "90": "Last 90 days", "30": "Last 30 days" },
  columns: { step: "Step", accounts: "Accounts", ofSignups: "Of signups", fromBase: "From previous step" },
  steps: {
    signed_up: "Signed up",
    verified: "Verified",
    connected: "Connected a tool",
    first_active_form: "First active form",
    first_lead: "First lead",
    first_booking: "First booking",
    upgraded: "Upgraded to Scaling"
  },
  upgradedBase: "of verified",
  none: "None yet",
  legacyNote: (n: number) =>
    n === 1 ? "1 account created before the relaunch is not counted." : `${n} accounts created before the relaunch are not counted.`,
  backfillNote: "First active form dates before this release are estimated from the form's creation date.",
  stageColumn: "Stage",
  stages: {
    verified: "Verified",
    connected: "Connected",
    form_live: "Form live",
    first_lead: "First lead",
    first_booking: "First booking"
  },
  upgradedPill: "Upgraded",
  milestonesTitle: "Milestones",
  historyTitle: "Plan history",
  historyEmpty: "No plan changes recorded yet.",
  historyColumns: { when: "When", change: "Change", by: "By", effect: "Effect", note: "Note" },
  bySource: { provision: "Billing automation", owner: "Owner" },
  accountRef: "Account reference"
} as const;

const DAY_MS = 86_400_000;

export function parsePeriod(value: unknown): Period {
  const v = Array.isArray(value) ? value[0] : value;
  return v === "90" || v === "30" ? v : "all";
}

/** Signed up on or after `now - N days` (inclusive). "all" accepts everything. */
export function inPeriod(createdAtIso: string, period: Period, now: Date): boolean {
  if (period === "all") return true;
  const created = Date.parse(createdAtIso);
  if (!Number.isFinite(created)) return false;
  const days = period === "90" ? 90 : 30;
  return created >= now.getTime() - days * DAY_MS;
}

/** Math.round(part / whole * 100); null when whole is 0. */
export function pct(part: number, whole: number): number | null {
  if (!Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

const BASES: Record<Exclude<ActivationStepKey, "signed_up">, ActivationStepKey> = {
  verified: "signed_up",
  connected: "verified",
  first_active_form: "connected",
  first_lead: "first_active_form",
  first_booking: "first_lead",
  upgraded: "verified"
};

const ORDER: ActivationStepKey[] = ["signed_up", "verified", "connected", "first_active_form", "first_lead", "first_booking", "upgraded"];

export function activationFunnel(
  rows: ActivationRow[],
  pendingSignupDates: string[],
  period: Period,
  now: Date
): { steps: ActivationStep[]; excludedLegacy: number } {
  const inRange = rows.filter((row) => inPeriod(row.createdAt, period, now));
  const kept = inRange.filter((row) => row.signupSource !== "legacy");
  const excludedLegacy = inRange.length - kept.length;
  const pending = pendingSignupDates.filter((date) => inPeriod(date, period, now)).length;

  const counts: Record<ActivationStepKey, number> = {
    signed_up: kept.length + pending,
    verified: kept.length,
    connected: kept.filter((row) => Boolean(row.firstConnectionAt)).length,
    first_active_form: kept.filter((row) => Boolean(row.firstFormActivatedAt)).length,
    first_lead: kept.filter((row) => Boolean(row.firstLeadAt)).length,
    first_booking: kept.filter((row) => Boolean(row.firstBookingAt)).length,
    upgraded: kept.filter((row) => row.everScaling).length
  };

  const steps = ORDER.map((key): ActivationStep => {
    if (key === "signed_up") {
      return {
        key,
        label: ACTIVATION_COPY.steps.signed_up,
        count: counts.signed_up,
        pctOfSignups: counts.signed_up > 0 ? 100 : null,
        pctOfBase: null,
        baseLabel: null
      };
    }
    const base = BASES[key];
    return {
      key,
      label: ACTIVATION_COPY.steps[key],
      count: counts[key],
      pctOfSignups: pct(counts[key], counts.signed_up),
      pctOfBase: pct(counts[key], counts[base]),
      baseLabel: ACTIVATION_COPY.steps[base]
    };
  });

  return { steps, excludedLegacy };
}

export type ClientStage = "verified" | "connected" | "form_live" | "first_lead" | "first_booking";

/** Furthest milestone reached, checked from first booking down. */
export function clientStage(
  row: Pick<ActivationRow, "firstConnectionAt" | "firstFormActivatedAt" | "firstLeadAt" | "firstBookingAt">
): ClientStage {
  if (row.firstBookingAt) return "first_booking";
  if (row.firstLeadAt) return "first_lead";
  if (row.firstFormActivatedAt) return "form_live";
  if (row.firstConnectionAt) return "connected";
  return "verified";
}

/** "{n}%" or "None yet". */
export function formatPct(value: number | null): string {
  return value === null ? ACTIVATION_COPY.none : `${value}%`;
}

/** Effect column of the plan history table: non-zero parts only, "-" when all are zero. */
export function planHistoryEffect(row: {
  frozenForms: number;
  frozenPixels: number;
  restoredForms: number;
  restoredPixels: number;
  endedSplitTests: number;
}): string {
  const parts = [
    row.frozenForms > 0 ? `${row.frozenForms} ${row.frozenForms === 1 ? "form" : "forms"} frozen` : null,
    row.frozenPixels > 0 ? `${row.frozenPixels} ${row.frozenPixels === 1 ? "pixel" : "pixels"} frozen` : null,
    row.restoredForms > 0 ? `${row.restoredForms} ${row.restoredForms === 1 ? "form" : "forms"} restored` : null,
    row.restoredPixels > 0 ? `${row.restoredPixels} ${row.restoredPixels === 1 ? "pixel" : "pixels"} restored` : null,
    row.endedSplitTests > 0 ? `${row.endedSplitTests} ${row.endedSplitTests === 1 ? "split test" : "split tests"} ended` : null
  ].filter((part): part is string => part !== null);
  return parts.length ? parts.join(", ") : "-";
}

/** Normalises one owner_activation_rows result. */
export function toActivationRow(row: {
  tenant_id: string;
  signup_source: string;
  plan: string;
  created_at: string;
  first_connection_at: string | null;
  first_form_activated_at: string | null;
  first_lead_at: string | null;
  first_booking_at: string | null;
  ever_scaling: boolean | null;
}): ActivationRow {
  const source = row.signup_source === "provisioned" || row.signup_source === "self_serve" ? row.signup_source : "legacy";
  const plan: PlanState = row.plan === "scaling" || row.plan === "suspended" ? row.plan : "free";
  return {
    tenantId: row.tenant_id,
    signupSource: source,
    plan,
    createdAt: row.created_at,
    firstConnectionAt: row.first_connection_at ?? null,
    firstFormActivatedAt: row.first_form_activated_at ?? null,
    firstLeadAt: row.first_lead_at ?? null,
    firstBookingAt: row.first_booking_at ?? null,
    everScaling: row.ever_scaling === true
  };
}
