import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  CALENDLY_COPY,
  CALENDLY_MESSAGE_ORIGINS,
  EVENT_TYPE_URI_PATTERN,
  EVENT_URI_PATTERN,
  INVITEE_URI_PATTERN,
  SCHEDULING_URL_PATTERN,
  WEBHOOK_SUBSCRIPTION_URI_PATTERN
} from "@/lib/calendly/constants";
import { buildCalendlyEmbed } from "@/lib/calendly/embed";
import {
  isUpgradeRefusal,
  matchesLead,
  parseCalendlyInviteePayload,
  parseCurrentUser,
  parseEventResource,
  parseEventTypes,
  parseInviteeResource,
  parseSubscriptions
} from "@/lib/calendly/mapping";
import { parseCalendlySignature, verifyCalendlySignature } from "@/lib/calendly/signature";
import type { LeadIdentity } from "@/lib/connections/types";

const EM_DASH = String.fromCharCode(0x2014);
const KEY = "signing_key_example_0123456789";
const EVENT = "https://api.calendly.com/scheduled_events/EVT11111";
const INVITEE = `${EVENT}/invitees/INV22222`;
const EVENT_TYPE = "https://api.calendly.com/event_types/AAAA1111";
const REF = "6f1c2a1e-0000-4000-8000-000000000001";

function sign(body: string, t: number, key = KEY) {
  return `t=${t},v1=${createHmac("sha256", key).update(`${t}.${body}`).digest("hex")}`;
}

describe("calendly signature", () => {
  const body = JSON.stringify({ event: "invitee.created", payload: {} });
  const now = 1764150000;

  it("parses t and every v1", () => {
    assert.deepEqual(parseCalendlySignature(`t=${now},v1=${"a".repeat(64)},v1=${"B".repeat(64)}`), {
      t: now,
      v1: ["a".repeat(64), "b".repeat(64)]
    });
    assert.equal(parseCalendlySignature(""), null);
    assert.equal(parseCalendlySignature(null), null);
    assert.equal(parseCalendlySignature("t=abc,v1=zz"), null);
    assert.equal(parseCalendlySignature(`v1=${"a".repeat(64)}`), null);
    assert.equal(parseCalendlySignature(`t=${now}`), null);
  });

  it("accepts a valid signature within 3 minutes", () => {
    assert.equal(verifyCalendlySignature(sign(body, now), body, KEY, now), true);
    assert.equal(verifyCalendlySignature(sign(body, now), body, KEY, now + 180), true);
  });

  it("rejects a wrong key, stale or future timestamps and a changed body", () => {
    assert.equal(verifyCalendlySignature(sign(body, now, "other_key_value_0123456789"), body, KEY, now), false);
    assert.equal(verifyCalendlySignature(sign(body, now), body, KEY, now + 181), false);
    assert.equal(verifyCalendlySignature(sign(body, now + 181), body, KEY, now), false);
    assert.equal(verifyCalendlySignature(sign(body, now), `${body}x`, KEY, now), false);
    assert.equal(verifyCalendlySignature("garbage", body, KEY, now), false);
    assert.equal(verifyCalendlySignature(sign(body, now), body, "", now), false);
  });

  it("accepts when any of several v1 values matches", () => {
    const good = sign(body, now).split("v1=")[1];
    assert.equal(verifyCalendlySignature(`t=${now},v1=${"0".repeat(64)},v1=${good}`, body, KEY, now), true);
  });
});

describe("calendly payload parsing", () => {
  it("reads a full webhook invitee payload", () => {
    const { event, invitee } = parseCalendlyInviteePayload({
      event: "invitee.created",
      payload: {
        uri: INVITEE,
        email: "Alex@Example.com",
        name: "Alex Example",
        timezone: "America/Toronto",
        status: "active",
        tracking: { salesforce_uuid: REF, utm_source: "facebook" },
        scheduled_event: { uri: EVENT, start_time: "2026-12-03T14:00:00.000000Z", end_time: "2026-12-03T14:30:00Z", event_type: EVENT_TYPE }
      }
    });
    assert.equal(event, "invitee.created");
    assert.equal(invitee?.uri, INVITEE);
    assert.equal(invitee?.email, "alex@example.com");
    assert.equal(invitee?.eventUri, EVENT);
    assert.equal(invitee?.eventTypeUri, EVENT_TYPE);
    assert.equal(invitee?.start, "2026-12-03T14:00:00.000Z");
    assert.equal(invitee?.tracking.salesforce_uuid, REF);
    assert.equal(invitee?.tracking.utm_medium, null);
  });

  it("tolerates missing fields and rejects a bad invitee uri", () => {
    const partial = parseCalendlyInviteePayload({ event: "invitee.created", payload: { uri: INVITEE } });
    assert.equal(partial.invitee?.email, null);
    assert.equal(partial.invitee?.eventUri, null);
    assert.equal(partial.invitee?.start, null);
    assert.equal(partial.invitee?.tracking.salesforce_uuid, null);
    assert.equal(parseCalendlyInviteePayload({ event: "invitee.created", payload: { uri: "https://evil.example/x" } }).invitee, null);
    assert.deepEqual(parseCalendlyInviteePayload(null), { event: "", invitee: null });
  });

  it("reads invitee and event resources", () => {
    const invitee = parseInviteeResource({ resource: { uri: INVITEE, event: EVENT, email: "a@example.com" } });
    assert.equal(invitee?.eventUri, EVENT);
    const event = parseEventResource({
      resource: { uri: EVENT, event_type: EVENT_TYPE, status: "active", start_time: "2026-12-03T14:00:00Z", end_time: "2026-12-03T14:30:00Z" }
    });
    assert.deepEqual(event, {
      uri: EVENT,
      eventTypeUri: EVENT_TYPE,
      start: "2026-12-03T14:00:00.000Z",
      end: "2026-12-03T14:30:00.000Z",
      status: "active"
    });
    assert.equal(parseEventResource({ resource: { uri: "https://evil.example/scheduled_events/x" } }), null);
  });

  it("reads the current user, event types and subscriptions", () => {
    assert.deepEqual(
      parseCurrentUser({
        resource: { uri: "https://api.calendly.com/users/U1", name: "Alex", current_organization: "https://api.calendly.com/organizations/O1" }
      }),
      { uri: "https://api.calendly.com/users/U1", name: "Alex", organization: "https://api.calendly.com/organizations/O1" }
    );
    const types = parseEventTypes({
      collection: [
        { uri: EVENT_TYPE, name: "Intro call", scheduling_url: "https://calendly.com/example/intro", duration: 30, active: true },
        { uri: "https://evil.example/event_types/x", name: "Bad", scheduling_url: "https://calendly.com/example/bad" },
        { uri: "https://api.calendly.com/event_types/BBBB2222", name: "Bad url", scheduling_url: "https://evil.example/x" }
      ]
    });
    assert.deepEqual(types, [{ uri: EVENT_TYPE, name: "Intro call", schedulingUrl: "https://calendly.com/example/intro", duration: 30, active: true }]);
    assert.deepEqual(parseSubscriptions({ collection: [{ uri: "https://api.calendly.com/webhook_subscriptions/W1", callback_url: "https://app.example.com/x" }] }), [
      { uri: "https://api.calendly.com/webhook_subscriptions/W1", callbackUrl: "https://app.example.com/x" }
    ]);
    assert.equal(isUpgradeRefusal("calendly request failed (403): Please upgrade to a paid Calendly account"), true);
    assert.equal(isUpgradeRefusal("forbidden"), false);
  });
});

describe("matchesLead", () => {
  const invitee = parseCalendlyInviteePayload({
    event: "invitee.created",
    payload: { uri: INVITEE, email: "alex@example.com", tracking: { salesforce_uuid: REF } }
  }).invitee!;

  it("prefers the reference over the email", () => {
    assert.equal(matchesLead(invitee, { externalRef: REF, email: "alex@example.com" }), "ref");
    assert.equal(matchesLead(invitee, { externalRef: REF.toUpperCase(), email: null }), "ref");
  });

  it("falls back to a case-insensitive exact email match", () => {
    assert.equal(matchesLead(invitee, { externalRef: "00000000-0000-4000-8000-000000000000", email: "ALEX@example.com " }), "email");
    assert.equal(matchesLead(invitee, { externalRef: "00000000-0000-4000-8000-000000000000", email: "alex@example.co" }), null);
    assert.equal(matchesLead(invitee, { externalRef: "00000000-0000-4000-8000-000000000000", email: null }), null);
  });
});

describe("uri guards", () => {
  it("accept only Calendly API uris", () => {
    assert.equal(INVITEE_URI_PATTERN.test(INVITEE), true);
    assert.equal(EVENT_URI_PATTERN.test(EVENT), true);
    assert.equal(EVENT_TYPE_URI_PATTERN.test(EVENT_TYPE), true);
    assert.equal(WEBHOOK_SUBSCRIPTION_URI_PATTERN.test("https://api.calendly.com/webhook_subscriptions/W1"), true);
    for (const bad of [
      "https://evil.example/scheduled_events/EVT11111/invitees/INV22222",
      "https://api.calendly.com.evil.example/scheduled_events/EVT11111",
      "http://api.calendly.com/scheduled_events/EVT11111",
      `${EVENT}/../x`,
      `${INVITEE}?x=1`
    ]) {
      assert.equal(INVITEE_URI_PATTERN.test(bad) || EVENT_URI_PATTERN.test(bad), false, bad);
    }
    assert.equal(SCHEDULING_URL_PATTERN.test("https://calendly.com/example/intro"), true);
    assert.equal(SCHEDULING_URL_PATTERN.test("https://calendly.com.evil.example/x"), false);
    assert.deepEqual([...CALENDLY_MESSAGE_ORIGINS], ["https://calendly.com"]);
  });
});

describe("buildCalendlyEmbed", () => {
  const lead: LeadIdentity = {
    externalRef: REF,
    fullName: "Alex Example",
    firstName: "Alex",
    lastName: "Example",
    email: "alex@example.com",
    phone: "+14165550101"
  };

  it("adds UTM values, the reference and hides the banner, with no personal data in the URL", () => {
    const spec = buildCalendlyEmbed({
      schedulingUrl: "https://calendly.com/example/intro",
      lead,
      tracking: { utm_source: "face book", utm_campaign: "winter & spring", utm_medium: "", fbclid: "abc" }
    });
    const url = new URL(spec.url);
    assert.equal(url.origin + url.pathname, "https://calendly.com/example/intro");
    assert.equal(url.searchParams.get("utm_source"), "face book");
    assert.equal(url.searchParams.get("utm_campaign"), "winter & spring");
    assert.equal(url.searchParams.has("utm_medium"), false);
    assert.equal(url.searchParams.has("fbclid"), false);
    assert.equal(url.searchParams.get("salesforce_uuid"), REF);
    assert.equal(url.searchParams.get("hide_gdpr_banner"), "1");
    assert.ok(spec.url.includes("utm_campaign=winter+%26+spring"));
    assert.ok(!spec.url.includes("alex"));
    assert.ok(!spec.url.includes("Alex"));
    assert.ok(!spec.url.includes("4165550101"));
    assert.deepEqual(spec.prefill, { name: "Alex Example", email: "alex@example.com", firstName: "Alex", lastName: "Example" });
    assert.equal(spec.mode, "embed");
    assert.equal(spec.provider, "calendly");
  });

  it("caps UTM values at 255 characters and skips first/last when one is missing", () => {
    const spec = buildCalendlyEmbed({
      schedulingUrl: "https://calendly.com/example/intro",
      lead: { ...lead, lastName: null, fullName: null },
      tracking: { utm_term: "t".repeat(300) }
    });
    assert.equal(new URL(spec.url).searchParams.get("utm_term")?.length, 255);
    assert.deepEqual(spec.prefill, { name: "Alex", email: "alex@example.com" });
  });

  it("refuses a scheduling URL that is not Calendly's", () => {
    assert.throws(() => buildCalendlyEmbed({ schedulingUrl: "https://evil.example/x", lead, tracking: {} }));
  });
});

describe("CALENDLY_COPY", () => {
  it("has no em dash", () => {
    const strings: string[] = [];
    const walk = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") strings.push((value as (arg: string) => string)("Example"));
      else if (value && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk(CALENDLY_COPY);
    for (const value of strings) assert.ok(!value.includes(EM_DASH), value);
  });
});
