import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { META_GRAPH_API_VERSION } from "@/lib/meta/constants";
import { META_EVENT_DEFS, META_EVENT_KEYS, buildMetaEventId } from "@/lib/meta/events";
import { buildFbc, fbclidFromFbc, isUsableClickTime, resolveFbc } from "@/lib/meta/fbc";
import {
  buildMetaRequestBody,
  buildMetaServerEvent,
  metaEventsUrl,
  pickEventSourceUrl
} from "@/lib/meta/payload";
import { describeMetaResult, summarizeMetaResponse } from "@/lib/meta/response";

const NOW = Date.UTC(2026, 10, 20, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

describe("buildFbc", () => {
  it("builds from a real click time", () => {
    assert.equal(buildFbc("AbC123", 1700000000000), "fb.1.1700000000000.AbC123");
  });
  it("returns null without a usable time or click id", () => {
    assert.equal(buildFbc("AbC123"), null);
    assert.equal(buildFbc("AbC123", null), null);
    assert.equal(buildFbc("AbC123", 0), null);
    assert.equal(buildFbc("AbC123", Number.NaN), null);
    assert.equal(buildFbc("AbC123", Number.POSITIVE_INFINITY), null);
    assert.equal(buildFbc("", 1700000000000), null);
  });
});

describe("fbclidFromFbc", () => {
  it("keeps dots inside the click id", () => {
    assert.equal(fbclidFromFbc("fb.1.1700000000000.Ab.Cd.Ef"), "Ab.Cd.Ef");
  });
  it("rejects bad shapes", () => {
    assert.equal(fbclidFromFbc("fb.1.17"), null);
    assert.equal(fbclidFromFbc("xx.1.1700000000000.AbC"), null);
    assert.equal(fbclidFromFbc("fb.1.1700000000000."), null);
    assert.equal(fbclidFromFbc(null), null);
  });
});

describe("resolveFbc", () => {
  it("keeps a cookie for the same click", () => {
    const cookie = "fb.1.1699999999999.Click1";
    assert.equal(resolveFbc({ fbc: cookie, fbclid: "Click1", fbclidSeenAtMs: NOW - DAY, nowMs: NOW }), cookie);
  });
  it("rebuilds a stale cookie when the click time is usable", () => {
    const seen = NOW - DAY;
    assert.equal(
      resolveFbc({ fbc: "fb.1.1699999999999.OldClick", fbclid: "NewClick", fbclidSeenAtMs: seen, nowMs: NOW }),
      `fb.1.${seen}.NewClick`
    );
  });
  it("sends nothing for a stale cookie without a click time", () => {
    assert.equal(resolveFbc({ fbc: "fb.1.1699999999999.OldClick", fbclid: "NewClick", nowMs: NOW }), null);
  });
  it("sends nothing when the cookie is missing and the click is older than 90 days", () => {
    assert.equal(resolveFbc({ fbclid: "Click1", fbclidSeenAtMs: NOW - 91 * DAY, nowMs: NOW }), null);
  });
  it("passes a cookie through when there is no fbclid", () => {
    assert.equal(resolveFbc({ fbc: " fb.1.1.Abc ", nowMs: NOW }), "fb.1.1.Abc");
    assert.equal(resolveFbc({ nowMs: NOW }), null);
  });
  it("accepts click times up to 5 minutes ahead only", () => {
    assert.equal(isUsableClickTime(NOW + 4 * 60 * 1000, NOW), true);
    assert.equal(isUsableClickTime(NOW + 6 * 60 * 1000, NOW), false);
    assert.equal(isUsableClickTime("123", NOW), false);
  });
});

describe("event ids", () => {
  it("are stable for the same input", () => {
    const ref = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    assert.equal(buildMetaEventId("lead", ref), buildMetaEventId("lead", ref));
    assert.equal(buildMetaEventId("lead", ref), `fbk1.lead.${ref}`);
    assert.notEqual(buildMetaEventId("lead", ref), buildMetaEventId("booked_call", ref));
  });
  it("reject a bad reference", () => {
    assert.throws(() => buildMetaEventId("lead", "short"));
    assert.throws(() => buildMetaEventId("lead", "has spaces in it"));
    assert.throws(() => buildMetaEventId("lead", "a".repeat(65)));
  });
});

describe("Meta event names", () => {
  it("match the documented table", () => {
    assert.deepEqual(
      META_EVENT_KEYS.map((key) => META_EVENT_DEFS[key].metaName),
      ["ViewContent", "FormStart", "Lead", "QualifiedLead", "DisqualifiedLead", "Schedule"]
    );
    assert.deepEqual(
      META_EVENT_KEYS.filter((key) => META_EVENT_DEFS[key].standard),
      ["form_view", "lead", "booked_call"]
    );
  });
});

describe("server event payload", () => {
  const leadSessionId = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
  const eventTimeMs = NOW + 789;
  const { event, matchKeys } = buildMetaServerEvent({
    key: "lead",
    eventId: buildMetaEventId("lead", leadSessionId),
    eventTimeMs,
    sourceUrl: "https://forms.example.com/embed/form-a",
    landingPageUrl: "https://www.example.com/offer?fbclid=Click1",
    user: { email: "lead@example.com", phone: "+14165550101", clientIp: "203.0.113.7", userAgent: "Mozilla/5.0" },
    fbclid: "Click1",
    fbclidSeenAtMs: NOW - DAY,
    nowMs: NOW
  });

  it("has exactly the Meta keys", () => {
    assert.deepEqual(Object.keys(event).sort(), [
      "action_source",
      "event_id",
      "event_name",
      "event_source_url",
      "event_time",
      "user_data"
    ]);
    assert.equal(event.action_source, "website");
    assert.equal(event.event_name, "Lead");
    assert.equal(event.event_time, Math.floor(eventTimeMs / 1000));
    assert.equal(event.event_source_url, "https://www.example.com/offer?fbclid=Click1");
  });

  it("builds fbc from the click but never sends the raw fbclid field", () => {
    assert.equal(event.user_data.fbc, `fb.1.${NOW - DAY}.Click1`);
    assert.ok(matchKeys.includes("fbc"));
    assert.equal(JSON.stringify(event).includes('"fbclid"'), false);
  });

  it("test events are ViewContent", () => {
    const test = buildMetaServerEvent({
      key: "test_event",
      eventId: buildMetaEventId("test_event", "3f2504e0-4f89-11d3-9a0c-0305e82c3302"),
      eventTimeMs: NOW,
      user: {},
      nowMs: NOW
    });
    assert.equal(test.event.event_name, "ViewContent");
    assert.equal("event_source_url" in test.event, false);
  });
});

describe("pickEventSourceUrl", () => {
  it("prefers an https landing page", () => {
    assert.equal(pickEventSourceUrl("https://www.example.com/a", "https://forms.example.com/b"), "https://www.example.com/a");
  });
  it("ignores javascript: and junk", () => {
    assert.equal(pickEventSourceUrl("javascript:alert(1)", "https://forms.example.com/b"), "https://forms.example.com/b");
    assert.equal(pickEventSourceUrl("not a url", null), undefined);
  });
  it("caps the length", () => {
    const long = `https://www.example.com/${"a".repeat(3000)}`;
    assert.equal(pickEventSourceUrl(long)!.length, 2048);
  });
});

describe("request body and URL", () => {
  const event = buildMetaServerEvent({
    key: "form_view",
    eventId: "fbk1.form_view.page-load-0001",
    eventTimeMs: NOW,
    user: {},
    nowMs: NOW
  }).event;

  it("includes test_event_code only when set", () => {
    assert.equal("test_event_code" in buildMetaRequestBody([event], "token-value-example-0001"), false);
    assert.equal("test_event_code" in buildMetaRequestBody([event], "token-value-example-0001", ""), false);
    assert.equal(buildMetaRequestBody([event], "token-value-example-0001", "TEST123").test_event_code, "TEST123");
    assert.equal(buildMetaRequestBody([event], "token-value-example-0001").access_token, "token-value-example-0001");
  });

  it("puts the version in the URL and never the token", () => {
    const url = metaEventsUrl("123456789012345");
    assert.ok(url.includes(META_GRAPH_API_VERSION));
    assert.equal(url, `https://graph.facebook.com/${META_GRAPH_API_VERSION}/123456789012345/events`);
    assert.equal(url.includes("access_token"), false);
    assert.throws(() => metaEventsUrl("12345abc"));
    assert.throws(() => metaEventsUrl("123"));
  });
});

describe("summarizeMetaResponse", () => {
  it("keeps only known fields and caps strings", () => {
    const summary = summarizeMetaResponse({
      events_received: 1,
      fbtrace_id: "Trace1",
      messages: ["ok"],
      secret: "drop me",
      error: { message: "x".repeat(500), code: 100, error_subcode: 2, is_transient: false, type: "OAuthException", extra: 1 }
    });
    assert.deepEqual(Object.keys(summary).sort(), ["error", "events_received", "fbtrace_id", "messages"]);
    assert.equal(summary.error?.message?.length, 300);
    assert.equal("extra" in (summary.error ?? {}), false);
    assert.deepEqual(summarizeMetaResponse("junk"), {});
    assert.deepEqual(summarizeMetaResponse(null), {});
  });

  it("describes results", () => {
    assert.equal(describeMetaResult(true, 200, { events_received: 1 }), "Received by Meta (1 event)");
    assert.equal(describeMetaResult(false, 400, { error: { message: "Invalid parameter" } }), "HTTP 400: Invalid parameter");
    assert.equal(describeMetaResult(false, null, {}), "Network error");
  });
});
