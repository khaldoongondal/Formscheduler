import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { META_EVENT_DEFS, isEventEnabled, type PixelSwitches } from "@/lib/meta/events";
import { consentAnswerForLead, decideEnqueue, leadConsentValue, type GateInput } from "@/lib/meta/gating";

const ALL_ON: PixelSwitches = {
  send_form_view: true,
  send_form_start: true,
  send_lead: true,
  send_qualified_lead: true,
  send_disqualified_lead: true,
  send_booked_call: true
};

function input(overrides: Partial<GateInput> = {}): GateInput {
  return {
    key: "lead",
    funnel: { meta_pixel_id: "pixel-1", meta_consent_confirmed_at: "2026-11-01T00:00:00Z", meta_consent_checkbox_enabled: false },
    pixel: { ...ALL_ON, sending_mode: "automatic" },
    lead: { meta_consent: null, meta_released_at: null },
    ...overrides
  };
}

describe("decideEnqueue (in order)", () => {
  it("no pixel", () => {
    assert.deepEqual(decideEnqueue(input({ funnel: { ...input().funnel, meta_pixel_id: null } })), {
      action: "none",
      reason: "no_pixel"
    });
    assert.deepEqual(decideEnqueue(input({ pixel: null })), { action: "none", reason: "no_pixel" });
  });

  it("no confirmation", () => {
    assert.deepEqual(decideEnqueue(input({ funnel: { ...input().funnel, meta_consent_confirmed_at: null } })), {
      action: "none",
      reason: "no_confirmation"
    });
  });

  it("lead declined", () => {
    assert.deepEqual(decideEnqueue(input({ lead: { meta_consent: false, meta_released_at: null } })), {
      action: "none",
      reason: "consent_declined"
    });
  });

  it("checkbox on and the lead did not tick it", () => {
    const funnel = { ...input().funnel, meta_consent_checkbox_enabled: true };
    assert.deepEqual(decideEnqueue(input({ funnel, lead: { meta_consent: null, meta_released_at: null } })), {
      action: "none",
      reason: "consent_declined"
    });
  });

  it("switch off", () => {
    assert.deepEqual(decideEnqueue(input({ pixel: { ...ALL_ON, send_lead: false, sending_mode: "automatic" } })), {
      action: "none",
      reason: "event_off"
    });
  });

  it("checkbox on and no lead yet: waits for consent", () => {
    const funnel = { ...input().funnel, meta_consent_checkbox_enabled: true };
    assert.deepEqual(decideEnqueue(input({ key: "form_view", funnel, lead: null })), {
      action: "enqueue",
      status: "awaiting_consent"
    });
  });

  it("hold mode: held", () => {
    assert.deepEqual(decideEnqueue(input({ pixel: { ...ALL_ON, sending_mode: "hold" } })), {
      action: "enqueue",
      status: "held"
    });
    assert.deepEqual(decideEnqueue(input({ key: "form_start", lead: null, pixel: { ...ALL_ON, sending_mode: "hold" } })), {
      action: "enqueue",
      status: "held"
    });
  });

  it("hold mode with a released lead: pending", () => {
    assert.deepEqual(
      decideEnqueue(
        input({
          pixel: { ...ALL_ON, sending_mode: "hold" },
          lead: { meta_consent: null, meta_released_at: "2026-11-02T00:00:00Z" }
        })
      ),
      { action: "enqueue", status: "pending" }
    );
  });

  it("automatic: pending, including a lead who ticked the box", () => {
    assert.deepEqual(decideEnqueue(input()), { action: "enqueue", status: "pending" });
    const funnel = { ...input().funnel, meta_consent_checkbox_enabled: true };
    assert.deepEqual(decideEnqueue(input({ funnel, lead: { meta_consent: true, meta_released_at: null } })), {
      action: "enqueue",
      status: "pending"
    });
  });
});

describe("switch defaults", () => {
  it("disqualified lead is off by default, the rest on", () => {
    assert.equal(META_EVENT_DEFS.disqualified_lead.defaultOn, false);
    for (const key of ["form_view", "form_start", "lead", "qualified_lead", "booked_call"] as const) {
      assert.equal(META_EVENT_DEFS[key].defaultOn, true);
    }
    assert.equal(isEventEnabled("disqualified_lead", { ...ALL_ON, send_disqualified_lead: false }), false);
  });
});

describe("consent answers", () => {
  it("consentAnswerForLead table", () => {
    assert.equal(consentAnswerForLead(false, null), "not_asked");
    assert.equal(consentAnswerForLead(false, true), "not_asked");
    assert.equal(consentAnswerForLead(true, true), "granted");
    assert.equal(consentAnswerForLead(true, false), "declined");
    assert.equal(consentAnswerForLead(true, null), "declined");
  });

  it("stores the answer only when the form has a pixel and shows the box", () => {
    assert.equal(leadConsentValue({ meta_pixel_id: null, meta_consent_checkbox_enabled: true }, true), null);
    assert.equal(leadConsentValue({ meta_pixel_id: "p", meta_consent_checkbox_enabled: false }, true), null);
    assert.equal(leadConsentValue({ meta_pixel_id: "p", meta_consent_checkbox_enabled: true }, true), true);
    assert.equal(leadConsentValue({ meta_pixel_id: "p", meta_consent_checkbox_enabled: true }, undefined), false);
  });
});
