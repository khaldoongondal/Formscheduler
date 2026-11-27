import { unstable_noStore as noStore } from "next/cache";
import { ZodError } from "zod";
import { planLimitMessageForTenant } from "@/lib/billing/plan-service";
import { checkSlug } from "@/lib/funnels/slugs";
import {
  SPLIT_TEST_MESSAGES,
  type FunnelTestUse,
  formNotActiveMessage,
  parseSplitTestStatus,
  splitTestFormIds,
  splitTestFormSchema,
  splitTestMessageFromError,
  splitTestNameSchema
} from "@/lib/split-tests/rules";
import { createServiceClient } from "@/lib/supabase/server";
import type { Database, SplitTest } from "@/lib/types/database";

export type SplitTestRow = Database["public"]["Tables"]["split_tests"]["Row"];

export type SplitTestMemberView = {
  funnelId: string;
  position: number;
  name: string;
  slug: string;
  isPublished: boolean;
  takenDown: boolean;
};

export type SplitTestWithMembers = SplitTest & { members: SplitTestMemberView[] };

const GENERIC_MESSAGE = "Something went wrong. Please try again.";
const TEST_COLUMNS = "id,tenant_id,name,slug,status,winner_funnel_id,started_at,ended_at,created_at,updated_at";

/** Turns any thrown value into a user message (Zod, trigger errors, plan limits, else generic). */
async function friendlyError(error: unknown, tenantId: string): Promise<Error> {
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    const message =
      Object.values(flattened.fieldErrors).flat().find(Boolean) ?? flattened.formErrors.find(Boolean);
    return new Error(message ?? "Please check the form and try again.");
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const split = splitTestMessageFromError(message);
  if (split) return new Error(split);
  const limit = await planLimitMessageForTenant(message, tenantId);
  if (limit) return new Error(limit);
  console.error("[split-tests] unexpected error", message);
  return new Error(GENERIC_MESSAGE);
}

class UserFacingError extends Error {}

async function run<T>(tenantId: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UserFacingError) throw new Error(error.message);
    throw await friendlyError(error, tenantId);
  }
}

function toSplitTest(row: SplitTestRow): SplitTest {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    slug: row.slug,
    status: parseSplitTestStatus(row.status),
    winner_funnel_id: row.winner_funnel_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function attachMembers(tenantId: string, tests: SplitTest[]): Promise<SplitTestWithMembers[]> {
  if (!tests.length) return [];
  const supabase = createServiceClient();
  const { data: memberRows, error: membersError } = await supabase
    .from("split_test_members")
    .select("test_id,funnel_id,position")
    .eq("tenant_id", tenantId)
    .in(
      "test_id",
      tests.map((test) => test.id)
    )
    .order("position", { ascending: true });
  if (membersError) throw new Error(membersError.message);

  const funnelIds = [...new Set((memberRows ?? []).map((member) => member.funnel_id))];
  const funnelsById = new Map<string, { name: string; slug: string; is_published: boolean; taken_down_at: string | null }>();
  if (funnelIds.length) {
    const { data: funnels, error: funnelsError } = await supabase
      .from("funnels")
      .select("id,name,slug,is_published,taken_down_at")
      .eq("tenant_id", tenantId)
      .in("id", funnelIds);
    if (funnelsError) throw new Error(funnelsError.message);
    for (const funnel of funnels ?? []) funnelsById.set(funnel.id, funnel);
  }

  return tests.map((test) => ({
    ...test,
    members: (memberRows ?? [])
      .filter((member) => member.test_id === test.id)
      .flatMap((member) => {
        const funnel = funnelsById.get(member.funnel_id);
        if (!funnel) return [];
        return [
          {
            funnelId: member.funnel_id,
            position: member.position,
            name: funnel.name,
            slug: funnel.slug,
            isPublished: funnel.is_published,
            takenDown: Boolean(funnel.taken_down_at)
          }
        ];
      })
  }));
}

export async function listSplitTests(tenantId: string): Promise<SplitTestWithMembers[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("split_tests")
    .select(TEST_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return attachMembers(tenantId, (data ?? []).map((row) => toSplitTest(row as SplitTestRow)));
}

export async function getSplitTest(tenantId: string, testId: string): Promise<SplitTestWithMembers | null> {
  noStore();
  if (!isUuid(testId)) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("split_tests")
    .select(TEST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", testId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [test] = await attachMembers(tenantId, [toSplitTest(data as SplitTestRow)]);
  return test ?? null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** The test row, only when it belongs to the tenant. Throws "Not found." otherwise. */
async function requireOwnedTest(tenantId: string, testId: string): Promise<SplitTest> {
  if (!isUuid(testId)) throw new UserFacingError(SPLIT_TEST_MESSAGES.not_found);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("split_tests")
    .select(TEST_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", testId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError(SPLIT_TEST_MESSAGES.not_found);
  return toSplitTest(data as SplitTestRow);
}

/** Every chosen form must belong to the tenant (one query, count must match). */
async function assertFormsOwned(tenantId: string, funnelIds: string[]) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", funnelIds);
  if (error) throw new Error(error.message);
  if ((data ?? []).length !== funnelIds.length) {
    throw new UserFacingError(SPLIT_TEST_MESSAGES.wrong_tenant);
  }
}

function parseTestInput(input: unknown) {
  const parsed = splitTestFormSchema.parse(input);
  const slugCheck = checkSlug(parsed.slug);
  if (!slugCheck.ok) throw new UserFacingError(slugCheck.message);
  return { name: parsed.name, slug: slugCheck.slug, funnelIds: splitTestFormIds(parsed) };
}

/**
 * Swaps a draft test's forms in one database transaction: the function locks
 * the test row, refuses unless it is still a draft, then deletes and inserts.
 */
async function replaceMembers(tenantId: string, testId: string, funnelIds: string[]) {
  const supabase = createServiceClient();
  const { error } = await supabase.rpc("split_test_replace_members", {
    p_tenant_id: tenantId,
    p_test_id: testId,
    p_funnel_ids: funnelIds
  });
  if (error) throw new Error(error.message);
}

/** Creates a draft test with its forms. Returns the new id. */
export async function createSplitTest(tenantId: string, input: unknown): Promise<string> {
  return run(tenantId, async () => {
    const parsed = parseTestInput(input);
    await assertFormsOwned(tenantId, parsed.funnelIds);
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("split_tests")
      .insert({ tenant_id: tenantId, name: parsed.name, slug: parsed.slug, status: "draft" })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    try {
      await replaceMembers(tenantId, data.id, parsed.funnelIds);
    } catch (memberError) {
      // Do not leave a half-made test behind.
      await supabase.from("split_tests").delete().eq("tenant_id", tenantId).eq("id", data.id);
      throw memberError;
    }
    return data.id as string;
  });
}

/** Name, address and forms of a draft test. */
export async function updateSplitTestDraft(tenantId: string, testId: string, input: unknown): Promise<void> {
  return run(tenantId, async () => {
    const test = await requireOwnedTest(tenantId, testId);
    if (test.status !== "draft") throw new UserFacingError(SPLIT_TEST_MESSAGES.locked);
    const parsed = parseTestInput(input);
    await assertFormsOwned(tenantId, parsed.funnelIds);
    const supabase = createServiceClient();
    // Fails closed: a test that started since the check above is not touched.
    const { data: updated, error } = await supabase
      .from("split_tests")
      .update({ name: parsed.name, slug: parsed.slug })
      .eq("tenant_id", tenantId)
      .eq("id", testId)
      .eq("status", "draft")
      .select("id");
    if (error) throw new Error(error.message);
    if (!updated?.length) throw new UserFacingError(SPLIT_TEST_MESSAGES.locked);
    await replaceMembers(tenantId, testId, parsed.funnelIds);
  });
}

/** The name can change in any state. */
export async function renameSplitTest(tenantId: string, testId: string, name: unknown): Promise<void> {
  return run(tenantId, async () => {
    await requireOwnedTest(tenantId, testId);
    const parsedName = splitTestNameSchema.parse(name);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("split_tests")
      .update({ name: parsedName })
      .eq("tenant_id", tenantId)
      .eq("id", testId);
    if (error) throw new Error(error.message);
  });
}

export async function startSplitTest(tenantId: string, testId: string): Promise<void> {
  return run(tenantId, async () => {
    const test = await getSplitTest(tenantId, testId);
    if (!test) throw new UserFacingError(SPLIT_TEST_MESSAGES.not_found);
    if (test.status !== "draft") throw new UserFacingError(SPLIT_TEST_MESSAGES.bad_transition);

    const inactive = test.members.filter((member) => !member.isPublished || member.takenDown);
    if (inactive.length) {
      throw new UserFacingError(formNotActiveMessage(inactive.map((member) => member.name)));
    }

    // The trigger is the authority: member count, active forms, one running test per form.
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("split_tests")
      .update({ status: "running" })
      .eq("tenant_id", tenantId)
      .eq("id", testId);
    if (error) throw new Error(error.message);
  });
}

async function assertWinnerIsMember(tenantId: string, testId: string, winnerFunnelId: string | null) {
  if (!winnerFunnelId) return;
  if (!isUuid(winnerFunnelId)) throw new UserFacingError(SPLIT_TEST_MESSAGES.winner_not_member);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("split_test_members")
    .select("funnel_id")
    .eq("tenant_id", tenantId)
    .eq("test_id", testId)
    .eq("funnel_id", winnerFunnelId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new UserFacingError(SPLIT_TEST_MESSAGES.winner_not_member);
}

/** Ends a running test, optionally naming the winner that the link then serves. */
export async function endSplitTest(tenantId: string, testId: string, winnerFunnelId: string | null): Promise<void> {
  return run(tenantId, async () => {
    const test = await requireOwnedTest(tenantId, testId);
    if (test.status !== "running") throw new UserFacingError(SPLIT_TEST_MESSAGES.bad_transition);
    await assertWinnerIsMember(tenantId, testId, winnerFunnelId);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("split_tests")
      .update({ status: "ended", winner_funnel_id: winnerFunnelId })
      .eq("tenant_id", tenantId)
      .eq("id", testId);
    if (error) throw new Error(error.message);
  });
}

/** Changes (or clears) the winner of an ended test. */
export async function setSplitTestWinner(
  tenantId: string,
  testId: string,
  winnerFunnelId: string | null
): Promise<void> {
  return run(tenantId, async () => {
    const test = await requireOwnedTest(tenantId, testId);
    if (test.status !== "ended") throw new UserFacingError(SPLIT_TEST_MESSAGES.bad_transition);
    await assertWinnerIsMember(tenantId, testId, winnerFunnelId);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("split_tests")
      .update({ winner_funnel_id: winnerFunnelId })
      .eq("tenant_id", tenantId)
      .eq("id", testId);
    if (error) throw new Error(error.message);
  });
}

/** Draft or ended tests only. Analytics rows keep their data (split_test_id becomes null). */
export async function deleteSplitTest(tenantId: string, testId: string): Promise<void> {
  return run(tenantId, async () => {
    const test = await requireOwnedTest(tenantId, testId);
    if (test.status === "running") throw new UserFacingError(SPLIT_TEST_MESSAGES.delete_running);
    const supabase = createServiceClient();
    const { error } = await supabase
      .from("split_tests")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", testId)
      .neq("status", "running");
    if (error) throw new Error(error.message);
  });
}

/**
 * Running test (if any) per form id, for badges in the form list and editor.
 * Returns an empty map when the lookup fails (for example before migration
 * 0025), so form pages keep working.
 */
export async function getRunningTestsByFunnel(tenantId: string): Promise<Map<string, { id: string; name: string }>> {
  noStore();
  const result = new Map<string, { id: string; name: string }>();
  try {
    const supabase = createServiceClient();
    const { data: tests, error } = await supabase
      .from("split_tests")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .eq("status", "running");
    if (error) throw new Error(error.message);
    if (!tests?.length) return result;

    const namesById = new Map(tests.map((test) => [test.id, test.name]));
    const { data: members, error: membersError } = await supabase
      .from("split_test_members")
      .select("test_id,funnel_id")
      .eq("tenant_id", tenantId)
      .in("test_id", [...namesById.keys()]);
    if (membersError) throw new Error(membersError.message);
    for (const member of members ?? []) {
      result.set(member.funnel_id, { id: member.test_id, name: namesById.get(member.test_id) ?? "" });
    }
  } catch (error) {
    console.error("[split-tests] running test lookup failed", error instanceof Error ? error.message : "unknown error");
  }
  return result;
}

/**
 * Every split test of the tenant that uses this form, for the delete check.
 * Unlike getRunningTestsByFunnel this throws when the lookup fails, so a
 * failed read never lets a form in a running test be deleted. Returns an
 * empty list only when the split test tables do not exist yet (before 0025).
 */
export async function listSplitTestsUsingFunnel(tenantId: string, funnelId: string): Promise<FunnelTestUse[]> {
  noStore();
  const supabase = createServiceClient();
  const { data: members, error: membersError } = await supabase
    .from("split_test_members")
    .select("test_id")
    .eq("tenant_id", tenantId)
    .eq("funnel_id", funnelId);
  if (membersError) {
    if (membersError.code === "42P01" || membersError.code === "PGRST205") return [];
    throw new Error(membersError.message);
  }
  const testIds = [...new Set((members ?? []).map((member) => member.test_id))];
  if (!testIds.length) return [];
  const { data: tests, error } = await supabase
    .from("split_tests")
    .select("id,name,status")
    .eq("tenant_id", tenantId)
    .in("id", testIds);
  if (error) throw new Error(error.message);
  return (tests ?? []).map((test) => ({ name: test.name, status: parseSplitTestStatus(test.status) }));
}
