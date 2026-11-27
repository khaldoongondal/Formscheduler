import { unstable_noStore as noStore } from "next/cache";
import {
  SPEND_MESSAGES,
  firstZodMessage,
  spendEntrySchema,
  spendMessageFromError,
  testSpendSchema
} from "@/lib/spend/money";
import { createServiceClient } from "@/lib/supabase/server";
import type { AdSpendEntry } from "@/lib/types/database";

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
const NOT_FOUND = "Not found.";
const ENTRY_COLUMNS =
  "id,tenant_id,funnel_id,split_test_id,period_start,period_end,amount_cents,currency,note,created_at,updated_at";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class UserFacingError extends Error {}

/** Runs work and turns every failure into a message that is safe to show. */
async function run<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UserFacingError) throw new Error(error.message);
    const zodMessage = firstZodMessage(error);
    if (zodMessage) throw new Error(zodMessage);
    const message = error instanceof Error ? error.message : String(error ?? "");
    const scope = spendMessageFromError(message);
    if (scope) throw new Error(scope);
    console.error("[spend] unexpected error", message);
    throw new Error(GENERIC_MESSAGE);
  }
}

function assertUuid(value: string, message: string = NOT_FOUND) {
  if (!UUID_PATTERN.test(value)) throw new UserFacingError(message);
}

async function assertFormOwned(tenantId: string, funnelId: string) {
  assertUuid(funnelId, SPEND_MESSAGES.wrongForm);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", funnelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError(SPEND_MESSAGES.wrongForm);
}

/** The test belongs to the tenant and the form is one of its members. */
async function assertTestMember(tenantId: string, testId: string, funnelId: string) {
  assertUuid(testId);
  assertUuid(funnelId, SPEND_MESSAGES.wrongForm);
  const supabase = createServiceClient();
  const { data: test, error: testError } = await supabase
    .from("split_tests")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", testId)
    .maybeSingle();
  if (testError) throw new Error(testError.message);
  if (!test) throw new UserFacingError(NOT_FOUND);

  const { data: member, error: memberError } = await supabase
    .from("split_test_members")
    .select("funnel_id")
    .eq("tenant_id", tenantId)
    .eq("test_id", testId)
    .eq("funnel_id", funnelId)
    .maybeSingle();
  if (memberError) throw new Error(memberError.message);
  if (!member) throw new UserFacingError(SPEND_MESSAGES.wrongForm);
}

/** Saves the spend for one form of a split test (one entry per test and form). */
export async function upsertTestSpend(
  tenantId: string,
  testId: string,
  funnelId: string,
  input: { amount: string; currency: string; note?: string }
): Promise<void> {
  return run(async () => {
    await assertTestMember(tenantId, testId, funnelId);
    const parsed = testSpendSchema.parse(input);
    const supabase = createServiceClient();
    const { data: existing, error: findError } = await supabase
      .from("ad_spend_entries")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("split_test_id", testId)
      .eq("funnel_id", funnelId)
      .maybeSingle();
    if (findError) throw new Error(findError.message);

    const values = { amount_cents: parsed.amount, currency: parsed.currency, note: parsed.note };
    if (existing) {
      const { error } = await supabase
        .from("ad_spend_entries")
        .update(values)
        .eq("tenant_id", tenantId)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      return;
    }

    const { error } = await supabase.from("ad_spend_entries").insert({
      ...values,
      tenant_id: tenantId,
      funnel_id: funnelId,
      split_test_id: testId
    });
    if (error) throw new Error(error.message);
  });
}

export async function clearTestSpend(tenantId: string, testId: string, funnelId: string): Promise<void> {
  return run(async () => {
    await assertTestMember(tenantId, testId, funnelId);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("ad_spend_entries")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("split_test_id", testId)
      .eq("funnel_id", funnelId);
    if (error) throw new Error(error.message);
  });
}

/** Spend entries of a split test, keyed by form id. */
export async function listTestSpend(tenantId: string, testId: string): Promise<Map<string, AdSpendEntry>> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ad_spend_entries")
    .select(ENTRY_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("split_test_id", testId);
  if (error) throw new Error(error.message);
  return new Map(((data ?? []) as AdSpendEntry[]).map((entry) => [entry.funnel_id, entry]));
}

/** Single-form spend entries (newest period first). */
export async function listFormSpend(tenantId: string, funnelId: string): Promise<AdSpendEntry[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ad_spend_entries")
    .select(ENTRY_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("funnel_id", funnelId)
    .is("split_test_id", null)
    .order("period_start", { ascending: false })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as AdSpendEntry[];
}

export async function addFormSpend(tenantId: string, funnelId: string, input: unknown): Promise<void> {
  return run(async () => {
    await assertFormOwned(tenantId, funnelId);
    const parsed = spendEntrySchema.parse(input);
    const supabase = createServiceClient();
    const { error } = await supabase.from("ad_spend_entries").insert({
      tenant_id: tenantId,
      funnel_id: funnelId,
      split_test_id: null,
      period_start: parsed.period_start,
      period_end: parsed.period_end,
      amount_cents: parsed.amount,
      currency: parsed.currency,
      note: parsed.note
    });
    if (error) throw new Error(error.message);
  });
}

/** Deletes one single-form entry of the tenant. */
export async function deleteFormSpend(tenantId: string, entryId: string): Promise<void> {
  return run(async () => {
    assertUuid(entryId);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("ad_spend_entries")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", entryId)
      .is("split_test_id", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserFacingError(NOT_FOUND);
  });
}
