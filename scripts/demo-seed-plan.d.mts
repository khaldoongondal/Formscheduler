export type SeedCounts = {
  visitors: number;
  form_starts: number;
  leads: number;
  bookings: number;
  spend_cents: number;
};

export type SeedConfig = {
  source?: string;
  scale?: number;
  scale_rule?: string;
  owner_adjustment?: string;
  label: string;
  expected_totals: SeedCounts;
  forms: Array<{ key: string; name: string; slug_suffix: string }>;
  periods: Array<
    SeedCounts & {
      form: string;
      split_test?: string | null;
      start: string;
      end: string;
      cost_per_lead_cents?: number | null;
    }
  >;
  split_tests?: Array<{
    key: string;
    name: string;
    slug_suffix: string;
    status: "running" | "ended";
    started_at: string;
    ended_at?: string;
    forms: string[];
  }>;
  stage_rules?: Record<string, unknown>;
};

export type SeedQuestion = {
  id: string;
  stableKey: string;
  label: string;
  displayOrder: number;
  options: Array<{ id: string; stableKey: string; label: string; value: string; displayOrder: number }>;
};

export type SeedStepKeys = { page1: string; page2: string; contact: string; slots: string };

export type SeedPlan = {
  tenantId: string;
  batch: string;
  label: string;
  forms: Array<{ key: string; id: string; name: string; slug: string; questions: SeedQuestion[]; stepKeys: SeedStepKeys }>;
  splitTests: Array<{
    key: string;
    id: string;
    name: string;
    slug: string;
    status: "running" | "ended";
    startedAt: string;
    endedAt: string | null;
  }>;
  members: Array<{ testId: string; funnelId: string; position: number }>;
  spend: Array<{
    id: string;
    funnelId: string;
    splitTestId: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    amountCents: number;
  }>;
  visitorBatches: Array<{
    key: string;
    funnelId: string;
    formKey: string;
    splitTestId: string | null;
    start: string;
    end: string;
    visitors: number;
    formStarts: number;
    leads: number;
    bookings: number;
    leadOffset: number;
    stepKeys: SeedStepKeys;
  }>;
};

export declare const BATCH_PATTERN: RegExp;
export declare function validateSeedConfig(config: unknown): true;
export declare function deterministicUuid(batch: string, key: string): string;
export declare function scaleSourceRow(
  row: SeedCounts & { cost_per_lead_cents?: number | null },
  scale: number
): SeedCounts;
export declare function splitByLargestRemainder(total: number, weights: number[]): number[];
export declare function buildSeedPlan(config: unknown, options: { tenantId: string; batch: string }): SeedPlan;
export declare function renderSeedSql(plan: SeedPlan): string;
export declare function renderRemovalSql(batch: string): string;
