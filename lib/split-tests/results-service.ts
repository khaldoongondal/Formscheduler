import { unstable_noStore as noStore } from "next/cache";
import {
  buildDropOffRows,
  computeStageCounts,
  computeStageRates,
  type HistoryRow,
  type SessionRow,
  type VisitorEventRow
} from "@/lib/analytics/funnel-math";
import { splitArmLabel } from "@/lib/split-tests/assignment";
import {
  callSplitTest,
  costFor,
  totalsOf,
  wilsonInterval,
  type ArmResult,
  type SplitCall
} from "@/lib/split-tests/results";
import { getSplitTest, type SplitTestWithMembers } from "@/lib/split-tests/service";
import { chunk, mapInBatches, selectAllByKeyset } from "@/lib/supabase/paging";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json, LeadSessionStatus, Question } from "@/lib/types/database";

const RESULT_STATUSES: LeadSessionStatus[] = ["potential", "qualified", "disqualified", "slots_shown", "booked"];
const SESSION_ID_CHUNK = 200;

type EventRow = VisitorEventRow & { occurred_at: string };
type TestSessionRow = SessionRow & { started_at: string | null };
type TestHistoryRow = HistoryRow & { created_at: string };

export type SplitTestResults = {
  test: SplitTestWithMembers;
  arms: ArmResult[];
  totals: ReturnType<typeof totalsOf>;
  /** The call uses every lead and booking since the test started. */
  call: SplitCall;
  fullPeriodLabel: string;
  /** True when the selected range covers the whole test period. */
  filteredMatchesFullPeriod: boolean;
  fullPeriod: { from: Date; to: Date };
};

/** Start and end of the period the test recorded rows (start to end, or to now while running). */
export function splitTestPeriod(test: { started_at: string | null; ended_at: string | null }, now = new Date()) {
  if (!test.started_at) return null;
  return { from: new Date(test.started_at), to: test.ended_at ? new Date(test.ended_at) : now };
}

function inRange(iso: string | null | undefined, range: { from: Date; to: Date }) {
  if (!iso) return false;
  const time = new Date(iso).getTime();
  return time >= range.from.getTime() && time <= range.to.getTime();
}

function formatDay(date: Date) {
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Results of one split test of the tenant: per form and in total, for the
 * selected range, with cost from full-period counts. Null when the test is not
 * the tenant's. Only rows recorded against the test while it ran are counted.
 */
export async function getSplitTestResults(
  tenantId: string,
  testId: string,
  range: { from: Date; to: Date }
): Promise<SplitTestResults | null> {
  noStore();
  const test = await getSplitTest(tenantId, testId);
  if (!test) return null;
  const period = splitTestPeriod(test);
  if (!period) return null;

  const supabase = createServiceClient();
  const members = [...test.members].sort((left, right) => left.position - right.position);
  const memberIds = new Set(members.map((member) => member.funnelId));
  const memberIdList = [...memberIds];

  const [events, sessions, questionsResult, funnelsResult, spendRows] = await Promise.all([
    selectAllByKeyset<EventRow>((afterId, limit) => {
      let query = supabase
        .from("analytics_events")
        .select("id,visitor_id,funnel_id,event_type,occurred_at,step_key:metadata->>step_key")
        .eq("tenant_id", tenantId)
        .eq("split_test_id", testId)
        .gte("occurred_at", period.from.toISOString())
        .lte("occurred_at", period.to.toISOString());
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(limit) as unknown as PromiseLike<{
        data: EventRow[] | null;
        error: { message: string } | null;
      }>;
    }),
    selectAllByKeyset<TestSessionRow>((afterId, limit) => {
      let query = supabase
        .from("lead_sessions")
        .select("id,visitor_id,funnel_id,started_at")
        .eq("tenant_id", tenantId)
        .eq("split_test_id", testId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(limit) as unknown as PromiseLike<{
        data: TestSessionRow[] | null;
        error: { message: string } | null;
      }>;
    }),
    memberIdList.length
      ? supabase
          .from("questions")
          .select("id,funnel_id,label,display_order")
          .eq("tenant_id", tenantId)
          .in("funnel_id", memberIdList)
          .order("display_order", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    memberIdList.length
      ? supabase.from("funnels").select("id,qualification_rule").eq("tenant_id", tenantId).in("id", memberIdList)
      : Promise.resolve({ data: [], error: null }),
    loadTestSpend(tenantId, testId)
  ]);
  if (questionsResult.error) throw new Error(questionsResult.error.message);
  if (funnelsResult.error) throw new Error(funnelsResult.error.message);

  const memberSessions = sessions.filter((session) => memberIds.has(session.funnel_id));
  const historyChunks = await mapInBatches(
    chunk(
      memberSessions.map((session) => session.id),
      SESSION_ID_CHUNK
    ),
    5,
    (ids) =>
      selectAllByKeyset<TestHistoryRow & { id: string }>((afterId, limit) => {
        let query = supabase
          .from("lead_status_history")
          .select("id,lead_session_id,to_status,created_at")
          .eq("tenant_id", tenantId)
          .in("lead_session_id", ids)
          .in("to_status", RESULT_STATUSES);
        if (afterId) query = query.gt("id", afterId);
        return query.order("id", { ascending: true }).limit(limit) as unknown as PromiseLike<{
          data: Array<TestHistoryRow & { id: string }> | null;
          error: { message: string } | null;
        }>;
      })
  );
  const history = historyChunks.flat();

  // Filtered view: events and history rows in range; a session is kept when it
  // started in range or any of its history rows is in range.
  const memberEvents = events.filter((event) => event.funnel_id && memberIds.has(event.funnel_id));
  const rangedEvents = memberEvents.filter((event) => inRange(event.occurred_at, range));
  const rangedHistory = history.filter((row) => inRange(row.created_at, range));
  const rangedHistorySessionIds = new Set(rangedHistory.map((row) => row.lead_session_id));
  const rangedSessions = memberSessions.filter(
    (session) => rangedHistorySessionIds.has(session.id) || inRange(session.started_at, range)
  );

  const questionsByFunnel = new Map<string, Array<Pick<Question, "id" | "label">>>();
  for (const question of (questionsResult.data ?? []) as Array<Pick<Question, "id" | "label" | "funnel_id">>) {
    const list = questionsByFunnel.get(question.funnel_id) ?? [];
    list.push(question);
    questionsByFunnel.set(question.funnel_id, list);
  }
  const ruleByFunnel = new Map<string, Json>(
    ((funnelsResult.data ?? []) as Array<{ id: string; qualification_rule: Json }>).map((funnel) => [
      funnel.id,
      funnel.qualification_rule
    ])
  );

  const arms: ArmResult[] = members.map((member) => {
    const isArm = (row: { funnel_id: string | null }) => row.funnel_id === member.funnelId;
    const armSessions = rangedSessions.filter(isArm);
    const armSessionIds = new Set(armSessions.map((session) => session.id));
    const armEvents = rangedEvents.filter(isArm);
    const counts = computeStageCounts(
      armEvents,
      armSessions,
      rangedHistory.filter((row) => armSessionIds.has(row.lead_session_id))
    );

    const fullSessions = memberSessions.filter(isArm);
    const fullSessionIds = new Set(fullSessions.map((session) => session.id));
    const full = computeStageCounts(
      memberEvents.filter(isArm),
      fullSessions,
      history.filter((row) => fullSessionIds.has(row.lead_session_id))
    );

    const spend = spendRows.get(member.funnelId);
    const { sets, ...plainCounts } = counts;
    return {
      funnelId: member.funnelId,
      label: splitArmLabel(member.position) as ArmResult["label"],
      name: member.name,
      counts: plainCounts,
      rates: computeStageRates(plainCounts),
      leadToBookingInterval: wilsonInterval(plainCounts.bookings, plainCounts.leads),
      dropOff: buildDropOffRows({
        bookedVisitorIds: sets.bookings,
        disqualifiedVisitorIds: sets.disqualified,
        events: armEvents,
        funnel: { qualification_rule: ruleByFunnel.get(member.funnelId) ?? {} },
        pageViewVisitorIds: sets.visitors,
        questions: questionsByFunnel.get(member.funnelId) ?? [],
        slotsShownVisitorIds: sets.calendarShown
      }),
      cost: costFor(spend ? { amountCents: spend.amountCents, currency: spend.currency } : null, {
        leads: full.leads,
        bookings: full.bookings
      })
    };
  });

  const call = callSplitTest(
    arms.map((arm) => ({
      funnelId: arm.funnelId,
      name: arm.name,
      leads: arm.cost.fullPeriodLeads,
      bookings: arm.cost.fullPeriodBookings
    }))
  );

  return {
    test,
    arms,
    totals: totalsOf(arms),
    call,
    fullPeriodLabel: `${formatDay(period.from)} to ${test.ended_at ? formatDay(period.to) : "today"}`,
    filteredMatchesFullPeriod:
      range.from.getTime() <= period.from.getTime() && range.to.getTime() >= period.to.getTime(),
    fullPeriod: period
  };
}

/** Spend per form for the test. Missing table (migration 0026 not run) means no spend. */
async function loadTestSpend(
  tenantId: string,
  testId: string
): Promise<Map<string, { amountCents: number; currency: string }>> {
  const result = new Map<string, { amountCents: number; currency: string }>();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("ad_spend_entries")
    .select("funnel_id,amount_cents,currency")
    .eq("tenant_id", tenantId)
    .eq("split_test_id", testId);
  if (error) {
    console.error("[spend] test spend lookup failed", error.message);
    return result;
  }
  for (const row of (data ?? []) as Array<{ funnel_id: string; amount_cents: number; currency: string }>) {
    result.set(row.funnel_id, { amountCents: Number(row.amount_cents), currency: row.currency });
  }
  return result;
}
