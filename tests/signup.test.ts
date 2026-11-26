import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHONE_MESSAGE,
  RESEND_RATE_LIMITED_MESSAGE,
  SIGNUP_GENERIC_ERROR,
  UNVERIFIED_EMAIL_MESSAGE,
  buildResetLink,
  buildSignupWebhookPayload,
  buildVerifyLink,
  formDataToRecord,
  isValidSignupPhone,
  normalizeSignupPhone,
  parseSignupForm
} from "@/lib/validation/signup";

const EM_DASH = String.fromCharCode(0x2014);

const validValues: Record<string, string> = {
  name: "Jane Doe",
  email: "  Jane@Example.COM ",
  phone: "+1 (416) 555-0100",
  business_name: "Acme Heating",
  website: "acme.com",
  password: "correct-horse",
  terms: "on"
};

function parseWith(overrides: Record<string, string | undefined>) {
  const values: Record<string, string> = { ...validValues };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete values[key];
    else values[key] = value;
  }
  return parseSignupForm(values);
}

function expectFieldError(overrides: Record<string, string | undefined>, field: string) {
  const result = parseWith(overrides);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok((result.fieldErrors as Record<string, string | undefined>)[field], `expected an error on ${field}`);
  }
  return result;
}

describe("signup phone", () => {
  it("normalizes formatting characters", () => {
    assert.equal(normalizeSignupPhone("+1 (416) 555-0100"), "+14165550100");
    assert.equal(normalizeSignupPhone("+1.416.555.0100"), "+14165550100");
  });

  it("turns a leading 00 into +", () => {
    assert.equal(normalizeSignupPhone("0044 20 7946 0000"), "+442079460000");
  });

  it("requires a country code and 8 to 15 digits", () => {
    assert.equal(isValidSignupPhone("+14165550100"), true);
    assert.equal(isValidSignupPhone("4165550100"), false);
    assert.equal(isValidSignupPhone("+1234567"), false);
    assert.equal(isValidSignupPhone("+1234567890123456"), false);
  });
});

describe("parseSignupForm", () => {
  it("parses valid input and normalizes fields", () => {
    const result = parseWith({});
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.data.email, "jane@example.com");
      assert.equal(result.data.website, "https://acme.com");
      assert.equal(result.data.phone, "+14165550100");
      assert.equal(result.data.name, "Jane Doe");
    }
  });

  it("accepts a 00 international phone", () => {
    const result = parseWith({ phone: "0044 20 7946 0000" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.phone, "+442079460000");
  });

  it("rejects a short name", () => {
    expectFieldError({ name: "J" }, "name");
  });

  it("rejects a bad email", () => {
    expectFieldError({ email: "not-an-email" }, "email");
  });

  it("rejects a phone without a country code", () => {
    const result = expectFieldError({ phone: "4165550100" }, "phone");
    if (!result.ok) assert.equal(result.fieldErrors.phone, PHONE_MESSAGE);
  });

  it("rejects a website that is not a site", () => {
    expectFieldError({ website: "not a site" }, "website");
  });

  it("rejects a 7 character password", () => {
    expectFieldError({ password: "1234567" }, "password");
  });

  it("rejects a 73 character password", () => {
    expectFieldError({ password: "a".repeat(73) }, "password");
  });

  it("accepts a 72 character password", () => {
    assert.equal(parseWith({ password: "a".repeat(72) }).ok, true);
  });

  it("requires the terms checkbox", () => {
    expectFieldError({ terms: undefined }, "terms");
  });

  it("returns a form error when the honeypot is filled", () => {
    const result = parseWith({ company_fax: "555-0100" });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.deepEqual(result.fieldErrors, { form: SIGNUP_GENERIC_ERROR });
    }
  });

  it("rejects a website that would exceed 300 characters once https:// is added", () => {
    const longSite = `${"a".repeat(60)}.${"b".repeat(60)}.${"c".repeat(60)}.${"d".repeat(60)}.com/${"x".repeat(50)}`;
    assert.ok(longSite.length <= 300);
    expectFieldError({ website: longSite }, "website");
  });
});

describe("buildSignupWebhookPayload", () => {
  it("has exactly the agreed keys and the free plan", () => {
    const result = parseWith({});
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const payload = buildSignupWebhookPayload(result.data, "https://app.example/verify");
    assert.deepEqual(Object.keys(payload).sort(), [
      "business_name",
      "email",
      "name",
      "phone",
      "plan",
      "verify_link",
      "website"
    ]);
    assert.equal(payload.plan, "free");
    assert.equal(payload.verify_link, "https://app.example/verify");
    assert.equal("password" in payload, false);
  });
});

describe("buildVerifyLink", () => {
  it("encodes the token and always lands on the welcome page", () => {
    const link = buildVerifyLink("https://formbooking.gondaltech.app/", "a b&c=d", "signup");
    assert.equal(
      link,
      "https://formbooking.gondaltech.app/auth/confirm?token_hash=a%20b%26c%3Dd&type=signup&next=/admin/welcome"
    );
    const url = new URL(link);
    assert.equal(url.searchParams.get("token_hash"), "a b&c=d");
    assert.equal(url.searchParams.get("next"), "/admin/welcome");
  });

  it("builds reset links that land on set-password", () => {
    const url = new URL(buildResetLink("https://formbooking.gondaltech.app", "tok/en"));
    assert.equal(url.searchParams.get("token_hash"), "tok/en");
    assert.equal(url.searchParams.get("type"), "recovery");
    assert.equal(url.searchParams.get("next"), "/auth/set-password");
  });
});

describe("formDataToRecord", () => {
  it("keeps the first string value of each key", () => {
    const form = new FormData();
    form.append("name", "Jane");
    form.append("name", "Other");
    form.append("terms", "on");
    assert.deepEqual(formDataToRecord(form), { name: "Jane", terms: "on" });
  });
});

describe("signup copy", () => {
  it("contains no em dash", () => {
    const messages = [PHONE_MESSAGE, SIGNUP_GENERIC_ERROR, UNVERIFIED_EMAIL_MESSAGE, RESEND_RATE_LIMITED_MESSAGE];
    const empty = parseSignupForm({});
    if (!empty.ok) messages.push(...Object.values(empty.fieldErrors).filter((m): m is string => Boolean(m)));
    const bad = parseWith({ name: "J", email: "x", phone: "1", website: "no", password: "a".repeat(80), terms: "no" });
    if (!bad.ok) messages.push(...Object.values(bad.fieldErrors).filter((m): m is string => Boolean(m)));
    assert.ok(messages.length > 6);
    for (const message of messages) {
      assert.equal(message.includes(EM_DASH), false, message);
    }
  });
});
