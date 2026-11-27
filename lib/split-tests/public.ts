import { unstable_noStore as noStore } from "next/cache";
import { parsePlanState } from "@/lib/billing/plans";
import { getBookingFunnelById, type BookingFunnel } from "@/lib/funnels/service";
import { getClientIp } from "@/lib/security/client-ip";
import { getIpHashSalt } from "@/lib/security/rate-limit";
import {
  chooseArm,
  fallbackVisitorKey,
  isValidVisitorKey,
  type ArmCandidate,
  type SplitTestStatus
} from "@/lib/split-tests/assignment";
import { parseSplitTestStatus } from "@/lib/split-tests/rules";
import { createServiceClient } from "@/lib/supabase/server";

export type PublicSplitResolution =
  | { kind: "not_found" }
  | { kind: "need_visitor" }
  | { kind: "form"; funnel: BookingFunnel; testId: string | null; visitorId: string | null };

type VisitorKeyChoice = { kind: "need_visitor" } | { kind: "key"; key: string; visitorId: string | null };

/**
 * Decision S3: the cookie id, else the id the resolver passed in `fb_vid`,
 * else (the resolver ran but storage was blocked) a deterministic key from the
 * client IP and user agent, else ask the browser for its id.
 */
export function pickVisitorKey(input: {
  cookieVisitorId: string | undefined;
  queryVisitorId: string | undefined;
  headers: Headers;
}): VisitorKeyChoice {
  if (isValidVisitorKey(input.cookieVisitorId)) {
    return { kind: "key", key: input.cookieVisitorId, visitorId: input.cookieVisitorId };
  }
  if (isValidVisitorKey(input.queryVisitorId)) {
    return { kind: "key", key: input.queryVisitorId, visitorId: input.queryVisitorId };
  }
  if (input.queryVisitorId !== undefined) {
    const key = fallbackVisitorKey(
      getClientIp(input.headers),
      input.headers.get("user-agent") ?? "",
      getIpHashSalt()
    );
    return { kind: "key", key, visitorId: null };
  }
  return { kind: "need_visitor" };
}

/**
 * Loads a live (running or ended) test by its address, picks the visitor's
 * form and loads it with the same public rules as /book. Never shows a draft
 * test or a test of a suspended tenant.
 */
export async function resolvePublicSplitTest(input: {
  slug: string;
  cookieVisitorId: string | undefined;
  queryVisitorId: string | undefined;
  headers: Headers;
}): Promise<PublicSplitResolution> {
  noStore();
  const slug = input.slug.trim().toLowerCase();
  if (!slug || slug.length > 80) return { kind: "not_found" };

  const supabase = createServiceClient();
  const { data: test, error } = await supabase
    .from("split_tests")
    .select("id,tenant_id,status,winner_funnel_id")
    .eq("slug", slug)
    .neq("status", "draft")
    .maybeSingle();

  if (error) {
    console.error("[split-tests] public test lookup failed", error.message);
    return { kind: "not_found" };
  }
  if (!test) return { kind: "not_found" };

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("plan")
    .eq("id", test.tenant_id)
    .maybeSingle();
  if (tenantError || !tenant || parsePlanState(tenant.plan) === "suspended") {
    if (tenantError) console.error("[split-tests] tenant lookup failed", tenantError.message);
    return { kind: "not_found" };
  }

  const { data: memberRows, error: membersError } = await supabase
    .from("split_test_members")
    .select("funnel_id,position")
    .eq("test_id", test.id)
    .eq("tenant_id", test.tenant_id)
    .order("position", { ascending: true });
  if (membersError) {
    console.error("[split-tests] member lookup failed", membersError.message);
    return { kind: "not_found" };
  }
  if (!memberRows?.length) return { kind: "not_found" };

  const { data: funnelRows, error: funnelsError } = await supabase
    .from("funnels")
    .select("id,is_published,taken_down_at")
    .eq("tenant_id", test.tenant_id)
    .in(
      "id",
      memberRows.map((member) => member.funnel_id)
    );
  if (funnelsError) {
    console.error("[split-tests] form lookup failed", funnelsError.message);
    return { kind: "not_found" };
  }

  const funnelsById = new Map((funnelRows ?? []).map((funnel) => [funnel.id, funnel]));
  const candidates: ArmCandidate[] = memberRows.map((member) => {
    const funnel = funnelsById.get(member.funnel_id);
    return {
      funnelId: member.funnel_id,
      position: member.position,
      available: Boolean(funnel && funnel.is_published && !funnel.taken_down_at)
    };
  });
  if (!candidates.some((candidate) => candidate.available)) return { kind: "not_found" };

  const visitor = pickVisitorKey(input);
  if (visitor.kind === "need_visitor") return visitor;

  const status: SplitTestStatus = parseSplitTestStatus(test.status);
  const choice = chooseArm(
    { id: test.id, status, winnerFunnelId: test.winner_funnel_id },
    candidates,
    visitor.key
  );
  if (!choice) return { kind: "not_found" };

  const funnel = await getBookingFunnelById(choice.funnelId);
  if (!funnel || funnel.tenant_id !== test.tenant_id) return { kind: "not_found" };

  return {
    kind: "form",
    funnel,
    testId: choice.recorded ? test.id : null,
    visitorId: visitor.visitorId
  };
}

/**
 * Decision S9: the test id to record on an analytics row or lead session.
 * Returns it only when the test is running, belongs to the tenant and the form
 * is a member; otherwise null. Never throws, so a bad or forged id can never
 * fail a public request.
 */
export async function resolveRecordedSplitTestId(
  testId: string | undefined | null,
  funnelId: string,
  tenantId: string
): Promise<string | null> {
  if (!testId) return null;
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("split_test_members")
      .select("test_id, split_tests!inner(status)")
      .eq("test_id", testId)
      .eq("funnel_id", funnelId)
      .eq("tenant_id", tenantId)
      .eq("split_tests.status", "running")
      .maybeSingle();
    if (error) {
      console.error("[split-tests] recording check failed", error.message);
      return null;
    }
    return data ? testId : null;
  } catch (error) {
    console.error("[split-tests] recording check failed", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}
