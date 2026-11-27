import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildTestEvent } from "@/lib/crm/event-payload";
import type { FormBookEvent } from "@/lib/connections/types";
import { HUBSPOT_API_BASE, HUBSPOT_COPY, HUBSPOT_TOKEN_PATTERN } from "@/lib/hubspot/constants";
import {
  contactProperties,
  dealName,
  dealPlan,
  hubspotFormSettingsSchema,
  hubspotOutcome,
  noteBody,
  noteTitleFor,
  parseHubspotSettings,
  parsePipelines,
  parsePortalId,
  parseSearchFirstId,
  parseUpsertResponse,
  validateHubspotSettings,
  type HubspotFormSettings
} from "@/lib/hubspot/mapping";

const EM_DASH = String.fromCharCode(0x2014);

function event(overrides: Partial<FormBookEvent> = {}): FormBookEvent {
  const base = buildTestEvent("2026-12-01T15:04:05.000Z", "6f1c2a1e-0000-4000-8000-000000000001");
  return {
    ...base,
    type: "lead.captured",
    form: { id: "11111111-1111-4111-8111-111111111111", name: "Free strategy call", slug: "strategy-call" },
    lead: {
      ...base.lead,
      full_name: "Alex Example",
      first_name: "Alex",
      last_name: "Example",
      email: "Alex@Example.com",
      phone: "+14165550101"
    },
    ...overrides
  };
}

const SETTINGS: HubspotFormSettings = {
  deal_on_lead: true,
  deal_on_booked: true,
  pipeline_id: "default",
  lead_stage_id: "appointmentscheduled",
  booked_stage_id: "qualifiedtobuy",
  disqualified_stage_id: "closedlost"
};

describe("contactProperties", () => {
  it("maps standard properties and lowercases the email", () => {
    assert.deepEqual(contactProperties(event().lead), {
      email: "alex@example.com",
      firstname: "Alex",
      lastname: "Example",
      phone: "+14165550101"
    });
  });

  it("splits the full name when first and last are missing and omits empty values", () => {
    const lead = { ...event().lead, first_name: null, last_name: null, full_name: "Sam  de la Cruz", email: null, phone: "  " };
    assert.deepEqual(contactProperties(lead), { firstname: "Sam", lastname: "de la Cruz" });
  });

  it("returns nothing when nothing is known", () => {
    const lead = { ...event().lead, first_name: null, last_name: null, full_name: null, email: null, phone: null };
    assert.deepEqual(contactProperties(lead), {});
  });
});

describe("noteBody", () => {
  it("escapes HTML so answers stay text", () => {
    const body = noteBody(event({ answers: [{ key: "q", question: "Bio <b>", value: "<script>alert(1)</script>" }] }));
    assert.ok(!body.includes("<script>"));
    assert.ok(body.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
    assert.ok(body.includes("Bio &lt;b&gt;"));
  });

  it("starts with the title and carries the lead id, form, booking and tracking", () => {
    const body = noteBody(
      event({
        type: "lead.booked",
        booking: {
          provider: "calcom",
          start: "2026-12-03T14:00:00.000Z",
          end: "2026-12-03T14:30:00.000Z",
          timezone: "America/Toronto",
          booking_id: "uid1",
          meeting_url: "https://meet.example.com/x"
        }
      })
    );
    const lines = body.split("<br>");
    assert.equal(lines[0], "FormBook: call booked");
    assert.ok(lines.includes("Lead id: 6f1c2a1e-0000-4000-8000-000000000001"));
    assert.ok(lines.includes("Form: Free strategy call"));
    assert.ok(lines.some((line) => line.startsWith("Booking: 2026-12-03T14:00:00.000Z")));
    assert.ok(lines.includes("source_url: https://example.com/book"));
  });

  it("is capped at 60,000 characters", () => {
    const answers = Array.from({ length: 100 }, (_, index) => ({ key: `q${index}`, question: `Question ${index}`, value: "x".repeat(2000) }));
    assert.ok(noteBody(event({ answers })).length <= 60_000);
  });

  it("titles every event type", () => {
    assert.equal(noteTitleFor("lead.captured"), "FormBook: new lead");
    assert.equal(noteTitleFor("lead.qualified"), "FormBook: answers");
    assert.equal(noteTitleFor("lead.disqualified"), "FormBook: disqualified");
    assert.equal(noteTitleFor("lead.booked"), "FormBook: call booked");
  });
});

describe("dealPlan", () => {
  it("creates at the lead stage on capture only when switched on and no deal exists", () => {
    assert.deepEqual(dealPlan(event({ type: "lead.captured" }), SETTINGS, false), { action: "create", stageId: "appointmentscheduled" });
    assert.deepEqual(dealPlan(event({ type: "lead.captured" }), SETTINGS, true), { action: "none" });
    assert.deepEqual(dealPlan(event({ type: "lead.captured" }), { ...SETTINGS, deal_on_lead: false }, false), { action: "none" });
  });

  it("moves or creates at the booked stage on booking", () => {
    assert.deepEqual(dealPlan(event({ type: "lead.booked" }), SETTINGS, true), { action: "move", stageId: "qualifiedtobuy" });
    assert.deepEqual(dealPlan(event({ type: "lead.booked" }), SETTINGS, false), { action: "create", stageId: "qualifiedtobuy" });
    assert.deepEqual(dealPlan(event({ type: "lead.booked" }), { ...SETTINGS, deal_on_booked: false }, true), { action: "none" });
  });

  it("moves to the disqualified stage only when set and a deal exists", () => {
    assert.deepEqual(dealPlan(event({ type: "lead.disqualified" }), SETTINGS, true), { action: "move", stageId: "closedlost" });
    assert.deepEqual(dealPlan(event({ type: "lead.disqualified" }), SETTINGS, false), { action: "none" });
    assert.deepEqual(dealPlan(event({ type: "lead.disqualified" }), { ...SETTINGS, disqualified_stage_id: null }, true), { action: "none" });
  });

  it("does nothing for qualified, test, or without a pipeline", () => {
    assert.deepEqual(dealPlan(event({ type: "lead.qualified" }), SETTINGS, true), { action: "none" });
    assert.deepEqual(dealPlan(event({ type: "test.ping" }), SETTINGS, false), { action: "none" });
    assert.deepEqual(dealPlan(event({ type: "lead.booked" }), { ...SETTINGS, pipeline_id: null }, false), { action: "none" });
  });
});

describe("dealName", () => {
  it("fills the same tokens as the GoHighLevel opportunity name", () => {
    assert.equal(dealName("{{lead_name}}", event()), "Alex Example");
    assert.equal(
      dealName("{{first_name}} {{last_name}} | {{email}} | {{phone}} | {{funnel_name}} ({{funnel_slug}})", event()),
      "Alex Example | Alex@Example.com | +14165550101 | Free strategy call (strategy-call)"
    );
  });

  it("falls back to the lead name and caps at 200 characters", () => {
    assert.equal(dealName("", event()), "Alex Example");
    assert.equal(dealName("{{last_name}}", event({ lead: { ...event().lead, last_name: null } })), "Alex Example");
    assert.equal(dealName("x".repeat(300), event()).length, 200);
    const anonymous = event({ lead: { ...event().lead, full_name: null, first_name: null, last_name: null, email: null } });
    assert.equal(dealName("{{lead_name}}", anonymous), "+14165550101");
  });
});

describe("hubspotOutcome", () => {
  it("retries 429 and 5xx and fails other errors", () => {
    assert.equal(hubspotOutcome(200), "sent");
    assert.equal(hubspotOutcome(201), "sent");
    assert.equal(hubspotOutcome(429), "retry");
    assert.equal(hubspotOutcome(500), "retry");
    assert.equal(hubspotOutcome(503), "retry");
    assert.equal(hubspotOutcome(null), "retry");
    assert.equal(hubspotOutcome(400), "failed");
    assert.equal(hubspotOutcome(401), "failed");
    assert.equal(hubspotOutcome(403), "failed");
    assert.equal(hubspotOutcome(404), "failed");
  });
});

describe("hubspot settings", () => {
  it("parses with defaults and turns empty ids into null", () => {
    assert.deepEqual(parseHubspotSettings({}), {
      deal_on_lead: false,
      deal_on_booked: false,
      pipeline_id: null,
      lead_stage_id: null,
      booked_stage_id: null,
      disqualified_stage_id: null
    });
    assert.equal(parseHubspotSettings({ pipeline_id: "" }).pipeline_id, null);
    assert.equal(parseHubspotSettings(null).deal_on_lead, false);
    assert.deepEqual(parseHubspotSettings(SETTINGS), SETTINGS);
  });

  it("refuses ids with unsafe characters", () => {
    assert.equal(hubspotFormSettingsSchema.safeParse({ pipeline_id: "../x" }).success, false);
    assert.equal(hubspotFormSettingsSchema.safeParse({ lead_stage_id: "a b" }).success, false);
    assert.equal(hubspotFormSettingsSchema.safeParse({ lead_stage_id: "x".repeat(101) }).success, false);
  });

  it("validates stages against the chosen pipeline", () => {
    const pipelines = parsePipelines({
      results: [
        { id: "default", label: "Sales", stages: [{ id: "appointmentscheduled", label: "Booked" }, { id: "qualifiedtobuy", label: "Qualified" }, { id: "closedlost", label: "Lost" }] },
        { id: "123", label: "Other", stages: [{ id: "456", label: "New" }] }
      ]
    });
    assert.equal(validateHubspotSettings(SETTINGS, pipelines), true);
    assert.equal(validateHubspotSettings({ ...SETTINGS, lead_stage_id: "456" }, pipelines), false);
    assert.equal(validateHubspotSettings({ ...SETTINGS, pipeline_id: "999" }, pipelines), false);
    assert.equal(validateHubspotSettings({ ...parseHubspotSettings({}) }, pipelines), true);
  });
});

describe("hubspot parsers", () => {
  it("reads the upsert, search, object and account responses", () => {
    assert.equal(parseUpsertResponse({ status: "COMPLETE", results: [{ id: "501", properties: {} }] }), "501");
    assert.equal(parseUpsertResponse({ results: [] }), null);
    assert.equal(parseUpsertResponse({}), null);
    assert.equal(parseUpsertResponse({ results: [{ id: "../x" }] }), null);
    assert.equal(parseSearchFirstId({ total: 1, results: [{ id: "77" }] }), "77");
    assert.equal(parseSearchFirstId({ total: 0, results: [] }), null);
    assert.equal(parsePortalId({ portalId: 12345678 }), "12345678");
    assert.equal(parsePortalId({}), null);
  });

  it("drops archived pipelines and stages", () => {
    const pipelines = parsePipelines({
      results: [
        { id: "default", label: "Sales", stages: [{ id: "a", label: "A" }, { id: "b", label: "B", archived: true }] },
        { id: "old", label: "Old", archived: true, stages: [] }
      ]
    });
    assert.deepEqual(pipelines, [{ id: "default", label: "Sales", stages: [{ id: "a", label: "A" }] }]);
  });
});

describe("hubspot constants", () => {
  it("token pattern (U17)", () => {
    assert.equal(HUBSPOT_TOKEN_PATTERN.test("pat-" + "na1-11111111-2222-3333-4444-555555555555"), true);
    assert.equal(HUBSPOT_TOKEN_PATTERN.test("pat-" + "eu1-11111111-2222-3333-4444-555555555555"), true);
    assert.equal(HUBSPOT_TOKEN_PATTERN.test("cal_live_123"), false);
    assert.equal(HUBSPOT_TOKEN_PATTERN.test("pat-na1-short"), false);
    assert.equal(HUBSPOT_API_BASE, "https://api.hubapi.com");
  });

  it("HUBSPOT_COPY has no em dash", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push((value as (arg: string) => string)("1234"));
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(HUBSPOT_COPY);
    for (const value of strings) assert.ok(!value.includes(EM_DASH), value);
  });
});
