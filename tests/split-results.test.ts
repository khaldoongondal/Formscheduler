import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDropOffRows,
  computeStageCounts,
  computeStageRates,
  rate,
  visitorIdentity,
  type HistoryRow,
  type SessionRow,
  type VisitorEventRow
} from "@/lib/analytics/funnel-math";
import {
  MIN_LEADS_PER_FORM,
  SPLIT_CALL_RULE,
  callSplitTest,
  costFor,
  splitCallMessage,
  totalsOf,
  wilsonInterval,
  type ArmResult
} from "@/lib/split-tests/results";
import { TOO_MUCH_DATA_MESSAGE, chunk, mapInBatches, selectAllPages } from "@/lib/supabase/paging";
import type { AnalyticsEventType, LeadSessionStatus } from "@/lib/types/database";

const EM_DASH = String.fromCharCode(0x2014);
const FORM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FORM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

let rowId = 0;
function event(visitor: string | null, funnelId: string, type: AnalyticsEventType, stepKey: string | null = null): VisitorEventRow {
  rowId += 1;
  return { id: `event-${rowId}`, visitor_id: visitor, funnel_id: funnelId, event_type: type, step_key: stepKey };
}
function session(id: string, visitor: string | null, funnelId: string): SessionRow {
  return { id, visitor_id: visitor, funnel_id: funnelId };
}
function history(sessionId: string, ...statuses: LeadSessionStatus[]): HistoryRow[] {
  return statuses.map((status) => ({ lead_session_id: sessionId, to_status: status }));
}

// Two forms. Form A: v1 page view only; v2 starts; v3 books; v4 is a lead with
// no form_start event and is disqualified; v5 has two sessions; one session
// has no visitor id. Form B: v6 books.
const events: VisitorEventRow[] = [
  event("v1", FORM_A, "page_view"),
  event("v2", FORM_A, "page_view"),
  event("v2", FORM_A, "form_start"),
  event("v3", FORM_A, "page_view"),
  event("v3", FORM_A, "form_start"),
  event("v3", FORM_A, "step_view", "slots"),
  event("v6", FORM_B, "page_view"),
  event("v6", FORM_B, "form_start")
];
const sessions: SessionRow[] = [
  session("s3", "v3", FORM_A),
  session("s4", "v4", FORM_A),
  session("s5a", "v5", FORM_A),
  session("s5b", "v5", FORM_A),
  session("s7", null, FORM_A),
  session("s6", "v6", FORM_B)
];
const historyRows: HistoryRow[] = [
  ...history("s3", "potential", "qualified", "slots_shown", "booked"),
  ...history("s4", "potential", "disqualified"),
  ...history("s5a", "potential"),
  ...history("s5b", "potential"),
  ...history("s6", "potential", "slots_shown", "booked"),
  // A session that is not in the input is ignored.
  ...history("s-unknown", "potential", "booked")
];

function forForm(funnelId: string) {
  const armSessions = sessions.filter((row) => row.funnel_id === funnelId);
  const ids = new Set(armSessions.map((row) => row.id));
  return computeStageCounts(
    events.filter((row) => row.funnel_id === funnelId),
    armSessions,
    historyRows.filter((row) => ids.has(row.lead_session_id))
  );
}

function arm(funnelId: string, label: "A" | "B" | "C", name: string, spend: { amountCents: number; currency: string } | null): ArmResult {
  const { sets: _sets, ...counts } = forForm(funnelId);
  void _sets;
  return {
    funnelId,
    label,
    name,
    counts,
    rates: computeStageRates(counts),
    leadToBookingInterval: wilsonInterval(counts.bookings, counts.leads),
    dropOff: [],
    cost: costFor(spend, { leads: counts.leads, bookings: counts.bookings })
  };
}

describe("computeStageCounts", () => {
  it("counts every stage per distinct visitor on a hand-counted fixture", () => {
    const a = forForm(FORM_A);
    assert.deepEqual(
      {
        visitors: a.visitors,
        starts: a.starts,
        leads: a.leads,
        qualified: a.qualified,
        disqualified: a.disqualified,
        calendarShown: a.calendarShown,
        bookings: a.bookings
      },
      // visitors v1 v2 v3 v4 v5 s7; starts v2 v3 v4 v5 s7; leads v3 v4 v5
      { visitors: 6, starts: 5, leads: 3, qualified: 1, disqualified: 1, calendarShown: 1, bookings: 1 }
    );
    const b = forForm(FORM_B);
    assert.equal(b.visitors, 1);
    assert.equal(b.starts, 1);
    assert.equal(b.leads, 1);
    assert.equal(b.calendarShown, 1);
    assert.equal(b.bookings, 1);
  });

  it("counts a lead without a form_start event as a start", () => {
    assert.equal(forForm(FORM_A).sets.starts.has("v4"), true);
  });

  it("counts two sessions of one visitor once", () => {
    const a = forForm(FORM_A);
    assert.equal(a.sets.leads.has("v5"), true);
    assert.equal([...a.sets.leads].filter((identity) => identity === "v5").length, 1);
  });

  it("uses the row id when there is no visitor id", () => {
    assert.equal(visitorIdentity({ id: "row-1", visitor_id: null }), "row-1");
    assert.equal(visitorIdentity({ id: "row-1", visitor_id: "v9" }), "v9");
    assert.equal(forForm(FORM_A).sets.visitors.has("s7"), true);
  });

  it("ignores history for sessions that are not in the input", () => {
    const counts = computeStageCounts([], [], history("s-x", "potential", "booked"));
    assert.equal(counts.leads, 0);
    assert.equal(counts.bookings, 0);
  });
});

describe("computeStageRates", () => {
  it("gives exact rates", () => {
    const rates = computeStageRates({
      visitors: 200,
      starts: 50,
      leads: 20,
      qualified: 15,
      disqualified: 5,
      calendarShown: 14,
      bookings: 10
    });
    assert.equal(rates.visitorToStart, 0.25);
    assert.equal(rates.startToLead, 0.4);
    assert.equal(rates.leadToBooking, 0.5);
    assert.equal(rates.visitorToBooking, 0.05);
  });

  it("gives 0 when a denominator is 0", () => {
    const rates = computeStageRates({
      visitors: 0,
      starts: 0,
      leads: 0,
      qualified: 0,
      disqualified: 0,
      calendarShown: 0,
      bookings: 0
    });
    assert.deepEqual(rates, { visitorToStart: 0, startToLead: 0, leadToBooking: 0, visitorToBooking: 0 });
    assert.equal(rate(3, 0), 0);
  });
});

describe("wilsonInterval", () => {
  const round = (value: number) => Math.round(value * 10000) / 10000;

  it("matches known values", () => {
    const mid = wilsonInterval(10, 20)!;
    assert.equal(round(mid.low), 0.2993);
    assert.equal(round(mid.high), 0.7007);

    const none = wilsonInterval(0, 30)!;
    assert.equal(none.low, 0);
    assert.equal(round(none.high), 0.1135);

    const all = wilsonInterval(30, 30)!;
    assert.equal(round(all.low), 0.8865);
    assert.equal(all.high, 1);
  });

  it("returns null with no trials", () => {
    assert.equal(wilsonInterval(0, 0), null);
  });
});

describe("callSplitTest", () => {
  it("is too early when a form has fewer than 30 leads", () => {
    const call = callSplitTest([
      { funnelId: FORM_A, name: "Form A", leads: 29, bookings: 10 },
      { funnelId: FORM_B, name: "Form B", leads: 40, bookings: 10 }
    ]);
    assert.equal(call.state, "too_early");
    assert.deepEqual(call.state === "too_early" ? call.shortfalls : null, [
      { funnelId: FORM_A, name: "Form A", leadsNeeded: 1 }
    ]);
    assert.equal(MIN_LEADS_PER_FORM, 30);
  });

  it("calls a leader when the ranges do not overlap", () => {
    const top = wilsonInterval(25, 40)!;
    const other = wilsonInterval(10, 40)!;
    assert.equal(Math.round(top.low * 10000) / 10000, 0.4703);
    assert.equal(Math.round(other.high * 10000) / 10000, 0.4019);
    const call = callSplitTest([
      { funnelId: FORM_A, name: "Form A", leads: 40, bookings: 25 },
      { funnelId: FORM_B, name: "Form B", leads: 40, bookings: 10 }
    ]);
    assert.deepEqual(call, { state: "leader", funnelId: FORM_A, name: "Form A" });
  });

  it("finds no clear leader when the ranges overlap", () => {
    const call = callSplitTest([
      { funnelId: FORM_A, name: "Form A", leads: 40, bookings: 22 },
      { funnelId: FORM_B, name: "Form B", leads: 40, bookings: 18 }
    ]);
    assert.equal(call.state, "no_clear_leader");
  });

  it("finds no clear leader on equal rates", () => {
    const call = callSplitTest([
      { funnelId: FORM_A, name: "Form A", leads: 300, bookings: 150 },
      { funnelId: FORM_B, name: "Form B", leads: 30, bookings: 15 }
    ]);
    assert.equal(call.state, "no_clear_leader");
  });

  it("needs the top form to beat every other form", () => {
    const call = callSplitTest([
      { funnelId: FORM_A, name: "Form A", leads: 40, bookings: 30 },
      { funnelId: FORM_B, name: "Form B", leads: 40, bookings: 28 },
      { funnelId: "c", name: "Form C", leads: 40, bookings: 10 }
    ]);
    assert.ok(wilsonInterval(30, 40)!.low > wilsonInterval(10, 40)!.high);
    assert.equal(call.state, "no_clear_leader");
  });
});

describe("splitCallMessage", () => {
  it("lists only short forms, with a singular for one lead", () => {
    const message = splitCallMessage({
      state: "too_early",
      shortfalls: [
        { funnelId: FORM_A, name: "Form A", leadsNeeded: 5 },
        { funnelId: FORM_B, name: "Form B", leadsNeeded: 1 }
      ]
    });
    assert.equal(message, "Too early to call. Still needed: Form A 5 more leads, Form B 1 more lead.");
  });

  it("uses the exact copy and no em dash", () => {
    const messages = [
      SPLIT_CALL_RULE,
      splitCallMessage({ state: "no_clear_leader" }),
      splitCallMessage({ state: "leader", funnelId: FORM_A, name: "Form A" }),
      splitCallMessage({ state: "too_early", shortfalls: [{ funnelId: FORM_A, name: "Form A", leadsNeeded: 2 }] })
    ];
    assert.equal(
      messages[2],
      "Form A is ahead on lead-to-booking rate, and its likely range does not overlap with the other forms."
    );
    for (const message of messages) assert.equal(message.includes(EM_DASH), false, message);
  });
});

describe("costFor", () => {
  it("divides spend by full-period leads and bookings", () => {
    const cost = costFor({ amountCents: 1_800_000, currency: "USD" }, { leads: 120, bookings: 60 });
    assert.equal(cost.costPerLeadCents, 15_000);
    assert.equal(cost.costPerBookingCents, 30_000);
    assert.equal(cost.spendCents, 1_800_000);
  });

  it("gives no cost with zero leads", () => {
    const cost = costFor({ amountCents: 50_000, currency: "USD" }, { leads: 0, bookings: 0 });
    assert.equal(cost.costPerLeadCents, null);
    assert.equal(cost.costPerBookingCents, null);
  });

  it("gives nulls with no spend", () => {
    const cost = costFor(null, { leads: 10, bookings: 4 });
    assert.equal(cost.spendCents, null);
    assert.equal(cost.currency, null);
    assert.equal(cost.costPerLeadCents, null);
    assert.equal(cost.costPerBookingCents, null);
  });
});

describe("totalsOf", () => {
  it("sums the forms and uses full-period counts for cost", () => {
    const a = arm(FORM_A, "A", "Form A", { amountCents: 30_000, currency: "USD" });
    const b = arm(FORM_B, "B", "Form B", { amountCents: 10_000, currency: "USD" });
    const totals = totalsOf([a, b]);
    assert.equal(totals.counts.visitors, a.counts.visitors + b.counts.visitors);
    assert.equal(totals.counts.leads, 4);
    assert.equal(totals.counts.bookings, 2);
    assert.equal(totals.rates.leadToBooking, 0.5);
    assert.equal(totals.spendCents, 40_000);
    assert.equal(totals.currency, "USD");
    assert.equal(totals.costPerLeadCents, 10_000);
    assert.equal(totals.costPerBookingCents, 20_000);
    assert.equal(totals.spendComplete, true);
  });

  it("keeps cost on full-period counts when the shown counts are filtered", () => {
    const a = arm(FORM_A, "A", "Form A", { amountCents: 30_000, currency: "USD" });
    const filtered: ArmResult = { ...a, counts: { ...a.counts, leads: 1, bookings: 0 } };
    const totals = totalsOf([filtered]);
    assert.equal(totals.counts.leads, 1);
    assert.equal(totals.costPerLeadCents, 10_000);
  });

  it("shows mixed currencies instead of a total", () => {
    const totals = totalsOf([
      arm(FORM_A, "A", "Form A", { amountCents: 30_000, currency: "USD" }),
      arm(FORM_B, "B", "Form B", { amountCents: 10_000, currency: "CAD" })
    ]);
    assert.equal(totals.spendCents, null);
    assert.equal(totals.currency, "mixed");
    assert.equal(totals.costPerLeadCents, null);
  });

  it("gives no total cost until every form has spend", () => {
    const totals = totalsOf([arm(FORM_A, "A", "Form A", { amountCents: 30_000, currency: "USD" }), arm(FORM_B, "B", "Form B", null)]);
    assert.equal(totals.spendCents, 30_000);
    assert.equal(totals.spendComplete, false);
    assert.equal(totals.costPerLeadCents, null);
  });

  it("gives nulls when no spend is entered", () => {
    const totals = totalsOf([arm(FORM_A, "A", "Form A", null), arm(FORM_B, "B", "Form B", null)]);
    assert.equal(totals.spendCents, null);
    assert.equal(totals.currency, null);
  });
});

describe("buildDropOffRows", () => {
  it("returns no rows without step views", () => {
    const rows = buildDropOffRows({
      bookedVisitorIds: new Set(),
      disqualifiedVisitorIds: new Set(),
      events: [event("v1", FORM_A, "page_view")],
      funnel: { qualification_rule: {} },
      pageViewVisitorIds: new Set(["v1"]),
      questions: [],
      slotsShownVisitorIds: new Set()
    });
    assert.deepEqual(rows, []);
  });

  it("starts with the page and ends with the calendar", () => {
    const a = forForm(FORM_A);
    const rows = buildDropOffRows({
      bookedVisitorIds: a.sets.bookings,
      disqualifiedVisitorIds: a.sets.disqualified,
      events: events.filter((row) => row.funnel_id === FORM_A),
      funnel: { qualification_rule: {} },
      pageViewVisitorIds: a.sets.visitors,
      questions: [],
      slotsShownVisitorIds: a.sets.calendarShown
    });
    assert.equal(rows[0].stepKey, "page_view");
    assert.equal(rows[0].uniqueVisitors, a.visitors);
    const calendar = rows[rows.length - 1];
    assert.equal(calendar.stepKey, "slots");
    assert.equal(calendar.uniqueVisitors, 1);
    assert.equal(calendar.continuedCount, 1);
  });
});

describe("selectAllPages", () => {
  function fakeTable(total: number) {
    const calls: Array<[number, number]> = [];
    const build = async (from: number, to: number) => {
      calls.push([from, to]);
      const rows = Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, index) => from + index);
      return { data: rows, error: null };
    };
    return { calls, build };
  }

  it("reads every page past 1000 rows", async () => {
    const table = fakeTable(2500);
    const rows = await selectAllPages(table.build);
    assert.equal(rows.length, 2500);
    assert.deepEqual(table.calls, [
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ]);
    assert.equal(new Set(rows).size, 2500);
  });

  it("stops after an empty page on an exact multiple", async () => {
    const table = fakeTable(2000);
    assert.equal((await selectAllPages(table.build)).length, 2000);
    assert.equal(table.calls.length, 3);
  });

  it("throws past the row cap", async () => {
    const table = fakeTable(5000);
    await assert.rejects(selectAllPages(table.build, { pageSize: 1000, maxRows: 2500 }), {
      message: TOO_MUCH_DATA_MESSAGE
    });
  });

  it("passes a query error on", async () => {
    await assert.rejects(
      selectAllPages(async () => ({ data: null, error: { message: "boom" } })),
      { message: "boom" }
    );
  });

  it("chunks id lists", () => {
    assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
    assert.deepEqual(chunk([], 2), []);
  });
});

describe("mapInBatches", () => {
  it("keeps order and limits calls in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const results = await mapInBatches([1, 2, 3, 4, 5, 6, 7], 3, async (value) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return value * 2;
    });
    assert.deepEqual(results, [2, 4, 6, 8, 10, 12, 14]);
    assert.ok(peak <= 3);
  });
});
