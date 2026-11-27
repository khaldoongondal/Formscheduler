import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DELIVERIES_COPY } from "@/lib/crm/copy";
import { crmEventId } from "@/lib/crm/event-payload";
import {
  CRM_MAX_ATTEMPTS,
  CRM_SEND_TIMEOUT_MS,
  classifyHttpOutcome,
  crmRetryDelaySeconds,
  shouldStopClaiming,
  totalRetryWindowSeconds
} from "@/lib/crm/retry";

const EM_DASH = String.fromCharCode(0x2014);
const REF = "6f1c2a1e-0000-4000-8000-000000000001";

describe("crmRetryDelaySeconds", () => {
  it("doubles from 60 seconds and mirrors settle_crm_delivery", () => {
    assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(crmRetryDelaySeconds), [60, 120, 240, 480, 960, 1920, 3840]);
  });

  it("caps at 6 hours and treats bad input as the first attempt", () => {
    assert.equal(crmRetryDelaySeconds(9), 15_360);
    assert.equal(crmRetryDelaySeconds(10), 21_600);
    assert.equal(crmRetryDelaySeconds(50), 21_600);
    assert.equal(crmRetryDelaySeconds(0), 60);
    assert.equal(crmRetryDelaySeconds(-3), 60);
    assert.equal(crmRetryDelaySeconds(Number.NaN), 60);
  });

  it("7 retries over 8 attempts take about 2 hours", () => {
    assert.equal(CRM_MAX_ATTEMPTS, 8);
    assert.equal(totalRetryWindowSeconds(), 7620);
  });
});

describe("classifyHttpOutcome", () => {
  const table: Array<[number | null, "sent" | "retry" | "failed"]> = [
    [null, "retry"],
    [200, "sent"],
    [201, "sent"],
    [204, "sent"],
    [299, "sent"],
    [301, "failed"],
    [302, "failed"],
    [400, "failed"],
    [401, "failed"],
    [403, "failed"],
    [404, "failed"],
    [408, "retry"],
    [409, "failed"],
    [410, "failed"],
    [422, "failed"],
    [425, "retry"],
    [429, "retry"],
    [500, "retry"],
    [502, "retry"],
    [503, "retry"],
    [599, "retry"]
  ];
  for (const [status, expected] of table) {
    it(`${status ?? "no status"} is ${expected}`, () => assert.equal(classifyHttpOutcome(status), expected));
  }
});

describe("shouldStopClaiming", () => {
  it("stops when what is left could not fit one more send", () => {
    const budget = 45_000;
    assert.equal(shouldStopClaiming(0, 0, budget), false);
    assert.equal(shouldStopClaiming(0, budget - CRM_SEND_TIMEOUT_MS - 4001, budget), false);
    assert.equal(shouldStopClaiming(0, budget - CRM_SEND_TIMEOUT_MS - 4000, budget), true);
    assert.equal(shouldStopClaiming(1000, 50_000, budget), true);
  });
});

describe("crm event ids", () => {
  it("are stable per lead and type", () => {
    assert.equal(crmEventId("lead.captured", REF), `fbk.lead.captured.${REF}`);
    assert.equal(crmEventId("lead.qualified", REF), crmEventId("lead.qualified", REF));
    assert.notEqual(crmEventId("lead.qualified", REF), crmEventId("lead.disqualified", REF));
  });

  it("add the booking id for booked events", () => {
    const first = crmEventId("lead.booked", REF, "booking1");
    assert.equal(first, `fbk.lead.booked.${REF}.booking1`);
    assert.notEqual(first, crmEventId("lead.booked", REF, "booking2"));
  });

  it("fit the 160 character column and keep the end of a long booking id", () => {
    const inviteeA = "https://api.calendly.com/scheduled_events/AAAA1111-2222-3333-4444-555566667777/invitees/BBBB1111-2222-3333-4444-555566667777";
    const inviteeB = "https://api.calendly.com/scheduled_events/AAAA1111-2222-3333-4444-555566667777/invitees/CCCC1111-2222-3333-4444-555566667777";
    const a = crmEventId("lead.booked", REF, inviteeA);
    const b = crmEventId("lead.booked", REF, inviteeB);
    assert.ok(a.length <= 160, String(a.length));
    assert.ok(a.endsWith("BBBB1111-2222-3333-4444-555566667777"));
    assert.notEqual(a, b);
    assert.ok(crmEventId("lead.disqualified", REF, "x".repeat(500)).length <= 160);
  });
});

describe("DELIVERIES_COPY", () => {
  it("has no em dash", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push((value as (arg: string) => string)("Example"));
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(DELIVERIES_COPY);
    assert.ok(strings.length > 20);
    for (const value of strings) assert.ok(!value.includes(EM_DASH), value);
  });
});
