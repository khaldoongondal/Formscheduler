import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEV_OWNER_EMAIL, isDevOwnerBypass, isOwnerEmail, parseOwnerEmails } from "@/lib/auth/owner";
import { shouldShowBadge } from "@/lib/billing/plans";
import {
  clientFormStatus,
  defaultTakedownReason,
  formatOwnerDate,
  isOverActiveLimit,
  ownerBadgeSchema,
  ownerOptionalReasonSchema,
  ownerPlanSchema,
  ownerRequiredReasonSchema,
  ownerUuidSchema,
  planDowngradeWarning,
  planLimitsFor,
  planStateLabel
} from "@/lib/owner/format";

const EM_DASH = String.fromCharCode(0x2014);

describe("parseOwnerEmails", () => {
  it("splits on commas and whitespace, trims and lowercases", () => {
    const owners = parseOwnerEmails(" A@x.example, b@y.example  c@z.example ");
    assert.equal(owners.size, 3);
    assert.deepEqual([...owners].sort(), ["a@x.example", "b@y.example", "c@z.example"]);
  });

  it("returns an empty set for empty or missing input", () => {
    assert.equal(parseOwnerEmails("").size, 0);
    assert.equal(parseOwnerEmails(undefined).size, 0);
    assert.equal(parseOwnerEmails(" , ,  ").size, 0);
  });
});

describe("isOwnerEmail", () => {
  it("matches case-insensitively", () => {
    assert.equal(isOwnerEmail("a@X.example", "a@x.example"), true);
    assert.equal(isOwnerEmail("  a@x.example ", "b@y.example,a@x.example"), true);
  });

  it("rejects unknown addresses, empty lists and missing emails", () => {
    assert.equal(isOwnerEmail("someone@else.example", "a@x.example"), false);
    assert.equal(isOwnerEmail("a@x.example", ""), false);
    assert.equal(isOwnerEmail("a@x.example", undefined), false);
    assert.equal(isOwnerEmail(null, "a@x.example"), false);
    assert.equal(isOwnerEmail(undefined, "a@x.example"), false);
    assert.equal(isOwnerEmail("", "a@x.example"), false);
  });
});

describe("isDevOwnerBypass", () => {
  it("applies only outside production with a default tenant set", () => {
    assert.equal(isDevOwnerBypass({ NODE_ENV: "development", LEADDER_DEFAULT_TENANT_ID: "t" }), true);
    assert.equal(isDevOwnerBypass({ NODE_ENV: "production", LEADDER_DEFAULT_TENANT_ID: "t" }), false);
    assert.equal(isDevOwnerBypass({ NODE_ENV: "development" }), false);
    assert.equal(DEV_OWNER_EMAIL, "dev-owner@localhost");
  });
});

describe("shouldShowBadge", () => {
  it("shows only for free tenants with the badge not switched off", () => {
    assert.equal(shouldShowBadge("free", true), true);
    assert.equal(shouldShowBadge("free", null), true);
    assert.equal(shouldShowBadge("free", undefined), true);
    assert.equal(shouldShowBadge("free", false), false);
    assert.equal(shouldShowBadge("scaling", true), false);
    assert.equal(shouldShowBadge("suspended", true), false);
  });
});

describe("owner input schemas", () => {
  it("accepts uuids and rejects other ids", () => {
    assert.equal(ownerUuidSchema.safeParse("00000000-0000-0000-0000-000000000001").success, true);
    assert.equal(ownerUuidSchema.safeParse("not-a-uuid").success, false);
    assert.equal(ownerUuidSchema.safeParse("").success, false);
  });

  it("accepts only known plans", () => {
    for (const plan of ["free", "scaling", "suspended"]) {
      assert.equal(ownerPlanSchema.safeParse(plan).success, true);
    }
    assert.equal(ownerPlanSchema.safeParse("tier1").success, false);
    assert.equal(ownerPlanSchema.safeParse("gold").success, false);
  });

  it("caps reasons at 500 characters and requires a takedown reason", () => {
    assert.equal(ownerOptionalReasonSchema.parse(""), undefined);
    assert.equal(ownerOptionalReasonSchema.parse(undefined), undefined);
    assert.equal(ownerOptionalReasonSchema.parse("  late payment "), "late payment");
    assert.equal(ownerOptionalReasonSchema.safeParse("x".repeat(501)).success, false);
    assert.equal(ownerRequiredReasonSchema.safeParse("   ").success, false);
    assert.equal(ownerRequiredReasonSchema.safeParse("Phishing").success, true);
    assert.equal(ownerRequiredReasonSchema.safeParse("x".repeat(501)).success, false);
  });

  it("maps the badge switch", () => {
    assert.equal(ownerBadgeSchema.parse("on"), true);
    assert.equal(ownerBadgeSchema.parse("off"), false);
    assert.equal(ownerBadgeSchema.safeParse("yes").success, false);
  });
});

describe("owner display helpers", () => {
  it("labels plans and form states", () => {
    assert.equal(planStateLabel("free"), "Bootstrapping");
    assert.equal(planStateLabel("scaling"), "Scaling");
    assert.equal(planStateLabel("suspended"), "Suspended");
    assert.equal(clientFormStatus({ is_published: true, taken_down_at: null }), "Active");
    assert.equal(clientFormStatus({ is_published: false, taken_down_at: null }), "Draft");
    assert.equal(clientFormStatus({ is_published: false, taken_down_at: "2026-11-26T00:00:00Z" }), "Taken down");
  });

  it("measures usage against plan limits", () => {
    assert.deepEqual(planLimitsFor("free"), { maxActiveForms: 3, maxDraftForms: 10 });
    assert.deepEqual(planLimitsFor("scaling"), { maxActiveForms: 30, maxDraftForms: 100 });
    assert.deepEqual(planLimitsFor("suspended"), { maxActiveForms: 0, maxDraftForms: 0 });
    assert.equal(isOverActiveLimit("free", 3), false);
    assert.equal(isOverActiveLimit("free", 4), true);
  });

  it("warns when a plan allows fewer active forms than the client uses", () => {
    assert.equal(planDowngradeWarning("free", 3), null);
    assert.equal(planDowngradeWarning("scaling", 12), null);
    assert.equal(planDowngradeWarning("suspended", 50), null);
    assert.equal(
      planDowngradeWarning("free", 5),
      "This client has 5 active forms and the Bootstrapping plan allows 3. Switching freezes 2 of them, the ones with the oldest leads. Nothing is deleted, and the client can choose which forms stay active."
    );
  });

  it("formats dates and the default takedown reason", () => {
    assert.equal(formatOwnerDate(null), "Never");
    assert.equal(formatOwnerDate("not a date"), "Never");
    assert.match(formatOwnerDate("2026-11-26T12:00:00Z"), /2026/);
    assert.equal(defaultTakedownReason("Spam"), "Reported as Spam");
    assert.ok(defaultTakedownReason("x".repeat(600)).length <= 500);
  });

  it("uses no em dashes in owner copy", () => {
    const warning = planDowngradeWarning("free", 9) ?? "";
    assert.ok(!warning.includes(EM_DASH));
    assert.ok(!defaultTakedownReason("Spam").includes(EM_DASH));
  });
});
