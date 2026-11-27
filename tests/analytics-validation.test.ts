import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyticsEventSchema } from "@/lib/validation/analytics";
import { formReportSchema } from "@/lib/validation/form-reports";

const FUNNEL_ID = "11111111-1111-4111-8111-111111111111";

// The shape the booking flow sends today (page_view and step_view).
function realPayload(metadata: Record<string, unknown> = {}) {
  return {
    funnel_id: FUNNEL_ID,
    lead_session_id: "22222222-2222-4222-8222-222222222222",
    visitor_id: "visitor_abcdef123456",
    event_type: "step_view",
    source: "embed",
    source_url: "https://example.com/book/growth-call?utm_source=facebook",
    user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    metadata: {
      utm_source: "facebook",
      utm_campaign: "spring",
      fbclid: "IwAR0abc",
      landing_page_url: `https://example.com/landing?fbclid=${"x".repeat(900)}`,
      step_key: "contact:1:full_name,email",
      step_index: 1,
      step_type: "contact",
      step_label: "Contact: Name + Email",
      contact_fields: ["full_name", "email"],
      ...metadata
    }
  };
}

describe("analyticsEventSchema", () => {
  it("accepts the real payload shape", () => {
    assert.equal(analyticsEventSchema.safeParse(realPayload()).success, true);
  });

  it("accepts a form_start event", () => {
    assert.equal(analyticsEventSchema.safeParse({ ...realPayload(), event_type: "form_start" }).success, true);
  });

  it("accepts a uuid test id", () => {
    assert.equal(
      analyticsEventSchema.safeParse({ ...realPayload(), test_id: "33333333-3333-4333-8333-333333333333" }).success,
      true
    );
  });

  it("accepts undefined tracking params from the client", () => {
    const payload = realPayload();
    const withUndefined = { ...payload, metadata: { ...payload.metadata, gclid: undefined } };
    // JSON.stringify drops undefined, as the browser does.
    assert.equal(analyticsEventSchema.safeParse(JSON.parse(JSON.stringify(withUndefined))).success, true);
  });

  it("rejects more than 40 metadata keys", () => {
    const metadata = Object.fromEntries(Array.from({ length: 41 }, (_, index) => [`key_${index}`, "v"]));
    assert.equal(analyticsEventSchema.safeParse({ ...realPayload(), metadata }).success, false);
  });

  it("rejects a nested object value", () => {
    assert.equal(analyticsEventSchema.safeParse(realPayload({ nested: { a: 1 } })).success, false);
  });

  it("rejects a 600 character value", () => {
    assert.equal(analyticsEventSchema.safeParse(realPayload({ step_label: "x".repeat(600) })).success, false);
  });

  it("rejects metadata over 8 KB", () => {
    const metadata = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`key_${index}`, "x".repeat(460)]));
    assert.equal(analyticsEventSchema.safeParse({ ...realPayload(), metadata }).success, false);
  });

  it("rejects a 41 character source", () => {
    assert.equal(analyticsEventSchema.safeParse({ ...realPayload(), source: "x".repeat(41) }).success, false);
  });

  it("rejects bad keys and non-finite numbers", () => {
    assert.equal(analyticsEventSchema.safeParse(realPayload({ "Bad Key": "v" })).success, false);
    assert.equal(analyticsEventSchema.safeParse(realPayload({ score: Number.POSITIVE_INFINITY })).success, false);
  });
});

describe("formReportSchema", () => {
  it("accepts a minimal report", () => {
    assert.equal(formReportSchema.safeParse({ slug: "growth-call", reason: "phishing" }).success, true);
    assert.equal(
      formReportSchema.safeParse({ slug: "growth-call", reason: "spam", details: "", email: "" }).success,
      true
    );
  });

  it("rejects an unknown reason, long details and a bad email", () => {
    assert.equal(formReportSchema.safeParse({ slug: "x", reason: "rude" }).success, false);
    assert.equal(formReportSchema.safeParse({ slug: "x", reason: "spam", details: "d".repeat(1001) }).success, false);
    assert.equal(formReportSchema.safeParse({ slug: "x", reason: "spam", email: "not-an-email" }).success, false);
  });
});
