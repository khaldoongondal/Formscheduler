import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { webhookOutcome } from "@/lib/connections/webhook-outcome";
import { buildFormBookEvent, buildTestEvent } from "@/lib/crm/event-payload";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import {
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  WEBHOOK_SECRET_PATTERN,
  parseSignatureHeader,
  signPayload,
  verifySignature,
  webhookHeaders
} from "@/lib/webhooks/signing";
import { URL_SAFETY_MESSAGES, checkWebhookUrl, isPublicAddress } from "@/lib/webhooks/url-safety";
import type { LeadSession } from "@/lib/types/database";

const EM_DASH = String.fromCharCode(0x2014);
const SECRET = "whsec_test_secret_value_0123456789abcdef";

function rejects(url: string, message: string) {
  const result = checkWebhookUrl(url);
  assert.equal(result.ok, false, url);
  if (!result.ok) assert.equal(result.message, message, url);
}

function accepts(url: string) {
  const result = checkWebhookUrl(url);
  assert.equal(result.ok, true, url);
}

describe("checkWebhookUrl", () => {
  it("accepts public https addresses", () => {
    accepts("https://hooks.example.com/formbook");
    accepts("https://hooks.example.com:443/formbook?x=1");
    accepts("https://hooks.example.com:8080/formbook");
    accepts("https://hooks.example.com:65535/formbook");
    accepts("https://8.8.8.8/hook");
    accepts("https://[2606:4700:4700::1111]/hook");
  });

  it("needs a parseable https address", () => {
    rejects("not a url", URL_SAFETY_MESSAGES.unparseable);
    rejects("", URL_SAFETY_MESSAGES.unparseable);
    rejects("http://hooks.example.com/formbook", URL_SAFETY_MESSAGES.notHttps);
    rejects("ftp://hooks.example.com/formbook", URL_SAFETY_MESSAGES.notHttps);
  });

  it("refuses credentials in the address", () => {
    rejects("https://user:pass@hooks.example.com/formbook", URL_SAFETY_MESSAGES.credentials);
    rejects("https://user@hooks.example.com/formbook", URL_SAFETY_MESSAGES.credentials);
  });

  it("allows only 443 and ports 1024 to 65535", () => {
    rejects("https://hooks.example.com:22/formbook", URL_SAFETY_MESSAGES.port);
    rejects("https://hooks.example.com:80/formbook", URL_SAFETY_MESSAGES.port);
    rejects("https://hooks.example.com:1023/formbook", URL_SAFETY_MESSAGES.port);
    accepts("https://hooks.example.com:1024/formbook");
  });

  it("refuses local, single label and private hosts", () => {
    rejects("https://localhost/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://app.localhost/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://printer.local/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://db.internal/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://nas.lan/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://router.home.arpa/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://intranet/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://10.0.0.5/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://192.168.1.10/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://172.16.0.1/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://127.0.0.1/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://169.254.169.254/latest/meta-data", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://[::1]/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://[fe80::1]/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://[fd00::1]/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://[::ffff:10.0.0.1]/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://[64:ff9b::a00:1]/hook", URL_SAFETY_MESSAGES.notPublic);
  });

  it("refuses numeric forms of loopback that the URL parser normalises", () => {
    rejects("https://2130706433/hook", URL_SAFETY_MESSAGES.notPublic);
    rejects("https://0x7f.1/hook", URL_SAFETY_MESSAGES.notPublic);
  });

  it("refuses addresses over 2048 characters", () => {
    const long = `https://hooks.example.com/${"a".repeat(2049 - "https://hooks.example.com/".length)}`;
    assert.equal(long.length, 2049);
    rejects(long, URL_SAFETY_MESSAGES.tooLong);
  });
});

describe("isPublicAddress", () => {
  const table: Array<[string, boolean]> = [
    ["8.8.8.8", true],
    ["1.1.1.1", true],
    ["0.1.2.3", false],
    ["10.1.2.3", false],
    ["100.64.0.1", false],
    ["100.128.0.1", true],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["172.15.255.255", true],
    ["172.16.0.1", false],
    ["172.31.255.255", false],
    ["172.32.0.1", true],
    ["192.0.0.8", false],
    ["192.0.2.1", false],
    ["192.88.99.1", false],
    ["192.168.0.1", false],
    ["198.18.0.1", false],
    ["198.19.255.255", false],
    ["198.20.0.1", true],
    ["198.51.100.7", false],
    ["203.0.113.9", false],
    ["224.0.0.1", false],
    ["240.0.0.1", false],
    ["255.255.255.255", false],
    ["::", false],
    ["::1", false],
    ["fc00::1", false],
    ["fdff::1", false],
    ["fe80::1", false],
    ["febf::1", false],
    ["ff02::1", false],
    ["2001:db8::1", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["::ffff:a00:1", false],
    ["64:ff9b::a00:1", false],
    ["64:ff9b::808:808", true],
    ["2002:0a00:0001::1", false],
    ["2002:0808:0808::1", true],
    ["2606:4700:4700::1111", true],
    ["2001:4860:4860::8888", true],
    ["not-an-ip", false],
    ["", false]
  ];
  for (const [ip, expected] of table) {
    it(`${ip || "(empty)"} is ${expected ? "public" : "not public"}`, () => {
      assert.equal(isPublicAddress(ip), expected);
    });
  }
});

describe("webhook signing", () => {
  const body = JSON.stringify({ id: "fbk.test.ping.1", type: "test.ping" });

  it("matches an independent HMAC-SHA256 over timestamp.body", () => {
    const ts = 1764150000;
    const expected = createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
    assert.equal(signPayload(SECRET, ts, body), `t=${ts},v1=${expected}`);
  });

  it("verifies within the tolerance and rejects stale or future timestamps", () => {
    const ts = 1764150000;
    const header = signPayload(SECRET, ts, body);
    assert.equal(verifySignature(header, body, SECRET, ts), true);
    assert.equal(verifySignature(header, body, SECRET, ts + 300), true);
    assert.equal(verifySignature(header, body, SECRET, ts + 301), false);
    assert.equal(verifySignature(header, body, SECRET, ts - 301), false);
    assert.equal(verifySignature(header, body, SECRET, ts + 30, 10), false);
  });

  it("rejects a tampered body, a wrong secret and malformed headers", () => {
    const ts = 1764150000;
    const header = signPayload(SECRET, ts, body);
    assert.equal(verifySignature(header, `${body} `, SECRET, ts), false);
    assert.equal(verifySignature(header, body, `${SECRET}x`, ts), false);
    assert.equal(verifySignature(null, body, SECRET, ts), false);
    assert.equal(verifySignature("garbage", body, SECRET, ts), false);
    assert.equal(verifySignature(`t=${ts}`, body, SECRET, ts), false);
    assert.equal(verifySignature(`v1=${"a".repeat(64)}`, body, SECRET, ts), false);
    assert.equal(verifySignature(header, body, "", ts), false);
  });

  it("accepts any matching v1 so receivers can rotate secrets", () => {
    const ts = 1764150000;
    const oldSig = signPayload("old_secret_value_0123456789abcdef", ts, body).split("v1=")[1];
    const newSig = signPayload(SECRET, ts, body).split("v1=")[1];
    const header = `t=${ts},v1=${oldSig},v1=${newSig}`;
    assert.equal(verifySignature(header, body, SECRET, ts), true);
    assert.equal(verifySignature(header, body, "old_secret_value_0123456789abcdef", ts), true);
    assert.deepEqual(parseSignatureHeader(header)?.v1.length, 2);
  });

  it("builds the documented header set", () => {
    const headers = webhookHeaders({
      secret: SECRET,
      timestampSec: 1764150000,
      rawBody: body,
      eventType: "test.ping",
      deliveryId: "11111111-1111-4111-8111-111111111111",
      eventId: "fbk.test.ping.1"
    });
    assert.deepEqual(Object.keys(headers).sort(), [
      "Content-Type",
      "User-Agent",
      "X-FormBook-Delivery",
      "X-FormBook-Event",
      "X-FormBook-Event-Id",
      TIMESTAMP_HEADER,
      SIGNATURE_HEADER
    ].sort());
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["User-Agent"], "FormBook-Webhooks/1.0");
    assert.equal(headers[TIMESTAMP_HEADER], "1764150000");
    assert.equal(headers[SIGNATURE_HEADER], signPayload(SECRET, 1764150000, body));
    assert.ok(!JSON.stringify(headers).includes(SECRET));
  });

  it("secret pattern: 24 to 200 printable characters with no spaces", () => {
    assert.equal(WEBHOOK_SECRET_PATTERN.test("a".repeat(23)), false);
    assert.equal(WEBHOOK_SECRET_PATTERN.test("a".repeat(24)), true);
    assert.equal(WEBHOOK_SECRET_PATTERN.test("a".repeat(200)), true);
    assert.equal(WEBHOOK_SECRET_PATTERN.test("a".repeat(201)), false);
    assert.equal(WEBHOOK_SECRET_PATTERN.test(`${"a".repeat(24)} b`), false);
    assert.equal(WEBHOOK_SECRET_PATTERN.test(SECRET), true);
  });
});

describe("webhookOutcome", () => {
  it("maps statuses and errors to delivery outcomes", () => {
    assert.equal(webhookOutcome({ status: 200, bodySnippet: "ok", error: null }).outcome, "sent");
    assert.equal(webhookOutcome({ status: 204, bodySnippet: "", error: null }).summary, "HTTP 204");
    assert.equal(webhookOutcome({ status: 500, bodySnippet: "", error: null }).outcome, "retry");
    assert.equal(webhookOutcome({ status: 429, bodySnippet: "", error: null }).outcome, "retry");
    assert.equal(webhookOutcome({ status: 404, bodySnippet: "", error: null }).outcome, "failed");
    assert.equal(webhookOutcome({ status: null, bodySnippet: "", error: "timed_out" }).outcome, "retry");
    assert.equal(webhookOutcome({ status: null, bodySnippet: "", error: "timed_out" }).summary, WEBHOOK_COPY.timedOut);
    assert.equal(webhookOutcome({ status: null, bodySnippet: "", error: "blocked_address" }).outcome, "failed");
    assert.equal(webhookOutcome({ status: 302, bodySnippet: "", error: "Redirects are not followed." }).outcome, "failed");
  });

  it("strips control characters and caps the body in the summary", () => {
    const result = webhookOutcome({ status: 400, bodySnippet: `bad\u0000\u001b[31m ${"x".repeat(400)}`, error: null });
    assert.ok(!/[\u0000-\u001f]/.test(result.summary));
    assert.ok(result.summary.length <= "HTTP 400 ".length + 200);
  });
});

describe("webhook payload", () => {
  // The example on the help page (P3.8), with made-up values.
  const example = {
    id: "fbk.lead.booked.6f1c2a1e-0000-4000-8000-000000000001.fb6f1c2a1e000040008000000000000a",
    type: "lead.booked",
    version: "2026-11-26",
    created_at: "2026-12-01T15:04:05.000Z",
    form: { id: "11111111-1111-4111-8111-111111111111", name: "Free strategy call", slug: "strategy-call" },
    lead: {
      id: "6f1c2a1e-0000-4000-8000-000000000001",
      status: "booked",
      full_name: "Alex Example",
      first_name: "Alex",
      last_name: "Example",
      email: "alex@example.com",
      phone: "+14165550101",
      created_at: "2026-12-01T15:00:00.000Z"
    },
    answers: [{ key: "budget", question: "What is your monthly budget?", value: "$1,000 to $5,000" }],
    tracking: {
      source_url: "https://example.com/book",
      referrer: null,
      landing_page_url: "https://example.com/offer",
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "winter",
      utm_content: null,
      utm_term: null,
      utm_id: null,
      utm_adset: null,
      utm_adid: null,
      utm_adsetid: null,
      utm_campaignid: null,
      fbclid: null,
      gclid: null,
      ttclid: null,
      country_code: "CA",
      region: "ON",
      city: "Toronto",
      split_test: null
    },
    booking: {
      provider: "google_calendar",
      start: "2026-12-03T14:00:00.000Z",
      end: "2026-12-03T14:30:00.000Z",
      timezone: "America/Toronto",
      booking_id: "fb6f1c2a1e000040008000000000000a",
      meeting_url: "https://meet.google.com/abc-defg-hij"
    },
    disqualification: null
  };

  function keyTree(value: unknown): unknown {
    if (!value || typeof value !== "object" || Array.isArray(value)) return typeof value;
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, keyTree((value as Record<string, unknown>)[key])])
    );
  }

  function topAndNestedKeys(value: Record<string, unknown>) {
    const tree = keyTree(value) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(tree).map(([key, nested]) => [key, nested && typeof nested === "object" ? Object.keys(nested as object).sort() : "leaf"])
    );
  }

  it("has the same keys as buildFormBookEvent output", () => {
    const session = {
      id: "99999999-9999-4999-8999-999999999999",
      tenant_id: "66666666-6666-4666-8666-666666666666",
      funnel_id: "11111111-1111-4111-8111-111111111111",
      status: "booked",
      first_name: "Alex",
      last_name: "Example",
      full_name: "Alex Example",
      email: "alex@example.com",
      phone: "+14165550101",
      visitor_id: null,
      ghl_connection_id: null,
      ghl_contact_id: null,
      ghl_opportunity_id: null,
      source_url: "https://example.com/book",
      referrer: null,
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "winter",
      utm_content: null,
      utm_term: null,
      user_agent: null,
      ip_address: null,
      metadata: {},
      external_ref: "6f1c2a1e-0000-4000-8000-000000000001",
      started_at: "2026-12-01T15:00:00.000Z",
      qualified_at: null,
      slots_shown_at: null,
      booked_at: null,
      disqualified_at: null,
      abandoned_at: null,
      errored_at: null,
      created_at: "2026-12-01T15:00:00.000Z",
      updated_at: "2026-12-01T15:00:00.000Z"
    } as unknown as LeadSession;
    const built = buildFormBookEvent({
      type: "lead.booked",
      nowIso: "2026-12-01T15:04:05.000Z",
      funnel: example.form,
      session,
      answers: [],
      booking: example.booking as never
    });
    assert.deepEqual(topAndNestedKeys(built as unknown as Record<string, unknown>), topAndNestedKeys(example));
    assert.ok(!JSON.stringify(built).includes(session.id));
  });

  it("the test event uses made-up data and a test id", () => {
    const event = buildTestEvent("2026-12-01T15:04:05.000Z", "22222222-2222-4222-8222-222222222222");
    assert.equal(event.type, "test.ping");
    assert.equal(event.id, "fbk.test.ping.22222222-2222-4222-8222-222222222222");
    assert.equal(event.lead.email, "test@example.com");
    assert.deepEqual(topAndNestedKeys(event as unknown as Record<string, unknown>).tracking, topAndNestedKeys(example).tracking);
  });
});

describe("WEBHOOK_COPY", () => {
  it("has no em dash", () => {
    const values = Object.values(WEBHOOK_COPY).map((value) =>
      typeof value === "function" ? (value as (...args: unknown[]) => string)(200, "x") : String(value)
    );
    for (const value of [...values, ...Object.values(URL_SAFETY_MESSAGES)]) assert.ok(!value.includes(EM_DASH), value);
  });
});
