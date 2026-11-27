/**
 * Sprint 3 P4.5: every calendar records the same lead statuses, analytics
 * events, split test, Meta events and CRM events (decision C22).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GHL_DOCUMENTED_DIFFERENCES,
  LIFECYCLE_STAGES,
  PROVIDER_EVENT_MATRIX,
  leadStageMetadata,
  planOutcome,
  type LifecycleStage,
  type OutcomeStep,
  type StageRecord
} from "@/lib/bookings/outcome-plan";
import { createOutcomeRecorder, type OutcomeDeps } from "@/lib/bookings/outcomes";
import { buildFormBookEvent } from "@/lib/crm/event-payload";
import type { CalendarKind } from "@/lib/connections/types";
import type { Funnel, LeadSession } from "@/lib/types/database";

const ROOT = process.cwd();
const CALENDAR_KINDS: CalendarKind[] = ["ghl", "google_calendar", "calcom", "calendly"];
const GENERIC_KINDS: CalendarKind[] = ["google_calendar", "calcom", "calendly"];
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const TEST_ID = "55555555-5555-4555-8555-555555555555";
const EXTERNAL_REF = "6f1c2a1e-0000-4000-8000-000000000001";

function source(relative: string): string {
  return readFileSync(path.join(ROOT, relative), "utf8");
}

/** The text of one top-level function, from its declaration to the next top-level declaration. */
function functionBody(text: string, name: string): string {
  const start = text.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(start >= 0, `function ${name} not found`);
  const rest = text.slice(start + 1);
  const next = rest.search(/\n(?:export )?(?:async )?function |\n\/\*\*|\nexport const /);
  return next >= 0 ? text.slice(start, start + 1 + next) : text.slice(start);
}

function count(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`)) ?? []).length;
}

function session(overrides: Partial<LeadSession> = {}): LeadSession {
  return {
    id: SESSION_ID,
    tenant_id: "66666666-6666-4666-8666-666666666666",
    funnel_id: "11111111-1111-4111-8111-111111111111",
    status: "slots_shown",
    first_name: "Alex",
    last_name: "Example",
    full_name: "Alex Example",
    email: "alex@example.com",
    phone: "+14165550101",
    visitor_id: "visitor-1",
    ghl_connection_id: null,
    ghl_contact_id: null,
    ghl_opportunity_id: null,
    source_url: "https://example.com/book",
    referrer: null,
    utm_source: "facebook",
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null,
    user_agent: null,
    ip_address: null,
    metadata: {},
    external_ref: EXTERNAL_REF,
    started_at: "2026-12-01T15:00:00.000Z",
    qualified_at: null,
    slots_shown_at: null,
    booked_at: null,
    disqualified_at: null,
    abandoned_at: null,
    errored_at: null,
    created_at: "2026-12-01T15:00:00.000Z",
    updated_at: "2026-12-01T15:00:00.000Z",
    ...overrides
  };
}

function fakeDeps() {
  const calls: string[] = [];
  const tracked: Array<{ splitTestId?: string | null; eventType: string; metadata?: unknown }> = [];
  let status: LeadSession["status"] = "slots_shown";
  const deps: OutcomeDeps = {
    updateStatus: async (_id, next) => {
      status = next;
      calls.push(`status:${next}`);
      return session({ status: next, split_test_id: TEST_ID });
    },
    trackEvent: async (input) => {
      calls.push(`track:${input.eventType}`);
      tracked.push(input);
      return null;
    },
    onLeadStage: async (key, current) => {
      calls.push(`meta:${key}:${current.status}`);
      return { id: `m-${status}`, eventName: "Schedule", eventId: `e-${status}`, status: "pending" };
    },
    dispatchCrmEvent: (input) => {
      calls.push(`crm:${input.type}`);
    }
  };
  return { deps, calls, tracked };
}

/** The matrix row implied by planOutcome's steps for one stage. */
function rowFromPlan(steps: OutcomeStep[]): Pick<StageRecord, "status" | "analytics" | "meta" | "crm"> & { provider: unknown } {
  const status = steps.find((step) => step.do === "status");
  const track = steps.find((step) => step.do === "track");
  const meta = steps.find((step) => step.do === "meta");
  const crm = steps.find((step) => step.do === "crm");
  assert.ok(track && track.do === "track", "every outcome tracks an analytics event");
  return {
    status: status && status.do === "status" ? status.status : null,
    analytics: track.eventType,
    meta: meta && meta.do === "meta" ? meta.key : null,
    crm: crm && crm.do === "crm" ? crm.type : null,
    provider: track.metadata.provider
  };
}

describe("PROVIDER_EVENT_MATRIX", () => {
  it("has a row for every calendar kind and every stage", () => {
    for (const kind of CALENDAR_KINDS) {
      assert.deepEqual(Object.keys(PROVIDER_EVENT_MATRIX[kind]).sort(), [...LIFECYCLE_STAGES].sort(), kind);
    }
  });

  it("every non-GoHighLevel calendar equals the Google row", () => {
    for (const kind of GENERIC_KINDS) {
      assert.deepEqual(PROVIDER_EVENT_MATRIX[kind], PROVIDER_EVENT_MATRIX.google_calendar, kind);
    }
  });

  it("GoHighLevel differs only by the documented items", () => {
    for (const stage of LIFECYCLE_STAGES) {
      const ghl = PROVIDER_EVENT_MATRIX.ghl[stage];
      const google = PROVIDER_EVENT_MATRIX.google_calendar[stage];
      for (const key of Object.keys(google) as Array<keyof StageRecord>) {
        if (!GHL_DOCUMENTED_DIFFERENCES.includes(key)) assert.equal(ghl[key], google[key], `${stage}.${key}`);
      }
      // Inline handoff: no queued CRM event, and no provider metadata.
      assert.equal(ghl.crm, null, stage);
      assert.equal(ghl.providerMetadata, false, stage);
      // Only a failed handoff or booking sets the error status.
      if (stage === "booking_error") {
        assert.equal(ghl.status, "error");
        assert.equal(google.status, null);
      } else {
        assert.equal(ghl.status, google.status, stage);
      }
    }
  });

  it("the generic rows send a CRM event at every lead moment except slots shown and errors", () => {
    const row = PROVIDER_EVENT_MATRIX.google_calendar;
    assert.equal(row.lead.crm, "lead.captured");
    assert.equal(row.qualified.crm, "lead.qualified");
    assert.equal(row.disqualified.crm, "lead.disqualified");
    assert.equal(row.booked.crm, "lead.booked");
    assert.equal(row.slots_shown.crm, null);
    assert.equal(row.booking_error.crm, null);
  });

  const outcomeStages: Array<[LifecycleStage, Parameters<typeof planOutcome>[0]]> = [
    ["slots_shown", "slots_shown"],
    ["booked", "booked"],
    ["booking_error", "booking_error"]
  ];

  for (const kind of GENERIC_KINDS) {
    for (const [stage, outcome] of outcomeStages) {
      it(`planOutcome matches the matrix for ${kind} at ${stage}`, () => {
        const steps = planOutcome(outcome, {
          provider: kind,
          slotCount: kind === "calendly" ? null : 4,
          externalBookingId: "b1",
          phase: "appointment_create",
          message: "failed"
        });
        const planned = rowFromPlan(steps);
        const expected = PROVIDER_EVENT_MATRIX[kind][stage];
        assert.equal(planned.status, expected.status);
        assert.equal(planned.analytics, expected.analytics);
        assert.equal(planned.meta, expected.meta);
        assert.equal(planned.crm, expected.crm);
        assert.equal(planned.provider, expected.providerMetadata ? kind : undefined);
      });
    }
  }

  it("Calendly records slots shown with no slot count; slot calendars include it", () => {
    const calendly = planOutcome("slots_shown", { provider: "calendly", slotCount: null });
    const google = planOutcome("slots_shown", { provider: "google_calendar", slotCount: 3 });
    const metadataOf = (steps: OutcomeStep[]) => (steps.find((step) => step.do === "track") as { metadata: Record<string, unknown> }).metadata;
    assert.deepEqual(metadataOf(calendly), { provider: "calendly" });
    assert.deepEqual(metadataOf(google), { provider: "google_calendar", slot_count: 3 });
  });
});

describe("leadStageMetadata (fix from the consistency pass)", () => {
  it("adds the provider for every non-GoHighLevel calendar", () => {
    for (const kind of GENERIC_KINDS) assert.deepEqual(leadStageMetadata(kind), { provider: kind });
  });

  it("leaves GoHighLevel rows unchanged, including forms saved before migration 0029", () => {
    assert.equal(leadStageMetadata("ghl"), undefined);
    assert.equal(leadStageMetadata(undefined), undefined);
    assert.equal(leadStageMetadata(null), undefined);
  });

  it("matches the matrix flag for lead, qualified and disqualified", () => {
    for (const kind of CALENDAR_KINDS) {
      for (const stage of ["lead", "qualified", "disqualified"] as const) {
        assert.equal(leadStageMetadata(kind) !== undefined, PROVIDER_EVENT_MATRIX[kind][stage].providerMetadata, `${kind} ${stage}`);
      }
    }
  });
});

describe("generic code paths record only through the shared recorder", () => {
  const files = [
    "lib/bookings/generic-path.ts",
    "lib/connections/calendly.ts",
    "lib/bookings/calendly-confirm.ts",
    "app/api/bookings/calendly/route.ts",
    "app/api/webhooks/calendly/[connectionId]/route.ts"
  ];

  for (const file of files) {
    it(`${file} never records outcomes directly`, () => {
      const text = source(file);
      assert.equal(count(text, /\btrackEvent\(/), 0, "trackEvent");
      assert.equal(count(text, /\bupdateLeadSessionStatus\(/), 0, "updateLeadSessionStatus");
      assert.equal(count(text, /\bonLeadStage\(/), 0, "onLeadStage");
      assert.equal(count(text, /\bdispatchCrmEvent\(/), 0, "dispatchCrmEvent");
      // No direct status write on lead sessions.
      assert.equal(count(text, /from\("lead_sessions"\)\s*\.update/), 0, "lead_sessions update");
    });
  }

  it("the booking paths that record outcomes use createOutcomeRecorder", () => {
    for (const file of ["lib/bookings/generic-path.ts", "lib/connections/calendly.ts", "lib/bookings/calendly-confirm.ts"]) {
      assert.ok(source(file).includes("createOutcomeRecorder("), file);
    }
  });

  it("the recorder's default status update is updateLeadSessionStatus (so lead_status_history counts it)", () => {
    const text = source("lib/bookings/outcomes.ts");
    assert.match(text, /updateStatus:\s*updateLeadSessionStatus/);
    assert.match(text, /trackEvent,/);
    assert.match(text, /onLeadStage\(key, session, funnel\)/);
  });

  it("updateLeadSessionStatus stamps booked_at, so booked rows count in analytics", () => {
    const body = functionBody(source("lib/lead-sessions/service.ts"), "updateLeadSessionStatus");
    assert.match(body, /booked:\s*"booked_at"/);
    assert.match(body, /slots_shown:\s*"slots_shown_at"/);
  });
});

describe("generic lead capture and answers (lib/lead-sessions/service.ts)", () => {
  const text = source("lib/lead-sessions/service.ts");

  it("generic lead capture calls onLead once and queues lead.captured once, with provider metadata", () => {
    const body = functionBody(text, "startGenericLead");
    assert.equal(count(body, /\bonLead\(/), 1);
    assert.equal(count(body, /dispatchCrmEvent\(\{ type: "lead\.captured"/), 1);
    assert.equal(count(body, /eventType: "lead_captured"/), 1);
    assert.match(body, /splitTestId: updatedSession\.split_test_id \?\? null/);
    assert.match(body, /leadStageMetadata\(funnel\.calendar_provider\)/);
    // No third-party call at lead capture (decision C5).
    assert.equal(count(body, /upsertLeadContact|ensureGhlOpportunity|getFunnelGhlConfig/), 0);
  });

  it("the CRM events dispatched from lead sessions are exactly captured, disqualified and qualified", () => {
    const types = [...text.matchAll(/dispatchCrmEvent\(\{\s*type: "([a-z.]+)"/g)].map((match) => match[1]).sort();
    assert.deepEqual(types, ["lead.captured", "lead.disqualified", "lead.qualified"]);
  });

  it("answers: disqualified and qualified events are sent only for non-GoHighLevel calendars", () => {
    const body = functionBody(text, "submitLeadAnswers");
    assert.match(body, /genericCalendar && !isDemoSlotModeEnabled\(\)\) \{\s*dispatchCrmEvent\(\{\s*type: "lead\.disqualified"/);
    assert.match(body, /\(funnel\.calendar_provider \?\? "ghl"\) !== "ghl" && !isDemoSlotModeEnabled\(\)\) \{\s*dispatchCrmEvent\(\{ type: "lead\.qualified"/);
    assert.equal(count(body, /onLeadStage\("disqualified_lead"/), 1);
    assert.equal(count(body, /onLeadStage\("qualified_lead"/), 1);
  });

  it("qualified and disqualified analytics carry the split test and the provider metadata", () => {
    const body = functionBody(text, "submitLeadAnswers");
    assert.match(body, /eventType: "disqualified_lead",\s*metadata: \{[^}]*\.\.\.leadStageMetadata\(funnel\.calendar_provider\)/);
    assert.match(body, /const qualifiedMetadata = leadStageMetadata\(funnel\.calendar_provider\)/);
    assert.equal(count(body, /splitTestId: (?:syncedSession|session)\.split_test_id \?\? null/), 2);
  });

  it("the GoHighLevel disqualified handoff is skipped for other calendars", () => {
    const body = functionBody(text, "submitLeadAnswers");
    assert.match(body, /genericCalendar\s*\?\s*disqualifiedSession\s*:\s*await moveDisqualifiedLeadToGhl/);
  });
});

describe("split test attribution", () => {
  it("the recorder passes the lead's split test to every analytics call, for every calendar", async () => {
    const funnel = { id: "f", tenant_id: "t", calendar_provider: "calcom" } as unknown as Funnel;
    for (const kind of GENERIC_KINDS) {
      const { deps, tracked } = fakeDeps();
      const recorder = createOutcomeRecorder(deps);
      const lead = session({ split_test_id: TEST_ID });
      await recorder.record("slots_shown", lead, funnel, { provider: kind, slotCount: 2 });
      await recorder.record("booking_error", lead, funnel, { provider: kind, phase: "slot_lookup", message: "x" });
      await recorder.record("booked", lead, funnel, { provider: kind, externalBookingId: "b1" });
      assert.equal(tracked.length, 3, kind);
      for (const row of tracked) {
        assert.equal(row.splitTestId, TEST_ID, `${kind} ${row.eventType}`);
        assert.equal((row.metadata as Record<string, unknown>).provider, kind);
      }
    }
  });

  it("the CRM event carries the running split test", () => {
    const event = buildFormBookEvent({
      type: "lead.booked",
      nowIso: "2026-12-01T15:04:05.000Z",
      funnel: { id: "f", name: "Form", slug: "form" },
      session: session({ split_test_id: TEST_ID }),
      answers: []
    });
    assert.deepEqual(event.tracking.split_test, { id: TEST_ID, variant: null });
  });

  it("the CRM event has no split test when the lead has none", () => {
    const event = buildFormBookEvent({
      type: "lead.captured",
      nowIso: "2026-12-01T15:04:05.000Z",
      funnel: { id: "f", name: "Form", slug: "form" },
      session: session({ split_test_id: null }),
      answers: []
    });
    assert.equal(event.tracking.split_test, null);
  });
});

describe("Meta booked call for Calendly when both confirmations arrive", () => {
  it("queues the booked call once: the second source sees the booked lead", async () => {
    const funnel = { id: "f", tenant_id: "t", calendar_provider: "calendly", meta_pixel_id: "1" } as unknown as Funnel;
    const { deps, calls } = fakeDeps();
    const recorder = createOutcomeRecorder(deps);
    const booking = { provider: "calendly" as const, start: "2026-12-03T14:00:00.000Z", end: "2026-12-03T14:30:00.000Z", timezone: "UTC", externalId: "i1", meetingUrl: null };
    const client = await recorder.record("booked", session(), funnel, { provider: "calendly", externalBookingId: "i1", booking });
    const webhook = await recorder.record("booked", client.session, funnel, { provider: "calendly", externalBookingId: "i1", booking });
    assert.equal(calls.filter((call) => call.startsWith("meta:booked_call")).length, 1);
    assert.equal(calls.filter((call) => call === "track:appointment_booked").length, 1);
    assert.equal(calls.filter((call) => call === "crm:lead.booked").length, 1);
    assert.equal(client.metaEvents.length, 1);
    assert.deepEqual(webhook.metaEvents, []);
  });

  it("recordCalendlyBooking stops on a duplicate invitee and re-reads the lead when no row guards it", () => {
    const body = functionBody(source("lib/connections/calendly.ts"), "recordCalendlyBooking");
    assert.match(body, /if \(existing\) return \{ attempt: null, metaEvents: \[\] \};/);
    assert.match(body, /from\("lead_sessions"\)\s*\.select\("\*"\)\s*\.eq\("id", session\.id\)\s*\.eq\("tenant_id", session\.tenant_id\)/);
    assert.match(body, /recorder\.record\("booked", session, funnel/);
  });

  it("the client fast path returns without events for a lead that is already booked", () => {
    const body = functionBody(source("lib/bookings/calendly-confirm.ts"), "confirmCalendlyFromClient");
    assert.match(body, /if \(session\.status === "booked"\) return \{ metaEvents: \[\] \};/);
  });
});
