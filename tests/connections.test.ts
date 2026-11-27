import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PICKER_INVALID_MESSAGE,
  PROVIDERS,
  parsePickerValue,
  pickerValue,
  resolvePickerChoices
} from "@/lib/connections/registry";
import {
  READINESS_COPY,
  formReadinessError,
  funnelReadinessInput,
  readinessConnectionFrom,
  type FormReadinessInput,
  type ReadinessConnection
} from "@/lib/connections/readiness";
import { CONNECTIONS_COPY, SLOT_TAKEN_MESSAGE } from "@/lib/connections/copy";
import {
  PUBLISH_NEEDS_CALENDAR_MESSAGE,
  PUBLISH_NEEDS_CONNECTION_MESSAGE,
  publishReadinessError
} from "@/lib/funnels/publish-readiness";
import { BOOKING_DESCRIPTION_CAP, OUTCOME_MESSAGE_CAP, buildBookingDescription, planOutcome } from "@/lib/bookings/outcome-plan";
import { createOutcomeRecorder, type OutcomeDeps } from "@/lib/bookings/outcomes";
import {
  EVENT_MAX_ANSWERS,
  EVENT_STRING_CAP,
  FORMBOOK_EVENT_VERSION,
  answersNoteText,
  buildFormBookEvent,
  buildTestEvent,
  crmEventId
} from "@/lib/crm/event-payload";
import { answersFromEvent, classifyGhlError, sessionLikeFromEvent } from "@/lib/connections/crm-outcome";
import type { Funnel, LeadAnswer, LeadSession, Question } from "@/lib/types/database";

const EM_DASH = String.fromCharCode(0x2014);
const CAL_ID = "11111111-1111-4111-8111-111111111111";
const CRM_ID = "22222222-2222-4222-8222-222222222222";
const GHL_ID = "33333333-3333-4333-8333-333333333333";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const EXTERNAL_REF = "6f1c2a1e-0000-4000-8000-000000000001";
const TEST_ID = "55555555-5555-4555-8555-555555555555";

function session(overrides: Partial<LeadSession> = {}): LeadSession {
  return {
    id: SESSION_ID,
    tenant_id: "66666666-6666-4666-8666-666666666666",
    funnel_id: CAL_ID,
    status: "potential",
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

function question(overrides: Partial<Question>): Question {
  return {
    id: "q",
    tenant_id: "t",
    funnel_id: "f",
    stable_key: "key",
    label: "Label",
    help_text: null,
    question_type: "text",
    placeholder: null,
    is_required: true,
    display_order: 1,
    ghl_field_key: null,
    ghl_custom_field_id: null,
    ghl_custom_field_key: null,
    conditional_logic: {},
    branching_logic: {},
    validation: {},
    created_at: "",
    updated_at: "",
    ...overrides
  };
}

function answer(q: Question, overrides: Partial<LeadAnswer>): LeadAnswer & { question?: Question } {
  return {
    id: `a-${q.id}`,
    tenant_id: "t",
    lead_session_id: SESSION_ID,
    question_id: q.id,
    question_stable_key: q.stable_key,
    answer_text: null,
    answer_number: null,
    answer_options: [],
    raw_value: null,
    created_at: "",
    updated_at: "",
    question: q,
    ...overrides
  };
}

const FUNNEL = { id: CAL_ID, name: "Free strategy call", slug: "strategy-call" };

describe("resolvePickerChoices", () => {
  it("treats an empty calendar as GoHighLevel with nothing chosen and ignores the CRM", () => {
    assert.deepEqual(resolvePickerChoices("", pickerValue("webhook", CRM_ID)), {
      ok: true,
      value: {
        calendar_provider: "ghl",
        calendar_connection_id: null,
        crm_provider: "ghl",
        crm_connection_id: null,
        ghl_connection_id: null
      }
    });
  });

  it("uses one GoHighLevel connection for both roles", () => {
    assert.deepEqual(resolvePickerChoices(pickerValue("ghl", GHL_ID), pickerValue("hubspot", CRM_ID)), {
      ok: true,
      value: {
        calendar_provider: "ghl",
        calendar_connection_id: null,
        crm_provider: "ghl",
        crm_connection_id: null,
        ghl_connection_id: GHL_ID
      }
    });
  });

  it("pairs another calendar with no CRM, GoHighLevel, HubSpot or Webhook", () => {
    const calendar = pickerValue("google_calendar", CAL_ID);
    assert.deepEqual(resolvePickerChoices(calendar, ""), {
      ok: true,
      value: {
        calendar_provider: "google_calendar",
        calendar_connection_id: CAL_ID,
        crm_provider: "ghl",
        crm_connection_id: null,
        ghl_connection_id: null
      }
    });
    assert.deepEqual(resolvePickerChoices(pickerValue("calcom", CAL_ID), pickerValue("ghl", GHL_ID)), {
      ok: true,
      value: {
        calendar_provider: "calcom",
        calendar_connection_id: CAL_ID,
        crm_provider: "ghl",
        crm_connection_id: null,
        ghl_connection_id: GHL_ID
      }
    });
    for (const crm of ["hubspot", "webhook"] as const) {
      assert.deepEqual(resolvePickerChoices(pickerValue("calendly", CAL_ID), pickerValue(crm, CRM_ID)), {
        ok: true,
        value: {
          calendar_provider: "calendly",
          calendar_connection_id: CAL_ID,
          crm_provider: crm,
          crm_connection_id: CRM_ID,
          ghl_connection_id: null
        }
      });
    }
  });

  it("refuses wrong roles, bad ids and unknown kinds", () => {
    const refused = { ok: false, message: PICKER_INVALID_MESSAGE };
    assert.deepEqual(resolvePickerChoices(pickerValue("hubspot", CRM_ID), ""), refused);
    assert.deepEqual(resolvePickerChoices(pickerValue("webhook", CRM_ID), ""), refused);
    assert.deepEqual(resolvePickerChoices(pickerValue("google_calendar", CAL_ID), pickerValue("calcom", CAL_ID)), refused);
    assert.deepEqual(resolvePickerChoices("google_calendar:not-a-uuid", ""), refused);
    assert.deepEqual(resolvePickerChoices(`outlook:${CAL_ID}`, ""), refused);
    assert.deepEqual(resolvePickerChoices(CAL_ID, ""), refused);
    assert.deepEqual(resolvePickerChoices(pickerValue("google_calendar", CAL_ID), "hubspot:"), refused);
    assert.deepEqual(resolvePickerChoices("ghl:", ""), refused);
  });

  it("parses picker values strictly", () => {
    assert.deepEqual(parsePickerValue(pickerValue("calcom", CAL_ID)), { kind: "calcom", id: CAL_ID });
    assert.equal(parsePickerValue(null), null);
    assert.equal(parsePickerValue(""), null);
    assert.equal(parsePickerValue("toString:" + CAL_ID), null);
    assert.equal(parsePickerValue(`calcom:${CAL_ID}:extra`), null);
  });

  it("starts with only GoHighLevel available", () => {
    assert.equal(PROVIDERS.ghl.available, true);
    assert.deepEqual([...PROVIDERS.ghl.roles], ["calendar", "crm"]);
  });
});

function connection(overrides: Partial<NonNullable<ReadinessConnection>> = {}): ReadinessConnection {
  return { provider: "google_calendar", status: "connected", availabilityConfirmed: true, webhookReady: false, ...overrides };
}

function genericInput(overrides: Partial<FormReadinessInput> = {}): FormReadinessInput {
  return {
    calendarProvider: "google_calendar",
    ghl: { connectionId: null, calendarId: null, connectionCalendarId: null, connectionActive: null },
    calendarConnection: connection(),
    calendarSettings: {},
    crmProvider: "webhook",
    crmConnection: connection({ provider: "webhook" }),
    crmSettings: {},
    ...overrides
  };
}

describe("formReadinessError", () => {
  it("returns exactly the old GoHighLevel results for a GoHighLevel calendar", () => {
    const cases = [
      { ghlConnectionId: null, calendarId: "cal", connectionCalendarId: null },
      { ghlConnectionId: "  ", calendarId: "cal", connectionCalendarId: null },
      { ghlConnectionId: "c1", calendarId: null, connectionCalendarId: "" },
      { ghlConnectionId: "c1", calendarId: "cal", connectionCalendarId: null },
      { ghlConnectionId: "c1", calendarId: null, connectionCalendarId: "def" }
    ];
    for (const item of cases) {
      const expected = publishReadinessError(item);
      for (const connectionActive of [true, false, null]) {
        assert.equal(
          formReadinessError({
            ...genericInput(),
            calendarProvider: "ghl",
            crmProvider: "ghl",
            ghl: {
              connectionId: item.ghlConnectionId,
              calendarId: item.calendarId,
              connectionCalendarId: item.connectionCalendarId,
              connectionActive
            }
          }),
          expected
        );
      }
    }
    assert.equal(publishReadinessError(cases[0]), PUBLISH_NEEDS_CONNECTION_MESSAGE);
    assert.equal(publishReadinessError(cases[2]), PUBLISH_NEEDS_CALENDAR_MESSAGE);
  });

  it("accepts a ready Google Calendar form that sends to a webhook", () => {
    assert.equal(formReadinessError(genericInput()), null);
  });

  it("checks the calendar connection in order", () => {
    assert.equal(formReadinessError(genericInput({ calendarConnection: null })), READINESS_COPY.needsCalendar);
    assert.equal(
      formReadinessError(genericInput({ calendarConnection: connection({ provider: "calcom" }) })),
      READINESS_COPY.needsCalendar
    );
    assert.equal(
      formReadinessError(genericInput({ calendarConnection: connection({ status: "disabled" }) })),
      READINESS_COPY.calendarDisabled
    );
    assert.equal(
      formReadinessError(genericInput({ calendarConnection: connection({ status: "needs_attention" }) })),
      READINESS_COPY.calendarNeedsAttention
    );
    assert.equal(
      formReadinessError(genericInput({ calendarConnection: connection({ availabilityConfirmed: false }) })),
      READINESS_COPY.googleHours
    );
  });

  it("asks for Calendly confirmations before reporting needs attention", () => {
    const calendly = (overrides: Partial<NonNullable<ReadinessConnection>>) =>
      genericInput({
        calendarProvider: "calendly",
        calendarConnection: connection({ provider: "calendly", ...overrides }),
        calendarSettings: { event_type_uri: "https://api.calendly.com/event_types/AAAA1111" }
      });
    assert.equal(formReadinessError(calendly({ status: "needs_attention", webhookReady: false })), READINESS_COPY.calendlyConfirmations);
    assert.equal(formReadinessError(calendly({ status: "needs_attention", webhookReady: true })), READINESS_COPY.calendarNeedsAttention);
    assert.equal(formReadinessError(calendly({ webhookReady: true })), null);
    assert.equal(
      formReadinessError({ ...calendly({ webhookReady: true }), calendarSettings: { event_type_uri: "https://evil.example/event_types/1" } }),
      READINESS_COPY.calendlyEventType
    );
    assert.equal(
      formReadinessError({ ...calendly({ webhookReady: true }), calendarSettings: { event_type_uri: "https://api.calendly.com/event_types/" } }),
      READINESS_COPY.calendlyEventType
    );
  });

  it("needs a Cal.com event type", () => {
    const calcom = (settings: Record<string, unknown>) =>
      genericInput({ calendarProvider: "calcom", calendarConnection: connection({ provider: "calcom" }), calendarSettings: settings });
    assert.equal(formReadinessError(calcom({})), READINESS_COPY.calcomEventType);
    assert.equal(formReadinessError(calcom({ event_type_id: 0 })), READINESS_COPY.calcomEventType);
    assert.equal(formReadinessError(calcom({ event_type_id: 1.5 })), READINESS_COPY.calcomEventType);
    assert.equal(formReadinessError(calcom({ event_type_id: 1001 })), null);
  });

  it("checks the CRM", () => {
    assert.equal(formReadinessError(genericInput({ crmConnection: null })), READINESS_COPY.needsCrm);
    assert.equal(formReadinessError(genericInput({ crmConnection: connection({ provider: "hubspot" }) })), READINESS_COPY.needsCrm);
    assert.equal(
      formReadinessError(genericInput({ crmConnection: connection({ provider: "webhook", status: "disabled" }) })),
      READINESS_COPY.crmDisabled
    );
    assert.equal(
      formReadinessError(genericInput({ crmConnection: connection({ provider: "webhook", status: "needs_attention" }) })),
      READINESS_COPY.crmNeedsAttention
    );
  });

  it("checks a GoHighLevel CRM behind another calendar", () => {
    const ghlCrm = (connectionId: string | null, connectionActive: boolean | null) =>
      genericInput({
        crmProvider: "ghl",
        crmConnection: null,
        ghl: { connectionId, calendarId: null, connectionCalendarId: null, connectionActive }
      });
    assert.equal(formReadinessError(ghlCrm(null, null)), READINESS_COPY.needsCrm);
    assert.equal(formReadinessError(ghlCrm(GHL_ID, false)), READINESS_COPY.ghlCrmInactive);
    assert.equal(formReadinessError(ghlCrm(GHL_ID, true)), null);
  });

  it("applies the HubSpot stage rules", () => {
    const hubspot = (settings: Record<string, unknown>) =>
      genericInput({ crmProvider: "hubspot", crmConnection: connection({ provider: "hubspot" }), crmSettings: settings });
    assert.equal(formReadinessError(hubspot({})), null);
    assert.equal(formReadinessError(hubspot({ deal_on_lead: true })), READINESS_COPY.hubspotStages);
    assert.equal(formReadinessError(hubspot({ deal_on_lead: true, pipeline_id: "p" })), READINESS_COPY.hubspotStages);
    assert.equal(formReadinessError(hubspot({ deal_on_lead: true, pipeline_id: "p", lead_stage_id: "s1" })), null);
    assert.equal(formReadinessError(hubspot({ deal_on_booked: true, pipeline_id: "p", lead_stage_id: "s1" })), READINESS_COPY.hubspotStages);
    assert.equal(formReadinessError(hubspot({ deal_on_booked: true, pipeline_id: "p", booked_stage_id: "s2" })), null);
  });

  it("builds readiness input from a form and its connections", () => {
    const input = funnelReadinessInput(
      { calendar_provider: undefined, crm_provider: undefined, ghl_connection_id: GHL_ID, calendar_id: null },
      { id: GHL_ID, calendar_id: "def", is_active: true },
      null,
      null
    );
    assert.equal(input.calendarProvider, "ghl");
    assert.equal(formReadinessError(input), null);
    assert.deepEqual(
      readinessConnectionFrom({
        provider: "calendly",
        status: "connected",
        availabilityConfirmedAt: null,
        settings: { webhook_subscription_uri: "https://api.calendly.com/webhook_subscriptions/X" }
      }),
      { provider: "calendly", status: "connected", availabilityConfirmed: false, webhookReady: true }
    );
    assert.equal(readinessConnectionFrom(null), null);
  });
});

describe("planOutcome", () => {
  it("lists the slots shown steps and leaves out a missing slot count", () => {
    assert.deepEqual(planOutcome("slots_shown", { provider: "google_calendar", slotCount: 12 }), [
      { do: "status", status: "slots_shown" },
      { do: "track", eventType: "slots_shown", metadata: { provider: "google_calendar", slot_count: 12 } }
    ]);
    assert.deepEqual(planOutcome("slots_shown", { provider: "calendly", slotCount: null }), [
      { do: "status", status: "slots_shown" },
      { do: "track", eventType: "slots_shown", metadata: { provider: "calendly" } }
    ]);
  });

  it("lists the booked steps", () => {
    assert.deepEqual(planOutcome("booked", { provider: "calcom", externalBookingId: "b1", confirmationRequired: true }), [
      { do: "status", status: "booked" },
      {
        do: "track",
        eventType: "appointment_booked",
        metadata: { provider: "calcom", booking_id: "b1", confirmation_required: true }
      },
      { do: "meta", key: "booked_call" },
      { do: "crm", type: "lead.booked" }
    ]);
    const plain = planOutcome("booked", { provider: "google_calendar", externalBookingId: "b2" });
    assert.deepEqual((plain[1] as { metadata: unknown }).metadata, { provider: "google_calendar", booking_id: "b2" });
  });

  it("records a booking error as analytics only, with the message capped", () => {
    const steps = planOutcome("booking_error", { provider: "google_calendar", phase: "slot_lookup", message: "x".repeat(900) });
    assert.equal(steps.length, 1);
    const step = steps[0] as { do: string; eventType: string; metadata: { message: string; phase: string } };
    assert.equal(step.do, "track");
    assert.equal(step.eventType, "booking_error");
    assert.equal(step.metadata.phase, "slot_lookup");
    assert.equal(step.metadata.message.length, OUTCOME_MESSAGE_CAP);
    assert.ok(!steps.some((item) => item.do === "status"));
  });
});

function fakeDeps() {
  const calls: string[] = [];
  const tracked: Array<{ splitTestId?: string | null; eventType: string }> = [];
  const dispatched: Array<{ type: string; sessionId: string }> = [];
  let current: LeadSession = session({ split_test_id: TEST_ID });
  const deps: OutcomeDeps = {
    async updateStatus(_id, status) {
      calls.push(`status:${status}`);
      current = { ...current, status };
      return current;
    },
    async trackEvent(input) {
      calls.push(`track:${input.eventType}`);
      tracked.push(input);
      return { id: "e" };
    },
    async onLeadStage(key, sessionArg) {
      calls.push(`meta:${key}:${sessionArg.status}`);
      return null;
    },
    dispatchCrmEvent(input) {
      calls.push(`crm:${input.type}`);
      dispatched.push({ type: input.type, sessionId: input.sessionId });
    }
  };
  return { deps, calls, tracked, dispatched };
}

describe("createOutcomeRecorder", () => {
  const funnel = { id: CAL_ID, tenant_id: "t", calendar_provider: "google_calendar" } as unknown as Funnel;

  it("runs the steps in order with the split test, and uses the updated session for Meta", async () => {
    const { deps, calls, tracked, dispatched } = fakeDeps();
    const recorder = createOutcomeRecorder(deps);
    const result = await recorder.record("booked", session({ split_test_id: TEST_ID }), funnel, {
      provider: "google_calendar",
      externalBookingId: "b1"
    });
    assert.deepEqual(calls, ["status:booked", "track:appointment_booked", "meta:booked_call:booked", "crm:lead.booked"]);
    assert.equal(tracked[0].splitTestId, TEST_ID);
    assert.deepEqual(dispatched, [{ type: "lead.booked", sessionId: SESSION_ID }]);
    assert.equal(result.session.status, "booked");
    assert.equal(result.metaEvents.length, 1);
  });

  it("records booked once", async () => {
    const { deps, calls } = fakeDeps();
    const recorder = createOutcomeRecorder(deps);
    const first = await recorder.record("booked", session(), funnel, { provider: "calendly", externalBookingId: "b1" });
    const second = await recorder.record("booked", first.session, funnel, { provider: "calendly", externalBookingId: "b1" });
    assert.deepEqual(second.metaEvents, []);
    assert.equal(calls.filter((call) => call.startsWith("meta:")).length, 1);
    assert.equal(calls.filter((call) => call === "crm:lead.booked").length, 1);
  });

  it("passes a null split test when the lead has none", async () => {
    const { deps, tracked, calls } = fakeDeps();
    await createOutcomeRecorder(deps).record("booking_error", session({ split_test_id: null }), funnel, {
      provider: "calcom",
      phase: "appointment_create",
      message: "slot_taken"
    });
    assert.deepEqual(calls, ["track:booking_error"]);
    assert.equal(tracked[0].splitTestId, null);
  });
});

describe("buildFormBookEvent", () => {
  const budget = question({ id: "q1", stable_key: "budget", label: "What is your monthly budget?", display_order: 2, question_type: "single_select" });
  const services = question({ id: "q2", stable_key: "services", label: "Which services?", display_order: 1, question_type: "multi_select" });
  const size = question({ id: "q3", stable_key: "team_size", label: "Team size", display_order: 3, question_type: "number" });
  const notes = question({ id: "q4", stable_key: "notes", label: "Notes", display_order: 4 });
  const answers = [
    answer(budget, { answer_options: ["$1,000 to $5,000"] }),
    answer(services, { answer_options: ["Ads"] }),
    answer(size, { answer_number: 12 }),
    answer(notes, { answer_text: "   " })
  ];

  it("never contains the session id", () => {
    const event = buildFormBookEvent({
      type: "lead.captured",
      nowIso: "2026-12-01T15:04:05.000Z",
      funnel: FUNNEL,
      session: session({ metadata: { fbclid: "abc" } }),
      answers
    });
    assert.ok(!JSON.stringify(event).includes(SESSION_ID));
    assert.equal(event.lead.id, EXTERNAL_REF);
    assert.equal(event.version, FORMBOOK_EVENT_VERSION);
    assert.equal(event.booking, null);
    assert.equal(event.disqualification, null);
  });

  it("refuses a lead without an external reference", () => {
    assert.throws(() =>
      buildFormBookEvent({ type: "lead.captured", nowIso: "x", funnel: FUNNEL, session: session({ external_ref: undefined }), answers: [] })
    );
  });

  it("orders answers by question, keeps their types and drops empty ones", () => {
    const event = buildFormBookEvent({ type: "lead.qualified", nowIso: "n", funnel: FUNNEL, session: session(), answers });
    assert.deepEqual(event.answers, [
      { key: "services", question: "Which services?", value: ["Ads"] },
      { key: "budget", question: "What is your monthly budget?", value: "$1,000 to $5,000" },
      { key: "team_size", question: "Team size", value: 12 }
    ]);
    assert.equal(
      answersNoteText(event, 1000),
      "Which services?: Ads\nWhat is your monthly budget?: $1,000 to $5,000\nTeam size: 12"
    );
    assert.equal(answersNoteText(event, 10).length, 10);
  });

  it("takes tracking from columns first, then metadata", () => {
    const event = buildFormBookEvent({
      type: "lead.captured",
      nowIso: "n",
      funnel: FUNNEL,
      session: session({
        utm_source: null,
        utm_medium: "paid",
        metadata: { utm_source: "meta-source", utm_medium: "ignored", utm_id: "7", country_code: "CA", region: "ON", city: "Toronto", landing_page_url: "https://example.com/offer" }
      }),
      answers: []
    });
    assert.equal(event.tracking.utm_source, "meta-source");
    assert.equal(event.tracking.utm_medium, "paid");
    assert.equal(event.tracking.utm_id, "7");
    assert.equal(event.tracking.country_code, "CA");
    assert.equal(event.tracking.city, "Toronto");
    assert.equal(event.tracking.landing_page_url, "https://example.com/offer");
    assert.equal(event.tracking.gclid, null);
  });

  it("prefers a running split test over the manual tag", () => {
    const manual = { split_test_id: "ghl-strategy-call", split_variant: "control" };
    const running = buildFormBookEvent({
      type: "lead.captured",
      nowIso: "n",
      funnel: FUNNEL,
      session: session({ split_test_id: TEST_ID, metadata: manual }),
      answers: []
    });
    assert.deepEqual(running.tracking.split_test, { id: TEST_ID, variant: null });
    const tagged = buildFormBookEvent({ type: "lead.captured", nowIso: "n", funnel: FUNNEL, session: session({ metadata: manual }), answers: [] });
    assert.deepEqual(tagged.tracking.split_test, { id: "ghl-strategy-call", variant: "control" });
    const none = buildFormBookEvent({ type: "lead.captured", nowIso: "n", funnel: FUNNEL, session: session(), answers: [] });
    assert.equal(none.tracking.split_test, null);
  });

  it("caps strings and the number of answers", () => {
    const many = Array.from({ length: 130 }, (_, index) =>
      answer(question({ id: `m${index}`, stable_key: `k${index}`, display_order: index }), { answer_text: "y".repeat(5000) })
    );
    const event = buildFormBookEvent({
      type: "lead.qualified",
      nowIso: "n",
      funnel: FUNNEL,
      session: session({ full_name: "z".repeat(3000) }),
      answers: many
    });
    assert.equal(event.answers.length, EVENT_MAX_ANSWERS);
    assert.equal((event.answers[0].value as string).length, EVENT_STRING_CAP);
    assert.equal(event.lead.full_name?.length, EVENT_STRING_CAP);
  });

  it("uses one event id per lead and type, and adds the booking id when booked", () => {
    const qualifiedA = buildFormBookEvent({ type: "lead.qualified", nowIso: "a", funnel: FUNNEL, session: session(), answers: [] });
    const qualifiedB = buildFormBookEvent({ type: "lead.qualified", nowIso: "b", funnel: FUNNEL, session: session(), answers: [] });
    assert.equal(qualifiedA.id, qualifiedB.id);
    assert.equal(qualifiedA.id, `fbk.lead.qualified.${EXTERNAL_REF}`);
    const booked = buildFormBookEvent({
      type: "lead.booked",
      nowIso: "n",
      funnel: FUNNEL,
      session: session({ status: "booked" }),
      answers: [],
      booking: {
        provider: "google_calendar",
        start: "2026-12-03T14:00:00.000Z",
        end: "2026-12-03T14:30:00.000Z",
        timezone: "America/Toronto",
        booking_id: "fb6f1c2a1e000040008000000000000a",
        meeting_url: "https://meet.google.com/abc-defg-hij"
      }
    });
    assert.equal(booked.id, `fbk.lead.booked.${EXTERNAL_REF}.fb6f1c2a1e000040008000000000000a`);
    assert.equal(booked.booking?.provider, "google_calendar");
    assert.equal(crmEventId("lead.captured", EXTERNAL_REF), `fbk.lead.captured.${EXTERNAL_REF}`);
  });

  it("lists disqualification reasons only for disqualified events", () => {
    const options = [{ stable_key: "budget_low", label: "Under $500", value: "under_500" }];
    const disqualified = buildFormBookEvent({
      type: "lead.disqualified",
      nowIso: "n",
      funnel: FUNNEL,
      session: session({ status: "disqualified" }),
      answers: [],
      disqualifyingOptions: options
    });
    assert.deepEqual(disqualified.disqualification, { reasons: [{ key: "budget_low", question: "Under $500", answer: "under_500" }] });
    const captured = buildFormBookEvent({ type: "lead.captured", nowIso: "n", funnel: FUNNEL, session: session(), answers: [], disqualifyingOptions: options });
    assert.equal(captured.disqualification, null);
  });

  it("builds a made-up test event", () => {
    const event = buildTestEvent("2026-12-01T00:00:00.000Z", TEST_ID);
    assert.equal(event.id, `fbk.test.ping.${TEST_ID}`);
    assert.equal(event.type, "test.ping");
    assert.equal(event.lead.email, "test@example.com");
    assert.equal(event.lead.phone, "+14165550100");
  });
});

describe("booking description", () => {
  it("has the lead details and answers but no tracking, capped", () => {
    const text = buildBookingDescription(
      { externalRef: EXTERNAL_REF, fullName: "Alex Example", firstName: "Alex", lastName: "Example", email: "alex@example.com", phone: null },
      [{ key: "budget", question: "Budget", value: "High" }]
    );
    assert.equal(text, "Booked through FormBook.\nName: Alex Example\nEmail: alex@example.com\n\nBudget: High");
    const long = buildBookingDescription(
      { externalRef: EXTERNAL_REF, fullName: null, firstName: null, lastName: null, email: null, phone: "+14165550101" },
      [{ key: "k", question: "Q", value: "v".repeat(9000) }]
    );
    assert.ok(long.length <= BOOKING_DESCRIPTION_CAP);
    assert.ok(long.startsWith("Booked through FormBook.\nPhone: +14165550101"));
  });
});

describe("GoHighLevel CRM helpers", () => {
  it("classifies GoHighLevel errors without echoing the response body", () => {
    assert.deepEqual(classifyGhlError(new Error("GHL request failed (POST /contacts/upsert): 429 secret body")), {
      outcome: "retry",
      httpStatus: 429,
      summary: "GoHighLevel returned 429."
    });
    assert.equal(classifyGhlError(new Error("GHL request failed (PUT /x): 503 down")).outcome, "retry");
    assert.equal(classifyGhlError(new Error("GHL request failed (PUT /x): 401 nope")).outcome, "failed");
    assert.equal(classifyGhlError(new Error("GHL request failed (PUT /x): 404 nope")).outcome, "failed");
    assert.equal(classifyGhlError(new Error("GHL request timed out after 15s (POST /x).")).outcome, "retry");
    assert.equal(classifyGhlError(new TypeError("fetch failed")).outcome, "retry");
    assert.ok(!classifyGhlError(new Error("GHL request failed (PUT /x): 400 token-like-value")).summary.includes("token"));
  });

  it("rebuilds a session from the event without the session id, and maps answers to questions", () => {
    const budget = question({ id: "q1", stable_key: "budget", label: "Budget", question_type: "single_select", ghl_custom_field_id: "cf1" });
    const event = buildFormBookEvent({
      type: "lead.qualified",
      nowIso: "n",
      funnel: FUNNEL,
      session: session({ metadata: { fbclid: "abc", utm_id: "9" } }),
      answers: [answer(budget, { answer_options: ["High"] })]
    });
    const like = sessionLikeFromEvent(event, { crmContactId: null, crmDealId: null, ghlContactId: "c1", ghlOpportunityId: null }, "t");
    assert.equal(like.id, EXTERNAL_REF);
    assert.equal(like.ghl_contact_id, "c1");
    assert.deepEqual(like.metadata, { utm_id: "9", fbclid: "abc" });
    const rebuilt = answersFromEvent(event, [budget], "t");
    assert.equal(rebuilt[0].question?.ghl_custom_field_id, "cf1");
    assert.deepEqual(rebuilt[0].answer_options, ["High"]);
  });
});

describe("copy", () => {
  it("has no em dash", () => {
    const texts = [
      ...Object.values(READINESS_COPY),
      ...Object.values(CONNECTIONS_COPY).map((value) => (typeof value === "function" ? value(["A", "B"]) : value)),
      SLOT_TAKEN_MESSAGE,
      PICKER_INVALID_MESSAGE
    ];
    for (const text of texts) assert.ok(!text.includes(EM_DASH), text);
  });

  it("names the forms that block a delete", () => {
    assert.equal(CONNECTIONS_COPY.deleteBlocked(["Form A", "Form B"]), "Turn off or move these forms first: Form A, Form B.");
  });
});
