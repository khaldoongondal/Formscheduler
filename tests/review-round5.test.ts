import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ALREADY_BOOKED_MESSAGE,
  BOOKED_HOLD_MS,
  holdConflict,
  publicAttempt,
  type HoldRow
} from "@/lib/bookings/booking-guard";
import { KEEP_STATUSES, createOutcomeRecorder, type OutcomeDeps } from "@/lib/bookings/outcomes";
import { isTemporaryFailure } from "@/lib/connections/calendly";
import { ProviderHttpError } from "@/lib/connections/http";
import { deliverToHubspot, type HubspotApi, type HubspotCtx } from "@/lib/connections/hubspot";
import type { FormBookEvent } from "@/lib/connections/types";
import { buildTestEvent } from "@/lib/crm/event-payload";
import { LeadStatusKeptError } from "@/lib/lead-sessions/status-guard";
import type { BookingAttempt, Funnel, LeadSession } from "@/lib/types/database";

const TENANT = "66666666-6666-4666-8666-666666666666";
const SESSION_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_SESSION = "45454545-4545-4545-8545-454545454545";
const CONNECTION = "11111111-1111-4111-8111-111111111111";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

function lead(overrides: Partial<LeadSession> = {}): LeadSession {
  return {
    id: SESSION_ID,
    tenant_id: TENANT,
    funnel_id: "f",
    status: "slots_shown",
    visitor_id: "v",
    split_test_id: null,
    ...overrides
  } as LeadSession;
}

const funnel = { id: "f", tenant_id: TENANT, calendar_provider: "google_calendar" } as unknown as Funnel;

/** A fake database row for one lead, honouring the atomic status guard like the real update. */
function statefulDeps(initial: LeadSession["status"], failures: { status?: number; track?: number } = {}) {
  let stored = lead({ status: initial });
  const calls: string[] = [];
  const left = { status: failures.status ?? 0, track: failures.track ?? 0 };
  const deps: OutcomeDeps = {
    async updateStatus(_id, status, options) {
      if (left.status > 0) {
        left.status -= 1;
        throw new Error("transient");
      }
      if (options && options.unlessStatusIn.includes(stored.status)) throw new LeadStatusKeptError();
      stored = { ...stored, status };
      calls.push(`status:${status}`);
      return stored;
    },
    async trackEvent(input) {
      if (left.track > 0) {
        left.track -= 1;
        throw new Error("transient");
      }
      calls.push(`track:${input.eventType}`);
      return {};
    },
    async onLeadStage(key) {
      calls.push(`meta:${key}`);
      return null;
    },
    dispatchCrmEvent(input) {
      calls.push(`crm:${input.type}`);
    }
  };
  return { deps, calls, current: () => stored };
}

describe("public booking response", () => {
  it("keeps provider ids, payloads and the connection id on the server", () => {
    const attempt = {
      id: "a1",
      tenant_id: TENANT,
      funnel_id: "f",
      lead_session_id: SESSION_ID,
      status: "booked",
      slot_start: "2026-12-01T15:00:00Z",
      slot_end: "2026-12-01T15:30:00Z",
      timezone: "America/Toronto",
      calendar_connection_id: CONNECTION,
      external_booking_id: "google-event-id",
      meeting_url: "https://meet.example.com/x",
      ghl_contact_id: "c",
      ghl_opportunity_id: "o",
      ghl_calendar_id: "cal",
      ghl_appointment_id: "appt",
      request_payload: { lead_session_id: SESSION_ID },
      response_payload: { htmlLink: "https://calendar.example.com/event" }
    } as unknown as BookingAttempt;
    const shown = publicAttempt(attempt);
    assert.deepEqual(Object.keys(shown ?? {}).sort(), ["id", "slot_end", "slot_start", "status", "timezone"]);
    const text = JSON.stringify(shown);
    for (const secret of [CONNECTION, "google-event-id", "htmlLink", TENANT, SESSION_ID, "appt"]) {
      assert.ok(!text.includes(secret), secret);
    }
  });

  it("the booking route sends only the allow-listed attempt", () => {
    const text = source("app", "api", "bookings", "route.ts");
    assert.match(text, /attempt: publicAttempt\(attempt\)/);
    assert.doesNotMatch(text, /ok\(\{ attempt,/);
  });
});

describe("booked lead guard on the slots path", () => {
  const text = source("lib", "bookings", "generic-path.ts");

  it("slot lookup and booking refuse a lead that is already booked", () => {
    assert.equal((text.match(/session\.status === "booked"\) throw new PublicError\(ALREADY_BOOKED_MESSAGE, 409\)/g) ?? []).length, 2);
    assert.ok(ALREADY_BOOKED_MESSAGE.length > 0);
  });

  it("slots shown never overwrites booked or disqualified", async () => {
    assert.deepEqual(KEEP_STATUSES.slots_shown, ["booked", "disqualified"]);
    const { deps, calls, current } = statefulDeps("booked");
    // The caller's copy is stale (read before the booking finished).
    await createOutcomeRecorder(deps).record("slots_shown", lead({ status: "qualified" }), funnel, {
      provider: "google_calendar",
      slotCount: 3
    });
    assert.equal(current().status, "booked");
    assert.deepEqual(calls, []);
  });
});

describe("booked is recorded once, atomically", () => {
  it("two racing records with stale sessions send one Meta event and one CRM event", async () => {
    const { deps, calls } = statefulDeps("slots_shown");
    const recorder = createOutcomeRecorder(deps);
    const stale = lead({ status: "slots_shown" });
    await Promise.all([
      recorder.record("booked", stale, funnel, { provider: "google_calendar", externalBookingId: "b1" }),
      recorder.record("booked", stale, funnel, { provider: "google_calendar", externalBookingId: "b2" })
    ]);
    assert.equal(calls.filter((call) => call === "status:booked").length, 1);
    assert.equal(calls.filter((call) => call === "track:appointment_booked").length, 1);
    assert.equal(calls.filter((call) => call === "meta:booked_call").length, 1);
    assert.equal(calls.filter((call) => call === "crm:lead.booked").length, 1);
  });

  it("an analytics failure after the booking still sends Meta and the CRM event, and does not throw", async () => {
    const { deps, calls } = statefulDeps("slots_shown", { track: 1 });
    const result = await createOutcomeRecorder(deps).record("booked", lead(), funnel, {
      provider: "calcom",
      externalBookingId: "b1"
    });
    assert.deepEqual(calls, ["status:booked", "meta:booked_call", "crm:lead.booked"]);
    assert.equal(result.incomplete, undefined);
  });

  it("a status failure still sends Meta and the CRM event, reports incomplete, and a retry finishes once", async () => {
    const { deps, calls, current } = statefulDeps("slots_shown", { status: 1 });
    const recorder = createOutcomeRecorder(deps);
    const first = await recorder.record("booked", lead(), funnel, { provider: "calendly", externalBookingId: "inv" });
    assert.equal(first.incomplete, true);
    assert.deepEqual(calls, ["meta:booked_call", "crm:lead.booked"]);
    assert.equal(current().status, "slots_shown");

    // The retry (webhook redelivery) reads the lead again and records the booking.
    const second = await recorder.record("booked", current(), funnel, { provider: "calendly", externalBookingId: "inv" });
    assert.equal(second.incomplete, undefined);
    assert.equal(current().status, "booked");
    assert.equal(calls.filter((call) => call === "track:appointment_booked").length, 1);

    // A third delivery changes nothing.
    const third = await recorder.record("booked", current(), funnel, { provider: "calendly", externalBookingId: "inv" });
    assert.deepEqual(third.metaEvents, []);
    assert.equal(calls.filter((call) => call === "status:booked").length, 1);
  });

  it("slot lookup failures still surface (no booking exists yet)", async () => {
    const { deps } = statefulDeps("qualified", { status: 1 });
    await assert.rejects(
      createOutcomeRecorder(deps).record("slots_shown", lead({ status: "qualified" }), funnel, { provider: "calcom", slotCount: 1 })
    );
  });

  it("the generic booking path never lets the booked record turn into an error", () => {
    const text = source("lib", "bookings", "generic-path.ts");
    assert.match(text, /try \{\s*\(\{ metaEvents \} = await recorder\.record\("booked"/);
  });
});

describe("Calendly repeat confirmations finish an unfinished recording", () => {
  const text = source("lib", "connections", "calendly.ts");

  it("the existing-row branch re-reads the lead and falls through to the recorder", () => {
    assert.doesNotMatch(text, /if \(existing\) return \{ attempt: null, metaEvents: \[\] \}/);
    assert.match(text, /\.from\("lead_sessions"\)\s*\.select\("\*"\)\s*\.eq\("id", session\.id\)\s*\.eq\("tenant_id", session\.tenant_id\)/);
    assert.match(text, /if \(incomplete\) throw new Error/);
  });

  it("only temporary Calendly failures leave the setup untouched", () => {
    assert.equal(isTemporaryFailure(null), true);
    assert.equal(isTemporaryFailure(429), true);
    assert.equal(isTemporaryFailure(503), true);
    assert.equal(isTemporaryFailure(401), false);
    assert.equal(isTemporaryFailure(403), false);
    assert.equal(isTemporaryFailure(400), false);
  });

  it("the signing key is cleared only once the old subscription is gone", () => {
    const body = text.slice(text.indexOf("export async function setupCalendlyConfirmations"), text.indexOf("/** Best effort"));
    assert.match(body, /oldSubscriptionGone \? \{ signing_secret_ciphertext: null/);
    assert.match(body, /options\.temporary && !oldSubscriptionGone/);
    // A failed delete stops the setup instead of being ignored.
    assert.doesNotMatch(body, /deleteWebhookSubscription\(token, subscription\.uri\)\.catch/);
  });
});

describe("holdConflict (overlapping and buffer-adjacent bookings)", () => {
  const self: HoldRow = {
    id: "self",
    lead_session_id: SESSION_ID,
    calendar_connection_id: CONNECTION,
    slot_start: "2026-12-01T10:30:00Z",
    slot_end: "2026-12-01T11:30:00Z",
    status: "pending"
  };
  const other = (overrides: Partial<HoldRow>): HoldRow => ({
    id: "other",
    lead_session_id: OTHER_SESSION,
    calendar_connection_id: CONNECTION,
    slot_start: "2026-12-01T10:00:00Z",
    slot_end: "2026-12-01T11:00:00Z",
    status: "pending",
    ...overrides
  });

  it("an overlapping hold on the same connection yields, whatever its start time", () => {
    assert.equal(holdConflict(self, [other({})]), "slot_taken");
  });

  it("back to back is fine without buffers and a conflict with them", () => {
    const adjacent = other({ slot_start: "2026-12-01T11:30:00Z", slot_end: "2026-12-01T12:00:00Z" });
    assert.equal(holdConflict(self, [adjacent]), null);
    assert.equal(holdConflict(self, [adjacent], { beforeMs: 0, afterMs: 15 * 60_000 }), "slot_taken");
  });

  it("other connections, finished errors and itself never conflict", () => {
    assert.equal(holdConflict(self, [other({ calendar_connection_id: "x" })]), null);
    assert.equal(holdConflict(self, [other({ status: "error" })]), null);
    assert.equal(holdConflict(self, [{ ...self }]), null);
  });

  it("another lead's booked row holds its time only briefly (cancellations are not tracked)", () => {
    const now = Date.parse("2026-12-01T09:00:00Z");
    const fresh = other({ status: "booked", updated_at: new Date(now - 60_000).toISOString() });
    const old = other({ status: "booked", updated_at: new Date(now - BOOKED_HOLD_MS - 1).toISOString() });
    assert.equal(holdConflict(self, [fresh], undefined, now), "slot_taken");
    assert.equal(holdConflict(self, [old], undefined, now), null);
    assert.equal(holdConflict(self, [other({ status: "booked" })], undefined, now), null);
    // The same lead's booked row always counts, however old.
    assert.equal(holdConflict(self, [{ ...old, lead_session_id: SESSION_ID }], undefined, now), "already_booked");
  });

  it("migration 0030 never makes a booked row a permanent unique hold", () => {
    const sql = source("supabase", "migrations", "0030_calendar_booking_guard.sql");
    const unique = sql.match(/create unique index[^;]*;/gi) ?? [];
    assert.equal(unique.length, 1);
    assert.match(unique[0], /status = 'pending'/);
    assert.doesNotMatch(unique[0], /booked/);
    const generic = source("lib", "bookings", "generic-path.ts");
    assert.match(generic, /bookedHoldSince\(/);
  });

  it("a second booking for the same lead is refused", () => {
    const later = other({ lead_session_id: SESSION_ID, calendar_connection_id: "x", slot_start: "2026-12-02T10:00:00Z", slot_end: "2026-12-02T10:30:00Z" });
    assert.equal(holdConflict(self, [{ ...later, status: "booked" }]), "already_booked");
    assert.equal(holdConflict(self, [later]), "in_progress");
  });

  it("the generic path checks after its insert and before the provider call", () => {
    const text = source("lib", "bookings", "generic-path.ts");
    const insertAt = text.indexOf('.from("booking_attempts")\n    .insert(');
    const checkAt = text.indexOf("conflict = await findHoldConflict(");
    const bookAt = text.indexOf("resolved.provider.book(");
    assert.ok(insertAt > 0 && checkAt > insertAt && bookAt > checkAt);
  });
});

describe("HubSpot retries after a partial failure", () => {
  function hubspotEvent(type: FormBookEvent["type"]): FormBookEvent {
    const base = buildTestEvent("2026-12-01T15:04:05.000Z", "6f1c2a1e-0000-4000-8000-000000000001");
    return {
      ...base,
      type,
      form: { id: "11111111-1111-4111-8111-111111111111", name: "Call", slug: "call" },
      lead: { ...base.lead, full_name: "Alex Example", email: "alex@example.com" }
    };
  }
  const ctx: HubspotCtx = {
    connectionId: CONNECTION,
    token: "pat-na1-xxxxxxxxxxxxxxxxxxxxxxxx",
    settings: {
      deal_on_lead: true,
      deal_on_booked: true,
      pipeline_id: "default",
      lead_stage_id: "appointmentscheduled",
      booked_stage_id: "qualifiedtobuy",
      disqualified_stage_id: "closedlost"
    },
    dealTemplate: "{{lead_name}}"
  };

  function fakeApi(failDealAssociation: { count: number }) {
    const calls: string[] = [];
    let notes = 0;
    const api: HubspotApi = {
      async associateDefault(_token, fromType, fromId, toType, toId) {
        if (fromType === "deals" && failDealAssociation.count > 0) {
          failDealAssociation.count -= 1;
          throw new ProviderHttpError("hubspot", 502, true, "bad gateway");
        }
        calls.push(`assoc:${fromType}:${fromId}->${toType}:${toId}`);
      },
      async createContact() {
        return "c1";
      },
      async createDeal() {
        calls.push("deal:create");
        return "d1";
      },
      async createNote() {
        notes += 1;
        calls.push(`note:create:n${notes}`);
        return `n${notes}`;
      },
      async searchContactByPhone() {
        return null;
      },
      async updateContact() {},
      async updateDealStage() {
        calls.push("deal:move");
      },
      async upsertContactByEmail() {
        return "c1";
      }
    };
    return { api, calls };
  }

  it("a deal whose association failed is linked on the retry, with no extra note", async () => {
    const failing = { count: 1 };
    const { api, calls } = fakeApi(failing);
    const first = await deliverToHubspot(ctx, hubspotEvent("lead.captured"), { crmContactId: null, crmDealId: null, ghlContactId: null, ghlOpportunityId: null }, api);
    assert.equal(first.outcome, "retry");
    assert.equal(first.updates?.crmDealId, "d1");
    assert.ok(!calls.some((call) => call.startsWith("note:create")));

    const second = await deliverToHubspot(
      ctx,
      hubspotEvent("lead.captured"),
      { crmContactId: "c1", crmDealId: "d1", ghlContactId: null, ghlOpportunityId: null },
      api
    );
    assert.equal(second.outcome, "sent");
    assert.ok(calls.includes("assoc:deals:d1->contacts:c1"));
    assert.equal(calls.filter((call) => call === "deal:create").length, 1);
    assert.equal(calls.filter((call) => call.startsWith("note:create")).length, 1);
  });

  it("an event that does not touch the deal still writes the note when the deal was deleted", async () => {
    const { api, calls } = fakeApi({ count: 0 });
    const original = api.associateDefault;
    api.associateDefault = async (token, fromType, fromId, toType, toId) => {
      if (fromId === "gone") throw new ProviderHttpError("hubspot", 404, false, "not found");
      return original(token, fromType, fromId, toType, toId);
    };
    const state = { crmContactId: "c1", crmDealId: "gone", ghlContactId: null, ghlOpportunityId: null };
    // lead.captured with a deal already stored: plan "none".
    const result = await deliverToHubspot(ctx, hubspotEvent("lead.captured"), state, api);
    assert.equal(result.outcome, "sent");
    assert.equal(result.updates?.crmDealId, null);
    assert.equal(calls.filter((call) => call.startsWith("note:create")).length, 1);
    assert.ok(calls.includes("assoc:notes:n1->contacts:c1"));
    assert.ok(!calls.some((call) => call.includes("->deals:gone")));
  });

  it("a failed deal link on an untouched deal never blocks the note", async () => {
    const { api, calls } = fakeApi({ count: 5 });
    const noDealOnBooked: HubspotCtx = { ...ctx, settings: { ...ctx.settings, deal_on_booked: false } };
    const result = await deliverToHubspot(
      noDealOnBooked,
      hubspotEvent("lead.booked"),
      { crmContactId: "c1", crmDealId: "d1", ghlContactId: null, ghlOpportunityId: null },
      api
    );
    assert.equal(result.outcome, "sent");
    assert.match(result.summary, /Deal not linked to the contact/);
    assert.equal(result.updates?.crmDealId, undefined);
    assert.equal(calls.filter((call) => call.startsWith("note:create")).length, 1);
  });

  it("a failed note to deal link does not fail the delivery (no duplicate note on retry)", async () => {
    const { api, calls } = fakeApi({ count: 0 });
    const original = api.associateDefault;
    api.associateDefault = async (token, fromType, fromId, toType, toId) => {
      if (fromType === "notes" && toType === "deals") throw new ProviderHttpError("hubspot", 500, true, "x");
      return original(token, fromType, fromId, toType, toId);
    };
    const result = await deliverToHubspot(ctx, hubspotEvent("lead.booked"), { crmContactId: "c1", crmDealId: "d1", ghlContactId: null, ghlOpportunityId: null }, api);
    assert.equal(result.outcome, "sent");
    assert.match(result.summary, /not linked to the deal/);
    assert.equal(calls.filter((call) => call.startsWith("note:create")).length, 1);
  });
});
