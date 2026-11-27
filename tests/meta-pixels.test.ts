import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized } from "@/lib/api/cron-auth";
import { PLANS, SUSPENDED_MESSAGE, checkPixelLimit, pixelLimitMessage, planLimitMessageFromError } from "@/lib/billing/plans";
import { META_EVENT_DEFS } from "@/lib/meta/events";
import {
  DEFAULT_CONSENT_LABEL,
  PIXEL_MESSAGES,
  funnelMetaSettingsSchema,
  pixelCreateSchema,
  pixelUpdateSchema,
  resolveFunnelMetaUpdate,
  tokenLastFour
} from "@/lib/meta/pixel-input";
import { toStorableIp } from "@/lib/security/client-ip";

const EM_DASH = String.fromCharCode(0x2014);
const TOKEN = "EAAexampleTokenValue0123456789abcdef";
const PIXEL_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";

describe("pixel limits", () => {
  it("free allows 1", () => {
    assert.deepEqual(checkPixelLimit("free", 0), { allowed: true });
    const blocked = checkPixelLimit("free", 1);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.allowed ? null : blocked.reason, "pixels");
  });
  it("scaling allows 3", () => {
    assert.deepEqual(checkPixelLimit("scaling", 2), { allowed: true });
    assert.equal(checkPixelLimit("scaling", 3).allowed, false);
  });
  it("suspended is blocked", () => {
    const result = checkPixelLimit("suspended", 0);
    assert.equal(result.allowed ? null : result.message, SUSPENDED_MESSAGE);
  });
  it("maps the trigger error", () => {
    assert.equal(planLimitMessageFromError("FORMBOOK_LIMIT:pixels", "free"), pixelLimitMessage(PLANS.free));
    assert.match(pixelLimitMessage(PLANS.free), /limit of 1 Meta pixel on the Bootstrapping plan/);
    assert.match(pixelLimitMessage(PLANS.scaling), /limit of 3 Meta pixels on the Scaling plan\. Remove a pixel first\.$/);
  });
});

describe("pixel input schemas", () => {
  it("accept a valid pixel", () => {
    const parsed = pixelCreateSchema.parse({ name: "Main ads", dataset_id: "123456789012345", access_token: TOKEN, test_event_code: "" });
    assert.equal(parsed.test_event_code, null);
    assert.equal(
      pixelCreateSchema.parse({ name: "Main ads", dataset_id: "123456789012345", access_token: TOKEN, test_event_code: "TEST123" })
        .test_event_code,
      "TEST123"
    );
  });

  it("reject bad values with the exact messages", () => {
    const message = (input: unknown) => {
      const result = pixelCreateSchema.safeParse(input);
      return result.success ? null : result.error.issues[0]?.message;
    };
    const base = { name: "Main ads", dataset_id: "123456789012345", access_token: TOKEN };
    assert.equal(message({ ...base, name: " " }), PIXEL_MESSAGES.name);
    assert.equal(message({ ...base, dataset_id: "12ab" }), PIXEL_MESSAGES.datasetId);
    assert.equal(message({ ...base, access_token: "short" }), PIXEL_MESSAGES.token);
    assert.equal(message({ ...base, test_event_code: "bad code!" }), PIXEL_MESSAGES.testEventCode);
  });

  it("update keeps the token when blank", () => {
    const parsed = pixelUpdateSchema.parse({ name: "Main ads", dataset_id: "123456789012345", access_token: "" });
    assert.equal(parsed.access_token, null);
    assert.equal(pixelUpdateSchema.safeParse({ name: "Main", dataset_id: "123456789012345", access_token: "x" }).success, false);
  });

  it("token last four", () => {
    assert.equal(tokenLastFour(` ${TOKEN} `), "cdef");
  });

  it("form Meta settings", () => {
    const parsed = funnelMetaSettingsSchema.parse({
      meta_pixel_id: "",
      consent_confirmed: false,
      checkbox_enabled: false,
      checkbox_label: ""
    });
    assert.equal(parsed.meta_pixel_id, null);
    assert.equal(parsed.checkbox_label, null);
    const tooLong = funnelMetaSettingsSchema.safeParse({
      meta_pixel_id: PIXEL_UUID,
      consent_confirmed: true,
      checkbox_enabled: true,
      checkbox_label: "a".repeat(301)
    });
    assert.equal(tooLong.success ? null : tooLong.error.issues[0]?.message, PIXEL_MESSAGES.checkboxLabel);
  });
});

describe("resolveFunnelMetaUpdate", () => {
  const none = { meta_pixel_id: null, meta_consent_confirmed_at: null, meta_consent_confirmed_by: null };
  const settings = (overrides: Partial<{ meta_pixel_id: string | null; consent_confirmed: boolean }>) => ({
    meta_pixel_id: PIXEL_UUID as string | null,
    consent_confirmed: true,
    checkbox_enabled: false,
    checkbox_label: null,
    ...overrides
  });

  it("needs the confirmation before attaching a pixel", () => {
    assert.deepEqual(resolveFunnelMetaUpdate(none, settings({ consent_confirmed: false }), "a@example.com", "now"), {
      ok: false,
      message: PIXEL_MESSAGES.needConsent
    });
  });

  it("asks to remove the pixel before withdrawing the confirmation", () => {
    const current = { meta_pixel_id: PIXEL_UUID, meta_consent_confirmed_at: "then", meta_consent_confirmed_by: "a@example.com" };
    assert.deepEqual(resolveFunnelMetaUpdate(current, settings({ consent_confirmed: false }), "b@example.com", "now"), {
      ok: false,
      message: PIXEL_MESSAGES.removePixelFirst
    });
  });

  it("records a new confirmation and keeps an existing one", () => {
    const first = resolveFunnelMetaUpdate(none, settings({}), "a@example.com", "now");
    assert.equal(first.ok && first.update.meta_consent_confirmed_at, "now");
    assert.equal(first.ok && first.update.meta_consent_confirmed_by, "a@example.com");
    const current = { meta_pixel_id: PIXEL_UUID, meta_consent_confirmed_at: "then", meta_consent_confirmed_by: "a@example.com" };
    const again = resolveFunnelMetaUpdate(current, settings({}), "b@example.com", "now");
    assert.equal(again.ok && again.update.meta_consent_confirmed_at, "then");
    assert.equal(again.ok && again.update.meta_consent_confirmed_by, "a@example.com");
  });

  it("clears the confirmation when withdrawn with no pixel", () => {
    const current = { meta_pixel_id: null, meta_consent_confirmed_at: "then", meta_consent_confirmed_by: "a@example.com" };
    const result = resolveFunnelMetaUpdate(current, settings({ meta_pixel_id: null, consent_confirmed: false }), "a@example.com", "now");
    assert.equal(result.ok && result.update.meta_consent_confirmed_at, null);
    assert.equal(result.ok && result.update.meta_consent_confirmed_by, null);
  });
});

describe("isCronAuthorized", () => {
  it("needs a secret in production", () => {
    assert.equal(isCronAuthorized(null, undefined, true), false);
    assert.equal(isCronAuthorized("Bearer anything", undefined, true), false);
  });
  it("is open in development without a secret", () => {
    assert.equal(isCronAuthorized(null, undefined, false), true);
  });
  it("compares the bearer", () => {
    const secret = "example-cron-secret-value-0123456789";
    assert.equal(isCronAuthorized(`Bearer ${secret}`, secret, true), true);
    assert.equal(isCronAuthorized("Bearer wrong", secret, true), false);
    assert.equal(isCronAuthorized(secret, secret, true), false);
    assert.equal(isCronAuthorized(null, secret, false), false);
  });
});

describe("toStorableIp", () => {
  it("keeps valid IPv4 and IPv6, drops the rest", () => {
    assert.equal(toStorableIp("203.0.113.7"), "203.0.113.7");
    assert.equal(toStorableIp("2001:db8::1"), "2001:db8::1");
    assert.equal(toStorableIp("unknown"), null);
    assert.equal(toStorableIp("999.1.1.1"), null);
  });
});

describe("copy", () => {
  it("has no em dash", () => {
    const texts = [
      ...Object.values(PIXEL_MESSAGES),
      DEFAULT_CONSENT_LABEL,
      pixelLimitMessage(PLANS.free),
      pixelLimitMessage(PLANS.scaling),
      ...Object.values(META_EVENT_DEFS).flatMap((def) => [def.label, def.when])
    ];
    for (const text of texts) assert.equal(text.includes(EM_DASH), false, text);
  });
});
