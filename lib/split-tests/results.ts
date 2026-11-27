/**
 * Pure split test results: per-form and total numbers, the Wilson interval,
 * the rule that calls a leader, and cost maths. No Next or Supabase imports.
 */
import {
  EMPTY_STAGE_COUNTS,
  addStageCounts,
  computeStageRates,
  type FunnelDropOffStepRow,
  type StageCounts,
  type StageRates
} from "@/lib/analytics/funnel-math";

export const MIN_LEADS_PER_FORM = 30;
export const WILSON_Z = 1.96;

/** 95% Wilson score interval for successes / trials, clamped to [0, 1]. Null when trials = 0. */
export function wilsonInterval(
  successes: number,
  trials: number,
  z: number = WILSON_Z
): { low: number; high: number } | null {
  if (!(trials > 0)) return null;
  const p = Math.min(Math.max(successes / trials, 0), 1);
  const z2 = z * z;
  const denominator = 1 + z2 / trials;
  const centre = (p + z2 / (2 * trials)) / denominator;
  const margin = (z * Math.sqrt((p * (1 - p)) / trials + z2 / (4 * trials * trials))) / denominator;
  return {
    low: Math.max(0, centre - margin),
    high: Math.min(1, centre + margin)
  };
}

export type ArmCost = {
  spendCents: number | null;
  currency: string | null;
  costPerLeadCents: number | null;
  costPerBookingCents: number | null;
  /** Leads and bookings over the whole test period, which the cost figures use. */
  fullPeriodLeads: number;
  fullPeriodBookings: number;
};

export type ArmResult = {
  funnelId: string;
  label: "A" | "B" | "C";
  name: string;
  counts: StageCounts;
  rates: StageRates;
  leadToBookingInterval: { low: number; high: number } | null;
  dropOff: FunnelDropOffStepRow[];
  cost: ArmCost;
};

/** Cost per lead and per booked call from spend over the whole test and full-period counts. */
export function costFor(
  spend: { amountCents: number; currency: string } | null,
  fullPeriod: { leads: number; bookings: number }
): ArmCost {
  if (!spend) {
    return {
      spendCents: null,
      currency: null,
      costPerLeadCents: null,
      costPerBookingCents: null,
      fullPeriodLeads: fullPeriod.leads,
      fullPeriodBookings: fullPeriod.bookings
    };
  }
  return {
    spendCents: spend.amountCents,
    currency: spend.currency,
    costPerLeadCents: fullPeriod.leads > 0 ? Math.round(spend.amountCents / fullPeriod.leads) : null,
    costPerBookingCents: fullPeriod.bookings > 0 ? Math.round(spend.amountCents / fullPeriod.bookings) : null,
    fullPeriodLeads: fullPeriod.leads,
    fullPeriodBookings: fullPeriod.bookings
  };
}

export type SplitCall =
  | { state: "too_early"; shortfalls: Array<{ funnelId: string; name: string; leadsNeeded: number }> }
  | { state: "no_clear_leader" }
  | { state: "leader"; funnelId: string; name: string };

/**
 * Too early until every form has at least 30 leads. Then the form with the
 * highest lead-to-booking rate leads only when the low end of its Wilson
 * interval is above the high end of every other form's interval.
 */
export function callSplitTest(
  arms: Array<{ funnelId: string; name: string; leads: number; bookings: number }>
): SplitCall {
  const shortfalls = arms
    .filter((arm) => arm.leads < MIN_LEADS_PER_FORM)
    .map((arm) => ({ funnelId: arm.funnelId, name: arm.name, leadsNeeded: MIN_LEADS_PER_FORM - arm.leads }));
  if (shortfalls.length || arms.length < 2) {
    return { state: "too_early", shortfalls };
  }

  const scored = arms.map((arm) => ({
    ...arm,
    rate: arm.bookings / arm.leads,
    interval: wilsonInterval(arm.bookings, arm.leads)!
  }));
  const topRate = Math.max(...scored.map((arm) => arm.rate));
  const top = scored.filter((arm) => arm.rate === topRate);
  if (top.length !== 1) return { state: "no_clear_leader" };

  const leader = top[0];
  const clear = scored
    .filter((arm) => arm.funnelId !== leader.funnelId)
    .every((arm) => leader.interval.low > arm.interval.high);
  return clear ? { state: "leader", funnelId: leader.funnelId, name: leader.name } : { state: "no_clear_leader" };
}

export const SPLIT_CALL_RULE =
  "How we call it: every form needs at least 30 leads, and the top form's 95% range for lead-to-booking rate (Wilson method) must sit fully above the range of every other form.";

export function splitCallMessage(call: SplitCall): string {
  if (call.state === "too_early") {
    if (!call.shortfalls.length) return "Too early to call.";
    const needed = call.shortfalls
      .map((shortfall) => `${shortfall.name} ${shortfall.leadsNeeded} more ${shortfall.leadsNeeded === 1 ? "lead" : "leads"}`)
      .join(", ");
    return `Too early to call. Still needed: ${needed}.`;
  }
  if (call.state === "no_clear_leader") {
    return "No clear leader yet. The likely ranges for lead-to-booking rate still overlap, so the difference could be chance. Keep the test running.";
  }
  return `${call.name} is ahead on lead-to-booking rate, and its likely range does not overlap with the other forms.`;
}

export type SplitTotals = {
  counts: StageCounts;
  rates: StageRates;
  /** Sum of entered spend; null when none is entered or currencies are mixed. */
  spendCents: number | null;
  /** The shared currency, "mixed", or null when no spend is entered. */
  currency: string | null;
  costPerLeadCents: number | null;
  costPerBookingCents: number | null;
  /** True when every form has spend entered (total cost is only shown then). */
  spendComplete: boolean;
};

/**
 * Totals across forms. A visitor belongs to one form, so sums are exact.
 * Total cost uses full-period counts and needs spend on every form in one currency.
 */
export function totalsOf(arms: ArmResult[]): SplitTotals {
  const counts = arms.reduce((sum, arm) => addStageCounts(sum, arm.counts), { ...EMPTY_STAGE_COUNTS });
  const rates = computeStageRates(counts);
  const withSpend = arms.filter((arm) => arm.cost.spendCents !== null && arm.cost.currency);
  const currencies = new Set(withSpend.map((arm) => arm.cost.currency as string));
  const spendComplete = arms.length > 0 && withSpend.length === arms.length;

  if (!withSpend.length) {
    return { counts, rates, spendCents: null, currency: null, costPerLeadCents: null, costPerBookingCents: null, spendComplete };
  }
  if (currencies.size > 1) {
    return { counts, rates, spendCents: null, currency: "mixed", costPerLeadCents: null, costPerBookingCents: null, spendComplete };
  }

  const spendCents = withSpend.reduce((sum, arm) => sum + (arm.cost.spendCents ?? 0), 0);
  const fullLeads = arms.reduce((sum, arm) => sum + arm.cost.fullPeriodLeads, 0);
  const fullBookings = arms.reduce((sum, arm) => sum + arm.cost.fullPeriodBookings, 0);
  return {
    counts,
    rates,
    spendCents,
    currency: [...currencies][0],
    costPerLeadCents: spendComplete && fullLeads > 0 ? Math.round(spendCents / fullLeads) : null,
    costPerBookingCents: spendComplete && fullBookings > 0 ? Math.round(spendCents / fullBookings) : null,
    spendComplete
  };
}
