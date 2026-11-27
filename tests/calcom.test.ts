import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CALCOM_API_BASE, CALCOM_API_VERSIONS, CALCOM_COPY, CALCOM_KEY_PATTERN } from "@/lib/calcom/constants";
import {
  buildCalcomBookingBody,
  calcomAttendeeName,
  isSlotUnavailableError,
  parseCalcomBooking,
  parseCalcomEventTypes,
  parseCalcomMe,
  parseCalcomSlots
} from "@/lib/calcom/mapping";
import type { LeadIdentity } from "@/lib/connections/types";

const EM_DASH = String.fromCharCode(0x2014);

const lead: LeadIdentity = {
  externalRef: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  fullName: "Test Lead",
  firstName: "Test",
  lastName: "Lead",
  email: "test@example.com",
  phone: "+1 416 555 0100"
};

describe("parseCalcomSlots", () => {
  it("reads range objects", () => {
    const slots = parseCalcomSlots(
      {
        status: "success",
        data: {
          "2033-09-06": [{ start: "2033-09-06T09:00:00.000+02:00", end: "2033-09-06T10:00:00.000+02:00" }],
          "2033-09-05": [
            { start: "2033-09-05T10:00:00.000+02:00", end: "2033-09-05T11:00:00.000+02:00" },
            { start: "2033-09-05T09:00:00.000+02:00", end: "2033-09-05T10:00:00.000+02:00" }
          ]
        }
      },
      "America/Toronto",
      30
    );
    assert.deepEqual(slots, [
      { startTime: "2033-09-05T07:00:00.000Z", endTime: "2033-09-05T08:00:00.000Z", timezone: "America/Toronto" },
      { startTime: "2033-09-05T08:00:00.000Z", endTime: "2033-09-05T09:00:00.000Z", timezone: "America/Toronto" },
      { startTime: "2033-09-06T07:00:00.000Z", endTime: "2033-09-06T08:00:00.000Z", timezone: "America/Toronto" }
    ]);
  });

  it("reads plain strings with the fallback length, drops invalid entries and duplicates", () => {
    const slots = parseCalcomSlots(
      {
        data: {
          "2033-09-05": ["2033-09-05T09:00:00.000Z", "not a time", 42, null, { start: "2033-09-05T09:00:00.000Z" }, { end: "x" }],
          bad: "nope"
        }
      },
      "UTC",
      45
    );
    assert.deepEqual(slots, [{ startTime: "2033-09-05T09:00:00.000Z", endTime: "2033-09-05T09:45:00.000Z", timezone: "UTC" }]);
    assert.deepEqual(parseCalcomSlots({ data: {} }, "UTC", 30), []);
    assert.deepEqual(parseCalcomSlots(null, "UTC", 30), []);
  });
});

describe("buildCalcomBookingBody", () => {
  it("builds the body with the external reference", () => {
    const body = buildCalcomBookingBody({ eventTypeId: 1001, slotStartIso: "2033-09-05T09:00:00.000+02:00", lead, timezone: "Europe/Paris" });
    assert.deepEqual(body, {
      start: "2033-09-05T07:00:00.000Z",
      eventTypeId: 1001,
      attendee: { name: "Test Lead", timeZone: "Europe/Paris", email: "test@example.com", phoneNumber: "+14165550100" },
      metadata: { formbook_ref: lead.externalRef }
    });
  });

  it("omits email when absent and phone unless E.164", () => {
    const body = buildCalcomBookingBody({
      eventTypeId: 1001,
      slotStartIso: "2033-09-05T07:00:00Z",
      lead: { ...lead, email: null, phone: "416-555-0100" },
      timezone: "UTC"
    });
    const attendee = body.attendee as Record<string, unknown>;
    assert.ok(!("email" in attendee));
    assert.ok(!("phoneNumber" in attendee));
  });

  it("name fallbacks", () => {
    const base = { ...lead, fullName: null, firstName: null, lastName: null, email: null, phone: null };
    assert.equal(calcomAttendeeName({ ...base, firstName: "Ada", lastName: "Byron" }), "Ada Byron");
    assert.equal(calcomAttendeeName({ ...base, email: "ada@example.com" }), "ada@example.com");
    assert.equal(calcomAttendeeName({ ...base, phone: "+14165550101" }), "+14165550101");
    assert.equal(calcomAttendeeName(base), "Guest");
  });
});

describe("Cal.com responses", () => {
  it("parses bookings", () => {
    assert.deepEqual(
      parseCalcomBooking({
        status: "success",
        data: {
          uid: "booking-uid-1",
          status: "accepted",
          location: "https://cal.example.com/video/1",
          start: "2033-09-05T07:00:00.000Z",
          end: "2033-09-05T08:00:00.000Z"
        }
      }),
      {
        uid: "booking-uid-1",
        status: "accepted",
        location: "https://cal.example.com/video/1",
        start: "2033-09-05T07:00:00.000Z",
        end: "2033-09-05T08:00:00.000Z"
      }
    );
    const pending = parseCalcomBooking({ data: [{ uid: "u2", status: "pending", start: "2033-09-05T07:00:00Z", end: "2033-09-05T08:00:00Z" }] });
    assert.equal(pending?.status, "pending");
    assert.equal(pending?.location, null);
    assert.equal(parseCalcomBooking({ data: { uid: "u3" } }), null);
    assert.equal(parseCalcomBooking({}), null);
  });

  it("parses event types", () => {
    const types = parseCalcomEventTypes({
      status: "success",
      data: [
        { id: 1001, title: "Intro call", slug: "intro", lengthInMinutes: 30, hidden: false, requiresConfirmation: false },
        { id: 1002, title: "Strategy", slug: "strategy", lengthInMinutes: 60, hidden: true, confirmationPolicy: { type: "always" } },
        { id: "bad", title: "Broken" },
        { id: 1003, length: 15 }
      ]
    });
    assert.deepEqual(types, [
      { id: 1001, title: "Intro call", slug: "intro", lengthInMinutes: 30, hidden: false, requiresConfirmation: false },
      { id: 1002, title: "Strategy", slug: "strategy", lengthInMinutes: 60, hidden: true, requiresConfirmation: true },
      { id: 1003, title: "Event type 1003", slug: "", lengthInMinutes: 15, hidden: false, requiresConfirmation: false }
    ]);
    assert.equal(parseCalcomEventTypes({ data: { eventTypes: [{ id: 7, title: "Nested" }] } })[0]?.id, 7);
    assert.deepEqual(parseCalcomEventTypes(null), []);
  });

  it("parses /v2/me", () => {
    assert.deepEqual(parseCalcomMe({ data: { id: 42, username: "demo-user", email: "x@example.com" } }), { id: 42, username: "demo-user" });
    assert.equal(parseCalcomMe({ data: { id: 0, username: "x" } }), null);
    assert.equal(parseCalcomMe({ data: { id: 3 } }), null);
  });
});

describe("Cal.com constants", () => {
  it("key pattern", () => {
    assert.ok(CALCOM_KEY_PATTERN.test("cal_live_0123456789abcdef"));
    assert.ok(!CALCOM_KEY_PATTERN.test("cal_short"));
    assert.ok(!CALCOM_KEY_PATTERN.test("pat-na1-0123456789abcdef"));
    assert.ok(!CALCOM_KEY_PATTERN.test("cal_0123456789abcdef with space"));
  });

  it("fixed base URL and versions", () => {
    assert.equal(CALCOM_API_BASE, "https://api.cal.com");
    assert.equal(CALCOM_API_VERSIONS.slots, "2024-09-04");
    assert.equal(CALCOM_API_VERSIONS.bookings, "2026-02-25");
  });

  it("slot unavailable errors", () => {
    assert.equal(isSlotUnavailableError(400, "calcom request failed (400): No available users found"), true);
    assert.equal(isSlotUnavailableError(409, "Attendee already booked this time"), true);
    assert.equal(isSlotUnavailableError(400, "This time is not available"), true);
    assert.equal(isSlotUnavailableError(400, "attendee.timeZone must be a valid zone"), false);
    assert.equal(isSlotUnavailableError(500, "not available"), false);
  });

  it("copy has no em dash", () => {
    for (const value of Object.values(CALCOM_COPY) as unknown[]) {
      const text = typeof value === "function" ? (value as (input: string) => string)("abcd") : String(value);
      assert.ok(!text.includes(EM_DASH), text);
    }
  });
});
