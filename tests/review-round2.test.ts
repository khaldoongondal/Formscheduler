import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sendWithEmailCooldown, type EmailSendReservation } from "@/lib/security/email-cooldown";
import { GHL_ATTRIBUTION_FIELD_IDS, buildGhlTrackingCustomFields } from "@/lib/ghl/attribution";
import {
  PUBLISH_NEEDS_CALENDAR_MESSAGE,
  PUBLISH_NEEDS_CONNECTION_MESSAGE,
  publishReadinessError
} from "@/lib/funnels/publish-readiness";
import {
  LINK_EXPIRED_MESSAGE,
  UNVERIFIED_EMAIL_MESSAGE,
  buildResetLink,
  buildVerifyInterstitialPath,
  buildVerifyLink,
  isEmailOtpType,
  messageSuggestsPasswordReset,
  resolveConfirmNext
} from "@/lib/validation/signup";
import type { LeadSession } from "@/lib/types/database";

process.env.LEADDER_TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

function fakeCooldown(initiallyFree = true) {
  const state = { free: initiallyFree, reserved: 0, released: 0 };
  const reserve = async (): Promise<EmailSendReservation> => {
    if (!state.free) return { allowed: false, release: async () => undefined };
    state.free = false;
    state.reserved += 1;
    return {
      allowed: true,
      release: async () => {
        state.free = true;
        state.released += 1;
      }
    };
  };
  return { state, reserve };
}

describe("sendWithEmailCooldown", () => {
  it("keeps the slot after a real send, so a second send waits", async () => {
    const { state, reserve } = fakeCooldown();
    let sends = 0;
    assert.equal(await sendWithEmailCooldown(reserve, async () => (sends++, true)), "sent");
    assert.equal(await sendWithEmailCooldown(reserve, async () => (sends++, true)), "cooldown");
    assert.equal(sends, 1);
    assert.equal(state.released, 0);
  });

  it("gives the slot back when the send fails, so the retry goes out", async () => {
    const { state, reserve } = fakeCooldown();
    await assert.rejects(
      sendWithEmailCooldown(reserve, async () => {
        throw new Error("webhook down");
      }),
      /webhook down/
    );
    assert.equal(state.released, 1);
    let retried = false;
    assert.equal(
      await sendWithEmailCooldown(reserve, async () => {
        retried = true;
        return true;
      }),
      "sent"
    );
    assert.equal(retried, true);
  });

  it("gives the slot back when there was nothing to send", async () => {
    const { state, reserve } = fakeCooldown();
    assert.equal(await sendWithEmailCooldown(reserve, async () => false), "skipped");
    assert.equal(state.free, true);
  });

  it("does not run the send while the cooldown is active", async () => {
    const { reserve } = fakeCooldown(false);
    let ran = false;
    assert.equal(
      await sendWithEmailCooldown(reserve, async () => {
        ran = true;
        return true;
      }),
      "cooldown"
    );
    assert.equal(ran, false);
  });

  it("still rethrows the send error if the release itself fails", async () => {
    const reserve = async (): Promise<EmailSendReservation> => ({
      allowed: true,
      release: async () => {
        throw new Error("db down");
      }
    });
    await assert.rejects(
      sendWithEmailCooldown(reserve, async () => {
        throw new Error("send failed");
      }),
      /send failed/
    );
  });
});

describe("buildGhlTrackingCustomFields", () => {
  const session = {
    metadata: { device_fingerprint: "fp-1", fbclid: "click-1" },
    utm_source: "facebook",
    utm_medium: null,
    utm_campaign: null,
    utm_content: null,
    utm_term: null
  } as unknown as LeadSession;

  it("sends no attribution field IDs for connections that are not flagged", () => {
    assert.deepEqual(buildGhlTrackingCustomFields(session, false), []);
  });

  it("sends the Gondal Tech field IDs only for flagged connections", () => {
    const fields = buildGhlTrackingCustomFields(session, true);
    const ids = fields.map((field) => field.id);
    assert.ok(ids.includes(GHL_ATTRIBUTION_FIELD_IDS.device_fingerprint));
    assert.ok(ids.includes(GHL_ATTRIBUTION_FIELD_IDS.fbclid));
    assert.ok(ids.includes(GHL_ATTRIBUTION_FIELD_IDS.utm_source));
    assert.equal(ids.length, 3);
  });
});

describe("publishReadinessError", () => {
  it("refuses activation without a GoHighLevel connection", () => {
    assert.equal(
      publishReadinessError({ ghlConnectionId: null, calendarId: "cal", connectionCalendarId: null }),
      PUBLISH_NEEDS_CONNECTION_MESSAGE
    );
    assert.equal(
      publishReadinessError({ ghlConnectionId: "  ", calendarId: "cal", connectionCalendarId: null }),
      PUBLISH_NEEDS_CONNECTION_MESSAGE
    );
  });

  it("refuses activation without any calendar", () => {
    assert.equal(
      publishReadinessError({ ghlConnectionId: "c1", calendarId: null, connectionCalendarId: "" }),
      PUBLISH_NEEDS_CALENDAR_MESSAGE
    );
  });

  it("accepts the form calendar or the connection default", () => {
    assert.equal(publishReadinessError({ ghlConnectionId: "c1", calendarId: "cal", connectionCalendarId: null }), null);
    assert.equal(publishReadinessError({ ghlConnectionId: "c1", calendarId: null, connectionCalendarId: "def" }), null);
  });
});

describe("emailed link interstitial", () => {
  it("forwards a verify link to /auth/verify without losing the token or next", () => {
    const link = new URL(buildVerifyLink("https://app.example.com", "hash+/=", "signup"));
    const path = buildVerifyInterstitialPath(
      link.searchParams.get("token_hash") as string,
      link.searchParams.get("type") as string,
      link.searchParams.get("next")
    );
    const forwarded = new URL(path, "https://app.example.com");
    assert.equal(forwarded.pathname, "/auth/verify");
    assert.equal(forwarded.searchParams.get("token_hash"), "hash+/=");
    assert.equal(forwarded.searchParams.get("type"), "signup");
    assert.deepEqual(resolveConfirmNext(forwarded.searchParams.get("next")), {
      pathname: "/auth/set-password",
      search: "?next=%2Fadmin%2Fwelcome"
    });
  });

  it("forwards a reset link with type recovery", () => {
    const link = new URL(buildResetLink("https://app.example.com", "abc"));
    const forwarded = new URL(
      buildVerifyInterstitialPath("abc", link.searchParams.get("type") as string, link.searchParams.get("next")),
      "https://app.example.com"
    );
    assert.equal(forwarded.searchParams.get("type"), "recovery");
    assert.equal(resolveConfirmNext(forwarded.searchParams.get("next")).pathname, "/auth/set-password");
  });

  it("accepts only known one-time link types", () => {
    for (const type of ["signup", "magiclink", "recovery", "email", "invite", "email_change"]) {
      assert.equal(isEmailOtpType(type), true, type);
    }
    for (const type of [null, undefined, "", "sms", "phone_change", "SIGNUP"]) {
      assert.equal(isEmailOtpType(type), false, String(type));
    }
  });

  it("points expired-link and unverified users at Forgot password", () => {
    assert.match(LINK_EXPIRED_MESSAGE, /Forgot password/);
    assert.match(UNVERIFIED_EMAIL_MESSAGE, /Forgot password/);
    assert.equal(messageSuggestsPasswordReset(LINK_EXPIRED_MESSAGE), true);
    assert.equal(messageSuggestsPasswordReset(UNVERIFIED_EMAIL_MESSAGE), true);
    assert.equal(messageSuggestsPasswordReset("Email or password is incorrect."), false);
    assert.equal(messageSuggestsPasswordReset(undefined), false);
  });
});

describe("GoHighLevel OAuth state binding", async () => {
  const { createOauthState, verifyOauthState, oauthCallbackMatchesSession } = await import("@/lib/ghl/oauth");

  it("round-trips the tenant and nonce", () => {
    const { state, nonce } = createOauthState("tenant-a");
    assert.deepEqual(verifyOauthState(state), { tenantId: "tenant-a", nonce });
  });

  it("accepts the callback only in the starting browser, signed in to the same tenant", () => {
    const { state, nonce } = createOauthState("tenant-a");
    const verified = verifyOauthState(state);
    assert.ok(verified);
    assert.equal(oauthCallbackMatchesSession(verified, nonce, "tenant-a"), true);
  });

  it("refuses a state replayed in another browser (no or wrong nonce cookie)", () => {
    const { state } = createOauthState("tenant-a");
    const verified = verifyOauthState(state);
    assert.ok(verified);
    assert.equal(oauthCallbackMatchesSession(verified, undefined, "tenant-a"), false);
    assert.equal(oauthCallbackMatchesSession(verified, createOauthState("tenant-a").nonce, "tenant-a"), false);
  });

  it("refuses when the signed-in tenant differs from the state, or nobody is signed in", () => {
    const { state, nonce } = createOauthState("attacker-tenant");
    const verified = verifyOauthState(state);
    assert.ok(verified);
    assert.equal(oauthCallbackMatchesSession(verified, nonce, "victim-tenant"), false);
    assert.equal(oauthCallbackMatchesSession(verified, nonce, null), false);
  });

  it("rejects a tampered state", () => {
    const { state } = createOauthState("tenant-a");
    const [payload, signature] = state.split(".");
    const forged = Buffer.from(JSON.stringify({ tenant_id: "tenant-b", expires_at: Date.now() + 60000, nonce: "x" })).toString(
      "base64url"
    );
    assert.equal(verifyOauthState(`${forged}.${signature}`), null);
    assert.ok(verifyOauthState(`${payload}.${signature}`));
  });
});
