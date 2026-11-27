import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GOOGLE_SCOPES,
  GOOGLE_STATE_TTL_MS,
  buildGoogleAuthorizeUrl,
  callbackMatchesSession,
  createGoogleState,
  emailAndSubFromIdToken,
  googleEventIdFor,
  hasRequiredCalendarScopes,
  parseExtraOrigins,
  parseTokenResponse,
  resolveOauthOrigin,
  verifyGoogleState
} from "@/lib/google/oauth-core";
import {
  buildGoogleEventBody,
  eventFormbookRef,
  googleEventPath,
  ownLiveEvent,
  parseFreeBusy,
  parseGoogleEvent
} from "@/lib/google/event-mapping";
import { ProviderHttpError, isRetryableHttpStatus, redactSnippet } from "@/lib/connections/http";

const KEY = Buffer.alloc(32, 7);
const OTHER_KEY = Buffer.alloc(32, 9);
const TENANT = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-11-26T12:00:00Z");

function signedState(payload: Record<string, unknown>, key = KEY) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", key).update(encoded).digest("base64url")}`;
}

function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

describe("Google state", () => {
  it("round trips", () => {
    const { state, nonce } = createGoogleState(TENANT, KEY, NOW);
    assert.deepEqual(verifyGoogleState(state, KEY, NOW + 1000), { tenantId: TENANT, nonce });
  });

  it("expires", () => {
    const { state } = createGoogleState(TENANT, KEY, NOW);
    assert.equal(verifyGoogleState(state, KEY, NOW + GOOGLE_STATE_TTL_MS + 1), null);
  });

  it("refuses tampering and other keys", () => {
    const { state } = createGoogleState(TENANT, KEY, NOW);
    const [payload, signature] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ purpose: "google_calendar", tenant_id: "x", expires_at: NOW + 60_000, nonce: "n" })).toString("base64url");
    assert.equal(verifyGoogleState(`${forged}.${signature}`, KEY, NOW), null);
    assert.equal(verifyGoogleState(`${payload}.${signature}x`, KEY, NOW), null);
    assert.equal(verifyGoogleState(state, OTHER_KEY, NOW), null);
    assert.equal(verifyGoogleState("nodot", KEY, NOW), null);
    assert.equal(verifyGoogleState("a.b.c", KEY, NOW), null);
  });

  it("refuses other purposes and GoHighLevel states", () => {
    assert.equal(verifyGoogleState(signedState({ purpose: "other", tenant_id: TENANT, expires_at: NOW + 60_000, nonce: "n" }), KEY, NOW), null);
    // The GoHighLevel state has the same signing key and no purpose.
    assert.equal(verifyGoogleState(signedState({ tenant_id: TENANT, expires_at: NOW + 60_000, nonce: "n" }), KEY, NOW), null);
    assert.ok(verifyGoogleState(signedState({ purpose: "google_calendar", tenant_id: TENANT, expires_at: NOW + 60_000, nonce: "n" }), KEY, NOW));
  });

  it("matches nonce and tenant", () => {
    const verified = { tenantId: TENANT, nonce: "abc123" };
    assert.equal(callbackMatchesSession(verified, "abc123", TENANT), true);
    assert.equal(callbackMatchesSession(verified, "abc124", TENANT), false);
    assert.equal(callbackMatchesSession(verified, "abc", TENANT), false);
    assert.equal(callbackMatchesSession(verified, null, TENANT), false);
    assert.equal(callbackMatchesSession(verified, "abc123", "22222222-2222-4222-8222-222222222222"), false);
    assert.equal(callbackMatchesSession(verified, "abc123", null), false);
  });
});

describe("authorize URL", () => {
  it("has the offline consent parameters and minimal scopes", () => {
    const url = new URL(buildGoogleAuthorizeUrl({ clientId: "client-1", redirectUri: "https://app.example.com/api/connect/google/callback", state: "s.t" }));
    assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
    assert.equal(url.searchParams.get("client_id"), "client-1");
    assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.com/api/connect/google/callback");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
    assert.equal(url.searchParams.get("include_granted_scopes"), "false");
    assert.equal(url.searchParams.get("state"), "s.t");
    assert.equal(url.searchParams.get("scope"), GOOGLE_SCOPES.join(" "));
    assert.ok(!url.searchParams.get("scope")?.includes("calendar.readonly"));
  });
});

describe("token response", () => {
  it("parses a full response", () => {
    const parsed = parseTokenResponse(
      {
        access_token: "access-1",
        refresh_token: "refresh-1",
        expires_in: 3599,
        scope: "openid https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events.owned email",
        id_token: "a.b.c"
      },
      NOW
    );
    assert.ok(!("error" in parsed));
    if ("error" in parsed) return;
    assert.equal(parsed.accessToken, "access-1");
    assert.equal(parsed.refreshToken, "refresh-1");
    assert.equal(parsed.expiresAt, NOW + 3_599_000);
    assert.equal(parsed.idToken, "a.b.c");
    assert.equal(hasRequiredCalendarScopes(parsed.scopes), true);
  });

  it("handles a missing refresh token and error bodies", () => {
    const parsed = parseTokenResponse({ access_token: "access-1", scope: "openid" }, NOW);
    assert.ok(!("error" in parsed) && parsed.refreshToken === null && parsed.expiresAt === NOW + 3_600_000);
    assert.deepEqual(parseTokenResponse({ error: "invalid_grant", error_description: "Bad Request" }, NOW), { error: "invalid_grant" });
    assert.deepEqual(parseTokenResponse({}, NOW), { error: "invalid_response" });
    assert.deepEqual(parseTokenResponse(null, NOW), { error: "invalid_response" });
  });

  it("scope check needs both calendar scopes", () => {
    assert.equal(hasRequiredCalendarScopes(["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy"]), false);
    assert.equal(hasRequiredCalendarScopes([]), false);
  });
});

describe("id token", () => {
  it("decodes email and sub", () => {
    assert.deepEqual(emailAndSubFromIdToken(idToken({ email: "owner@example.com", sub: "1234567890" })), {
      email: "owner@example.com",
      sub: "1234567890"
    });
    assert.deepEqual(emailAndSubFromIdToken("garbage"), { email: null, sub: null });
    assert.deepEqual(emailAndSubFromIdToken(idToken({ sub: 5 })), { email: null, sub: null });
  });
});

describe("resolveOauthOrigin", () => {
  const app = "https://app.example.com";
  it("keeps the app origin and listed extra origins", () => {
    assert.deepEqual(resolveOauthOrigin(app, app, []), { origin: app, redirectFirst: false });
    assert.deepEqual(resolveOauthOrigin("https://old.example.ca", app, ["https://old.example.ca"]), {
      origin: "https://old.example.ca",
      redirectFirst: false
    });
  });

  it("sends unknown origins to the app first", () => {
    assert.deepEqual(resolveOauthOrigin("https://preview.example.dev", app, ["https://old.example.ca"]), {
      origin: app,
      redirectFirst: true
    });
  });

  it("ignores trailing slashes", () => {
    assert.deepEqual(resolveOauthOrigin(app, `${app}/`, []), { origin: app, redirectFirst: false });
    assert.deepEqual(resolveOauthOrigin("https://old.example.ca", app, ["https://old.example.ca/"]), {
      origin: "https://old.example.ca",
      redirectFirst: false
    });
    assert.deepEqual(parseExtraOrigins(" https://a.example.com, ,https://b.example.com "), ["https://a.example.com", "https://b.example.com"]);
    assert.deepEqual(parseExtraOrigins(undefined), []);
  });
});

describe("Google events", () => {
  const attemptId = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
  const lead = {
    externalRef: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    fullName: "Test Lead",
    firstName: null,
    lastName: null,
    email: "test@example.com",
    phone: "+14165550100"
  };

  const connectionId = "22222222-2222-4222-8222-222222222222";
  const eventId = googleEventIdFor({ connectionId, externalRef: lead.externalRef, slotStart: "2026-01-12T14:00:00.000Z" });

  it("event ids are base32hex and stable for the same connection, lead and start, whatever the attempt", () => {
    assert.match(eventId, /^[a-v0-9]{5,1024}$/);
    // Same instant written another way, and upper case ids: same event id.
    assert.equal(
      eventId,
      googleEventIdFor({ connectionId: connectionId.toUpperCase(), externalRef: lead.externalRef.toUpperCase(), slotStart: "2026-01-12T09:00:00-05:00" })
    );
    assert.notEqual(eventId, googleEventIdFor({ connectionId, externalRef: lead.externalRef, slotStart: "2026-01-12T14:30:00.000Z" }));
    assert.notEqual(eventId, googleEventIdFor({ connectionId, externalRef: "ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee", slotStart: "2026-01-12T14:00:00.000Z" }));
    assert.notEqual(eventId, googleEventIdFor({ connectionId: "33333333-3333-4333-8333-333333333333", externalRef: lead.externalRef, slotStart: "2026-01-12T14:00:00.000Z" }));
  });

  it("only this lead's live event counts as the existing booking", () => {
    const fallback = { slotStart: "2026-01-12T14:00:00.000Z", slotEnd: "2026-01-12T14:30:00.000Z" };
    const event = { id: eventId, status: "confirmed", extendedProperties: { private: { formbook_ref: lead.externalRef } } };
    assert.equal(ownLiveEvent(event, lead.externalRef, fallback)?.externalBookingId, eventId);
    assert.equal(ownLiveEvent({ ...event, status: "cancelled" }, lead.externalRef, fallback), null);
    assert.equal(ownLiveEvent(event, "someone-else", fallback), null);
    assert.equal(ownLiveEvent(null, lead.externalRef, fallback), null);
  });

  it("a busy time that is this lead's own event is looked up before refusing it", () => {
    const text = readFileSync(path.join(process.cwd(), "lib", "connections", "google-calendar.ts"), "utf8");
    const refuse = text.indexOf("throw new SlotTakenError()");
    assert.ok(text.indexOf("findOwnEvent(") > 0 && text.indexOf("findOwnEvent(") < refuse);
    assert.ok(!/googleEventIdFor\(\s*request\.attemptId/.test(text));
  });

  it("builds the event body", () => {
    const body = buildGoogleEventBody({
      eventId,
      attemptId,
      slotStart: "2026-01-12T14:00:00.000Z",
      slotEnd: "2026-01-12T14:30:00.000Z",
      timezone: "America/Toronto",
      lead,
      title: null,
      description: "Booked through FormBook.",
      meet: true
    });
    assert.equal(body.id, eventId);
    assert.equal(body.summary, "Call with Test Lead");
    assert.deepEqual(body.start, { dateTime: "2026-01-12T14:00:00.000Z", timeZone: "America/Toronto" });
    assert.deepEqual(body.attendees, [{ email: "test@example.com", displayName: "Test Lead" }]);
    assert.deepEqual(body.extendedProperties, { private: { formbook_ref: lead.externalRef } });
    assert.deepEqual(body.conferenceData, { createRequest: { requestId: attemptId, conferenceSolutionKey: { type: "hangoutsMeet" } } });
    assert.ok(!JSON.stringify(body).includes("+14165550100"));

    const plain = buildGoogleEventBody({
      eventId,
      attemptId,
      slotStart: "2026-01-12T14:00:00.000Z",
      slotEnd: "2026-01-12T14:30:00.000Z",
      timezone: "UTC",
      lead: { ...lead, fullName: null, email: null },
      title: "Discovery call",
      description: "",
      meet: false
    });
    assert.equal(plain.summary, "Discovery call");
    assert.deepEqual(plain.attendees, []);
    assert.equal(plain.conferenceData, undefined);
    assert.equal(googleEventPath("primary", false), "/calendars/primary/events?sendUpdates=all");
    assert.equal(googleEventPath("a b@example.com", true), "/calendars/a%20b%40example.com/events?sendUpdates=all&conferenceDataVersion=1");
  });

  it("parses events and meeting links", () => {
    const fallback = { slotStart: "2026-01-12T14:00:00.000Z", slotEnd: "2026-01-12T14:30:00.000Z" };
    const parsed = parseGoogleEvent(
      {
        id: "fbabc",
        status: "confirmed",
        htmlLink: "https://calendar.google.com/event?eid=1",
        hangoutLink: "https://meet.google.com/abc-defg-hij",
        start: { dateTime: "2026-01-12T09:00:00-05:00" },
        end: { dateTime: "2026-01-12T09:30:00-05:00" },
        extendedProperties: { private: { formbook_ref: "ref-1" } }
      },
      fallback
    );
    assert.equal(parsed?.externalBookingId, "fbabc");
    assert.equal(parsed?.meetingUrl, "https://meet.google.com/abc-defg-hij");
    assert.equal(parsed?.startTime, "2026-01-12T14:00:00.000Z");
    assert.deepEqual(Object.keys(parsed?.raw ?? {}).sort(), ["hangoutLink", "htmlLink", "id", "status"]);
    const video = parseGoogleEvent(
      { id: "x1", conferenceData: { entryPoints: [{ entryPointType: "phone", uri: "tel:+1" }, { entryPointType: "video", uri: "https://meet.example.com/v" }] } },
      fallback
    );
    assert.equal(video?.meetingUrl, "https://meet.example.com/v");
    assert.equal(video?.endTime, fallback.slotEnd);
    assert.equal(parseGoogleEvent({ id: "x2", hangoutLink: "http://insecure.example.com" }, fallback)?.meetingUrl, null);
    assert.equal(parseGoogleEvent({}, fallback), null);
    assert.equal(eventFormbookRef({ extendedProperties: { private: { formbook_ref: "ref-1" } } }), "ref-1");
    assert.equal(eventFormbookRef(null), null);
  });

  it("parses free/busy and refuses calendar errors", () => {
    assert.deepEqual(
      parseFreeBusy(
        { calendars: { primary: { busy: [{ start: "2026-01-12T15:00:00Z", end: "2026-01-12T15:30:00Z" }, { start: "bad", end: "x" }] } } },
        "primary"
      ),
      [{ startMs: Date.parse("2026-01-12T15:00:00Z"), endMs: Date.parse("2026-01-12T15:30:00Z") }]
    );
    assert.throws(() => parseFreeBusy({ calendars: { primary: { errors: [{ reason: "notFound" }] } } }, "primary"), /notFound/);
    assert.throws(() => parseFreeBusy({ calendars: {} }, "primary"));
  });
});

describe("provider HTTP errors", () => {
  it("never carry tokens and cap the body", () => {
    const snippet = redactSnippet(`{"error":"bad","detail":"Bearer ya29.secretvalue cal_abcdefghijklmnopqrstu ${"x".repeat(500)}"}`);
    assert.ok(!snippet.includes("ya29.secretvalue"));
    assert.ok(!snippet.includes("cal_abcdefghijklmnopqrstu"));
    assert.ok(snippet.length <= 200);
    const error = new ProviderHttpError("google", 500, true, snippet);
    assert.equal(error.retryable, true);
    assert.ok(error.message.length <= 400);
    assert.equal(isRetryableHttpStatus(429), true);
    assert.equal(isRetryableHttpStatus(404), false);
  });
});
