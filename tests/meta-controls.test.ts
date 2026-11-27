import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { META_MAX_EVENT_AGE_MS } from "@/lib/meta/constants";
import { META_EVENT_DEFS, type PixelSwitches } from "@/lib/meta/events";
import { decideEnqueue, type GateInput } from "@/lib/meta/gating";
import {
  COVERAGE_COLUMNS,
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  MATCH_GUIDANCE,
  META_CONTROLS_COPY,
  STATUS_REASON_LABELS,
  coverageShares,
  eventKeyLabel,
  formatShare,
  isReleasable,
  leadLabel,
  logRangeStart,
  matchKeyChips,
  metaResponseText,
  normalizeCoverageRow,
  parseLogFilter,
  parseSendingInput,
  planRelease,
  sortCoverageRows,
  totalCoverage,
  type CoverageRow,
  type SimulatedRow
} from "@/lib/meta/log-format";

const EM_DASH = String.fromCharCode(0x2014);

const ALL_ON: PixelSwitches = {
  send_form_view: true,
  send_form_start: true,
  send_lead: true,
  send_qualified_lead: true,
  send_disqualified_lead: true,
  send_booked_call: true
};

function row(overrides: Partial<CoverageRow> = {}): CoverageRow {
  return {
    event_key: "lead",
    events: 0,
    with_em: 0,
    with_ph: 0,
    with_fn: 0,
    with_ln: 0,
    with_ip: 0,
    with_ua: 0,
    with_fbp: 0,
    with_fbc: 0,
    with_external_id: 0,
    with_location: 0,
    ...overrides
  };
}

function allCopy(): string[] {
  const texts: string[] = [];
  for (const status of DELIVERY_STATUSES) {
    texts.push(DELIVERY_STATUS_LABELS[status].label, DELIVERY_STATUS_LABELS[status].help);
  }
  texts.push(...Object.values(STATUS_REASON_LABELS));
  texts.push(...MATCH_GUIDANCE.map((item) => item.text));
  for (const value of Object.values(META_CONTROLS_COPY)) {
    if (typeof value === "string") texts.push(value);
    else if (value.length === 1) texts.push((value as (n: number) => string)(3), (value as (n: number) => string)(1));
    else texts.push((value as (a: string, b: string) => string)("Nov 1, 2026", "detail"));
  }
  return texts;
}

describe("status labels", () => {
  it("every status has a label, help text and tone", () => {
    for (const status of DELIVERY_STATUSES) {
      const entry = DELIVERY_STATUS_LABELS[status];
      assert.ok(entry.label.length > 0, status);
      assert.ok(entry.help.length > 0, status);
      assert.ok(["slate", "amber", "emerald", "red", "blue"].includes(entry.tone), status);
    }
    assert.equal(DELIVERY_STATUSES.length, 8);
  });

  it("uses the exact copy for held and queued", () => {
    assert.equal(DELIVERY_STATUS_LABELS.held.label, "Held");
    assert.equal(DELIVERY_STATUS_LABELS.pending.label, "Queued");
    assert.equal(DELIVERY_STATUS_LABELS.awaiting_consent.label, "Waiting for consent");
  });

  it("labels event keys including the test event", () => {
    assert.equal(eventKeyLabel("booked_call"), META_EVENT_DEFS.booked_call.label);
    assert.equal(eventKeyLabel("test_event"), "Test event");
  });
});

describe("matchKeyChips", () => {
  it("maps keys to readable chips", () => {
    assert.deepEqual(matchKeyChips(["em", "ph", "fn", "ln", "client_ip_address", "client_user_agent", "fbp", "fbc", "external_id"]), [
      "Email",
      "Phone",
      "First name",
      "Last name",
      "IP",
      "Browser",
      "fbp",
      "fbc",
      "External ID"
    ]);
  });

  it("shows location once for city, region and country, and drops unknown keys", () => {
    assert.deepEqual(matchKeyChips(["ct", "st", "country", "zp", "em"]), ["Location", "Email"]);
    assert.deepEqual(matchKeyChips([]), []);
  });
});

describe("coverage maths", () => {
  it("coverageShares is exact on a fixture", () => {
    const shares = coverageShares(
      row({ events: 8, with_em: 6, with_ph: 4, with_fn: 2, with_ln: 0, with_ip: 8, with_ua: 7, with_fbp: 1, with_fbc: 3, with_external_id: 8, with_location: 5 })
    );
    assert.deepEqual(shares, {
      email: 0.75,
      phone: 0.5,
      firstName: 0.25,
      lastName: 0,
      ip: 1,
      userAgent: 0.875,
      fbp: 0.125,
      fbc: 0.375,
      externalId: 1,
      location: 0.625
    });
    assert.equal(formatShare(shares.userAgent), "88%");
    assert.equal(formatShare(shares.phone), "50%");
  });

  it("coverageShares is 0 for every key with no events", () => {
    const shares = coverageShares(row({ events: 0, with_em: 3 }));
    for (const column of COVERAGE_COLUMNS) assert.equal(shares[column.key], 0);
  });

  it("never reports more than 100%", () => {
    assert.equal(coverageShares(row({ events: 2, with_em: 5 })).email, 1);
  });

  it("totalCoverage sums every column", () => {
    const total = totalCoverage([
      row({ event_key: "form_view", events: 10, with_ip: 10, with_ua: 9, with_fbp: 4 }),
      row({ event_key: "lead", events: 5, with_em: 5, with_ph: 4, with_ip: 5, with_ua: 5, with_fbp: 1, with_location: 3 })
    ]);
    assert.equal(total.event_key, "all");
    assert.equal(total.events, 15);
    assert.equal(total.with_em, 5);
    assert.equal(total.with_ph, 4);
    assert.equal(total.with_ip, 15);
    assert.equal(total.with_ua, 14);
    assert.equal(total.with_fbp, 5);
    assert.equal(total.with_location, 3);
    assert.equal(totalCoverage([]).events, 0);
  });

  it("normalizes numeric strings from the database and sorts by event order", () => {
    const normalized = normalizeCoverageRow({ event_key: "lead", events: "4" as unknown as number, with_em: "3" as unknown as number });
    assert.equal(normalized.events, 4);
    assert.equal(normalized.with_em, 3);
    assert.equal(normalized.with_fbc, 0);
    const sorted = sortCoverageRows([row({ event_key: "booked_call" }), row({ event_key: "form_view" }), row({ event_key: "lead" })]);
    assert.deepEqual(sorted.map((item) => item.event_key), ["form_view", "lead", "booked_call"]);
  });
});

describe("logFilterSchema", () => {
  it("defaults to everything over the last 7 days", () => {
    assert.deepEqual(parseLogFilter({}), { status: "all", event: "all", preset: "last_7_days", before: undefined });
    assert.deepEqual(parseLogFilter(undefined), { status: "all", event: "all", preset: "last_7_days", before: undefined });
  });

  it("accepts known values", () => {
    const filter = parseLogFilter({ status: "held", event: "test_event", preset: "today", before: "2026-11-20T10:00:00.000Z" });
    assert.deepEqual(filter, { status: "held", event: "test_event", preset: "today", before: "2026-11-20T10:00:00.000Z" });
  });

  it("falls back to defaults for junk instead of failing", () => {
    const filter = parseLogFilter({ status: "drop table", event: ["lead"], preset: "forever", before: "not a date" });
    assert.deepEqual(filter, { status: "all", event: "all", preset: "last_7_days", before: undefined });
  });

  it("range starts at local midnight, 6 or 29 days back", () => {
    const now = new Date(2026, 10, 26, 15, 30);
    assert.deepEqual(logRangeStart("today", now), new Date(2026, 10, 26));
    assert.deepEqual(logRangeStart("last_7_days", now), new Date(2026, 10, 20));
    assert.deepEqual(logRangeStart("last_30_days", now), new Date(2026, 9, 28));
  });
});

describe("hold and fire", () => {
  const funnel = { meta_pixel_id: "pixel-1", meta_consent_confirmed_at: "2026-11-01T00:00:00Z", meta_consent_checkbox_enabled: false };
  const gate = (overrides: Partial<GateInput>): GateInput => ({
    key: "lead",
    funnel,
    pixel: { ...ALL_ON, sending_mode: "hold" },
    lead: { meta_consent: null, meta_released_at: null },
    ...overrides
  });

  it("hold mode writes new events as held", () => {
    assert.deepEqual(decideEnqueue(gate({})), { action: "enqueue", status: "held" });
    assert.deepEqual(decideEnqueue(gate({ key: "form_view", lead: null })), { action: "enqueue", status: "held" });
  });

  it("after the lead is fired, its new events go out automatically", () => {
    assert.deepEqual(
      decideEnqueue(gate({ key: "booked_call", lead: { meta_consent: null, meta_released_at: "2026-11-20T10:00:00Z" } })),
      { action: "enqueue", status: "pending" }
    );
  });

  it("automatic mode queues as pending", () => {
    assert.deepEqual(decideEnqueue(gate({ pixel: { ...ALL_ON, sending_mode: "automatic" } })), {
      action: "enqueue",
      status: "pending"
    });
  });

  it("switching to automatic leaves rows that are already held held", () => {
    const nowMs = Date.parse("2026-11-26T12:00:00Z");
    const rows: SimulatedRow[] = [
      { id: "a", pixelId: "pixel-1", leadSessionId: "lead-1", status: "held", eventTimeMs: nowMs - 60_000 }
    ];
    // The mode switch changes only how new events are written.
    const newEvent = decideEnqueue(gate({ pixel: { ...ALL_ON, sending_mode: "automatic" }, key: "qualified_lead" }));
    assert.deepEqual(newEvent, { action: "enqueue", status: "pending" });
    assert.equal(rows[0].status, "held");
    // Only an explicit fire releases it.
    assert.deepEqual(planRelease(rows, { pixelId: "pixel-1" }, nowMs), ["a"]);
  });

  it("fire for a lead releases only that lead's held rows", () => {
    const nowMs = Date.parse("2026-11-26T12:00:00Z");
    const rows: SimulatedRow[] = [
      { id: "view", pixelId: "pixel-1", leadSessionId: "lead-1", status: "held", eventTimeMs: nowMs - 3_600_000 },
      { id: "lead", pixelId: "pixel-2", leadSessionId: "lead-1", status: "held", eventTimeMs: nowMs - 60_000 },
      { id: "other", pixelId: "pixel-1", leadSessionId: "lead-2", status: "held", eventTimeMs: nowMs - 60_000 },
      { id: "sent", pixelId: "pixel-1", leadSessionId: "lead-1", status: "sent", eventTimeMs: nowMs - 60_000 }
    ];
    assert.deepEqual(planRelease(rows, { leadSessionId: "lead-1" }, nowMs), ["view", "lead"]);
    assert.deepEqual(planRelease(rows, { pixelId: "pixel-1" }, nowMs), ["view", "other"]);
    assert.deepEqual(planRelease(rows, {}, nowMs), []);
  });

  it("an event older than Meta's limit is not releasable", () => {
    const nowMs = Date.parse("2026-11-26T12:00:00Z");
    assert.equal(isReleasable(nowMs - META_MAX_EVENT_AGE_MS + 1000, nowMs), true);
    assert.equal(isReleasable(nowMs - META_MAX_EVENT_AGE_MS, nowMs), false);
    assert.equal(isReleasable(nowMs - 8 * 24 * 3_600_000, nowMs), false);
    const rows: SimulatedRow[] = [
      { id: "old", pixelId: "pixel-1", leadSessionId: null, status: "held", eventTimeMs: nowMs - META_MAX_EVENT_AGE_MS - 1 }
    ];
    assert.deepEqual(planRelease(rows, { pixelId: "pixel-1" }, nowMs), []);
  });
});

describe("sending settings form", () => {
  it("reads the radio and the six switches", () => {
    assert.deepEqual(parseSendingInput({ sending_mode: "hold", send_lead: "on", send_booked_call: "on" }), {
      sending_mode: "hold",
      switches: {
        send_form_view: false,
        send_form_start: false,
        send_lead: true,
        send_qualified_lead: false,
        send_disqualified_lead: false,
        send_booked_call: true
      }
    });
  });

  it("anything but hold is automatic", () => {
    assert.equal(parseSendingInput({ sending_mode: "later" }).sending_mode, "automatic");
    assert.equal(parseSendingInput({}).sending_mode, "automatic");
  });
});

describe("log display", () => {
  it("lead label prefers the full name, then the email, else Visitor", () => {
    assert.equal(leadLabel({ full_name: "Avery Sample", email: "a@example.com" }), "Avery Sample");
    assert.equal(leadLabel({ first_name: "Avery", last_name: "Sample" }), "Avery Sample");
    assert.equal(leadLabel({ email: "a@example.com" }), "a@example.com");
    assert.equal(leadLabel({}), "Visitor");
    assert.equal(leadLabel(null), "Visitor");
  });

  it("describes the Meta response per status", () => {
    assert.equal(metaResponseText("sent", { events_received: 1, fbtrace_id: "abc" }, null), "Received by Meta (1 event)");
    assert.equal(metaResponseText("failed", {}, "HTTP 400: Invalid parameter"), "HTTP 400: Invalid parameter");
    assert.equal(metaResponseText("held", null, null), "Not sent yet");
    assert.equal(metaResponseText("pending", null, "Network error"), "Not sent yet (last try: Network error)");
    assert.equal(metaResponseText("cancelled", null, null), "Not sent");
  });
});

describe("copy", () => {
  it("has no em dash anywhere", () => {
    for (const text of allCopy()) assert.ok(!text.includes(EM_DASH), text);
  });

  it("says the match quality figure is not Meta's score", () => {
    assert.match(META_CONTROLS_COPY.qualitySubheading, /not Meta's Event Match Quality score/);
  });

  it("uses plural and singular counts", () => {
    assert.equal(META_CONTROLS_COPY.heldCount(3), "3 events are held.");
    assert.equal(META_CONTROLS_COPY.heldCount(1), "1 event is held.");
  });
});
