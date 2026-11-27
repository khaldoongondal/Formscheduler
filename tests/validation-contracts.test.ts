import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { fail, failPublic } from "@/lib/api/responses";
import { defaultContactFieldOrder, defaultContactFieldSettings } from "@/lib/funnels/contact-fields";
import { analyticsEventSchema } from "@/lib/validation/analytics";
import { bookAppointmentSchema, slotLookupSchema } from "@/lib/validation/bookings";
import {
  createFunnelSchema, ghlConnectionSchema, questionSchema, updateFunnelSchema, updateGhlConnectionSchema,
  updateQuestionSchema
} from "@/lib/validation/funnels";
import { startLeadSessionSchema, submitAnswersSchema } from "@/lib/validation/lead-sessions";

// Existing seeded rows use PostgreSQL UUIDs with no version or variant bits.
const id = "10000000-0000-0000-0000-000000000001";

describe("validation contracts", () => {
  it("sets defaults on form creation and only returns supplied fields for a patch", () => {
    const form = createFunnelSchema.parse({
      tenant_id: id, name: "Test form", slug: "test-form",
      theme: { primary_color: "#ffffff", accent_color: "#000000", button_color: "#000000", border_radius: "4" }
    });
    assert.equal(form.slot_duration_minutes, 30);
    assert.equal(form.theme.border_radius, 4);
    assert.equal(form.theme.logo_alignment, "left");
    assert.deepEqual(form.contact_fields, defaultContactFieldSettings);
    assert.deepEqual(form.contact_field_order, defaultContactFieldOrder);

    const update = { id, browser_tracking: { gtm_container_id: "GTM-ABCDE" } };
    assert.deepEqual(updateFunnelSchema.parse(update), update);
    assert.deepEqual(updateFunnelSchema.parse({ id, phone_pulse_enabled: false }), { id, phone_pulse_enabled: false });
  });

  it("keeps question and CRM connection creation defaults out of partial edits", () => {
    const question = questionSchema.parse({
      tenant_id: id, funnel_id: id, stable_key: "size", label: "Size", question_type: "text", display_order: "1"
    });
    assert.equal(question.is_required, true);
    assert.deepEqual(updateQuestionSchema.parse({ id, label: "Job size" }), { id, label: "Job size" });
    const connection = ghlConnectionSchema.parse({ tenant_id: id, name: "CRM", location_id: "site" });
    assert.equal(connection.is_active, true);
    assert.equal(connection.api_version, "2023-02-21");
    const update = { id, tenant_id: id, name: "Renamed CRM" };
    assert.deepEqual(updateGhlConnectionSchema.parse(update), update);
  });

  it("accepts legacy IDs and preserves URL strings, answer lists and analytics metadata", () => {
    const source_url = " https://example.org/?utm_content=sample%20campaign ";
    const lead = { funnel_id: id, email: "person@example.org", source_url };
    assert.deepEqual(startLeadSessionSchema.parse(lead), lead);
    const answers = { lead_session_id: id, answers: [{ question_id: id, value: ["Red", "Blue"] }] };
    assert.deepEqual(submitAnswersSchema.parse(answers), answers);
    const event = { funnel_id: id, event_type: "form_start", metadata: { contact_fields: ["email"], total: 1 } };
    assert.deepEqual(analyticsEventSchema.parse(event), event);
  });

  it("retains submitted booking times with minute precision or compact offsets", () => {
    const booking = {
      lead_session_id: id, timezone: "America/Toronto",
      slot_start: "2026-11-27T09:30-0500", slot_end: "2026-11-27T10:00:00-0500"
    };
    assert.deepEqual(bookAppointmentSchema.parse(booking), booking);
    assert.equal(bookAppointmentSchema.safeParse({ ...booking, slot_start: "2026-11-27T09:30" }).success, false);
  });

  it("returns the established public and admin validation responses", async () => {
    const result = startLeadSessionSchema.safeParse({ funnel_id: id });
    assert.equal(result.success, false);
    const message = "Email or phone is required.";
    const publicResponse = failPublic(result.error);
    assert.equal(publicResponse.status, 422);
    assert.deepEqual(await publicResponse.json(), { error: message });
    const adminResponse = fail(result.error);
    assert.equal(adminResponse.status, 422);
    assert.deepEqual(await adminResponse.json(), {
      error: message, details: { formErrors: [], fieldErrors: { email: [message] } }
    });
  });

  it("retains the API error text for a missing required field", async () => {
    const result = slotLookupSchema.safeParse({ lead_session_id: id });
    assert.equal(result.success, false);
    assert.deepEqual(await failPublic(result.error).json(), { error: "Required" });
    assert.deepEqual(await fail(result.error).json(), {
      error: "Required", details: { formErrors: [], fieldErrors: { timezone: ["Required"] } }
    });
  });
});
