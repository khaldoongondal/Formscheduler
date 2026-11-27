import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHONE_MESSAGE,
  RESEND_RATE_LIMITED_MESSAGE,
  SIGNUP_GENERIC_ERROR,
  UNVERIFIED_EMAIL_MESSAGE,
  SIGNUP_VERIFY_NEXT,
  buildResetLink,
  buildSignupEmailRedirect,
  buildSignupWebhookPayload,
  buildVerifyLink,
  formDataToRecord,
  isValidSignupPhone,
  normalizeSignupPhone,
  parseSignupForm,
  resolveConfirmNext,
  resolveSetPasswordNext
} from "@/lib/validation/signup";
import { turnstileMode, verifyTurnstile } from "@/lib/signup/turnstile";

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

  it("does not need a password (it is chosen after verification)", () => {
    assert.equal(parseWith({ password: undefined }).ok, true);
  });

  it("ignores a password posted with the form", () => {
    const result = parseWith({ password: "attacker-chosen" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal("password" in result.data, false);
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
  it("encodes the token and lands on set-password, then the welcome page", () => {
    const link = buildVerifyLink("https://formbooking.gondaltech.app/", "a b&c=d", "signup");
    assert.equal(
      link,
      "https://formbooking.gondaltech.app/auth/confirm?token_hash=a%20b%26c%3Dd&type=signup&next=%2Fauth%2Fset-password%3Fnext%3D%2Fadmin%2Fwelcome"
    );
    const url = new URL(link);
    assert.equal(url.searchParams.get("token_hash"), "a b&c=d");
    assert.equal(url.searchParams.get("next"), SIGNUP_VERIFY_NEXT);
    assert.deepEqual(resolveConfirmNext(url.searchParams.get("next")), {
      pathname: "/auth/set-password",
      search: "?next=%2Fadmin%2Fwelcome"
    });
  });

  it("uses the same next for the Supabase fallback email", () => {
    const url = new URL(buildSignupEmailRedirect("https://formbooking.gondaltech.app/"));
    assert.equal(url.pathname, "/auth/confirm");
    assert.equal(url.searchParams.get("next"), SIGNUP_VERIFY_NEXT);
  });

  it("builds reset links that land on set-password", () => {
    const url = new URL(buildResetLink("https://formbooking.gondaltech.app", "tok/en"));
    assert.equal(url.searchParams.get("token_hash"), "tok/en");
    assert.equal(url.searchParams.get("type"), "recovery");
    assert.equal(url.searchParams.get("next"), "/auth/set-password");
  });
});

describe("resolveConfirmNext", () => {
  it("allows the known bare paths", () => {
    for (const path of ["/auth/set-password", "/admin/funnels", "/admin/welcome"]) {
      assert.deepEqual(resolveConfirmNext(path), { pathname: path, search: "" });
    }
  });

  it("falls back to set-password for anything else", () => {
    const fallback = { pathname: "/auth/set-password", search: "" };
    for (const value of [
      null,
      "",
      "https://evil.example",
      "//evil.example",
      "/admin/clients",
      "/auth/set-password?next=https://evil.example",
      "/auth/set-password?next=/admin/clients",
      "/auth/set-password?next=/admin/welcome&x=1",
      "/auth/set-password?next=/admin/welcome?x",
      "/admin/funnels?next=/admin/welcome"
    ]) {
      assert.deepEqual(resolveConfirmNext(value), fallback, String(value));
    }
  });
});

describe("resolveSetPasswordNext", () => {
  it("allows only the welcome page and the forms list", () => {
    assert.equal(resolveSetPasswordNext("/admin/welcome"), "/admin/welcome");
    assert.equal(resolveSetPasswordNext("/admin/funnels"), "/admin/funnels");
    assert.equal(resolveSetPasswordNext("https://evil.example"), "/admin/funnels");
    assert.equal(resolveSetPasswordNext("/admin/clients"), "/admin/funnels");
    assert.equal(resolveSetPasswordNext(null), "/admin/funnels");
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

const productionHosts = ["app.formbook.ca", "formbooking.gondaltech.app"];
const turnstileEnv = {
  NODE_ENV: "production",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "fixture-site-key",
  TURNSTILE_SECRET_KEY: "fixture-secret",
  TURNSTILE_HOSTNAMES: productionHosts.join(",")
};

describe("turnstileMode", () => {
  it("requires both keys and a nonempty list of exact hostnames", () => {
    assert.equal(turnstileMode(turnstileEnv), "enforced");
    for (const hosts of [undefined, " , ", "*.example.com", "https://example.com"]) {
      assert.equal(turnstileMode({ ...turnstileEnv, TURNSTILE_HOSTNAMES: hosts }), "missing");
    }
  });

  it("refuses signup in production when a key is missing or blank", () => {
    assert.equal(turnstileMode({ ...turnstileEnv, NEXT_PUBLIC_TURNSTILE_SITE_KEY: undefined }), "missing");
    assert.equal(turnstileMode({ ...turnstileEnv, TURNSTILE_SECRET_KEY: "  " }), "missing");
  });

  it("allows a keyed development widget for localhost only with its host configured", () => {
    const local = { ...turnstileEnv, NODE_ENV: "development" };
    assert.equal(turnstileMode({ ...local, TURNSTILE_HOSTNAMES: "localhost,127.0.0.1" }), "enforced");
    assert.equal(turnstileMode({ ...local, TURNSTILE_HOSTNAMES: undefined }), "missing");
  });

  it("is off outside production when keys are missing", () => {
    assert.equal(turnstileMode({ NODE_ENV: "development" }), "off");
    assert.equal(turnstileMode({ NODE_ENV: "test" }), "off");
  });
});

describe("verifyTurnstile", () => {
  const token = "fixture-signup-response";
  const ip = "192.0.2.10";
  const approved = { success: true, action: "signup", hostname: productionHosts[0] };

  it("posts the token to Siteverify and accepts signup on either configured host", async (t) => {
    const requests: Request[] = [];
    let hostname = "";
    const fakeFetch: typeof fetch = async (url, init) => {
      requests.push(new Request(url, init));
      return Response.json({ ...approved, hostname });
    };
    t.mock.method(globalThis, "fetch", fakeFetch);
    for (const host of productionHosts) {
      hostname = host;
      assert.equal(await verifyTurnstile(token, ip, turnstileEnv), true, host);
    }
    assert.equal(requests.length, 2);
    for (const request of requests) {
      assert.equal(request.method, "POST");
      assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
      assert.deepEqual(Object.fromEntries(await request.formData()), {
        secret: turnstileEnv.TURNSTILE_SECRET_KEY, response: token, remoteip: ip
      });
    }
  });

  it("requires a literal success, the signup action and an exact hostname", async (t) => {
    const invalidResults = [
      { ...approved, success: "true" },
      { success: true, hostname: approved.hostname },
      { ...approved, action: "reset" },
      { success: true, action: "signup" },
      { ...approved, hostname: "preview.app.formbook.ca" },
      { ...approved, hostname: "app.formbook.ca.example" },
      null
    ];
    let result: unknown;
    t.mock.method(globalThis, "fetch", async () => Response.json(result));
    for (result of invalidResults) {
      assert.equal(await verifyTurnstile(token, ip, turnstileEnv), false, JSON.stringify(result));
    }
  });

  it("rejects an expired or already used response reported by Cloudflare", async (t) => {
    t.mock.method(globalThis, "fetch", async () =>
      Response.json({ ...approved, success: false, "error-codes": ["timeout-or-duplicate"] })
    );
    assert.equal(await verifyTurnstile(token, ip, turnstileEnv), false);
  });

  it("fails closed on malformed JSON, an HTTP failure or a broken connection", async (t) => {
    const fakeFetch = t.mock.method(globalThis, "fetch", async () => new Response("not json"));
    assert.equal(await verifyTurnstile(token, ip, turnstileEnv), false);
    fakeFetch.mock.mockImplementation(async () => Response.json(approved, { status: 503 }));
    assert.equal(await verifyTurnstile(token, ip, turnstileEnv), false);
    fakeFetch.mock.mockImplementation(async () => { throw new TypeError("Offline test"); });
    assert.equal(await verifyTurnstile(token, ip, turnstileEnv), false);
  });

  it("only sends nonblank tokens up to 2048 characters", async (t) => {
    const fakeFetch = t.mock.method(globalThis, "fetch", async () => Response.json(approved));
    for (const invalid of [null, "", "  ", "x".repeat(2049)]) {
      assert.equal(await verifyTurnstile(invalid, ip, turnstileEnv), false);
    }
    assert.equal(fakeFetch.mock.callCount(), 0);
    assert.equal(await verifyTurnstile("x".repeat(2048), ip, turnstileEnv), true);
    assert.equal(fakeFetch.mock.callCount(), 1);
  });

  it("refuses any production allowlist containing a local host before contacting Siteverify", async (t) => {
    const fakeFetch = t.mock.method(globalThis, "fetch", async () => Response.json(approved));
    for (const host of ["localhost", "signup.localhost", "127.0.0.1"]) {
      const env = { ...turnstileEnv, TURNSTILE_HOSTNAMES: productionHosts.concat(host).join(",") };
      assert.equal(turnstileMode(env), "missing", host);
      assert.equal(await verifyTurnstile(token, ip, env), false, host);
    }
    assert.equal(fakeFetch.mock.callCount(), 0);
  });
});
