import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_REF_PATTERN,
  buildBillingPortalUrl,
  buildUpgradeUrl,
  isAccountRef,
  normalizeAccountRef,
  parseOwnerLink,
  planLinks
} from "@/lib/billing/account-ref";
import {
  FREEZE_COPY,
  canReactivateForm,
  canReactivatePixel,
  freezeMessageFromError,
  planFormFreeze,
  planFormRestore,
  planPixelFreeze,
  planPixelRestore,
  previewFreeze,
  rankActiveForms,
  rankPixels,
  rankRestorableForms,
  type FormActivity,
  type PixelActivity
} from "@/lib/billing/freeze";
import { PLAN_COPY, UPGRADE_PHRASE, isUpgradeableLimitMessage } from "@/lib/billing/plan-copy";
import { limitsOf, mergePlanUpdate, planDirection, resolveOwnerPlanChange } from "@/lib/billing/plan-transitions";
import {
  PLANS,
  SUSPENDED_MESSAGE,
  activeLimitMessage,
  draftLimitMessage,
  pixelLimitMessage,
  type PlanState
} from "@/lib/billing/plans";
import {
  clientFormStatus,
  parsePlanChangeParams,
  pixelDowngradeWarning,
  planChangeNotice,
  planChangeParams,
  planDowngradeWarning,
  wouldFreezeLine
} from "@/lib/owner/format";
import type { TenantPlanFields } from "@/lib/provisioning/plan-change";

const EM_DASH = String.fromCharCode(0x2014);
// Made-up reference in the documented format (not a real account).
const REF = "fba_" + "0123456789abcdef01234567";
const PAY = "https://pay.example.com/formbook";

function form(id: string, overrides: Partial<FormActivity> = {}): FormActivity {
  return {
    id,
    name: `Form ${id}`,
    isPublished: true,
    frozenAt: null,
    takenDownAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    metaPixelId: null,
    lastLeadAt: null,
    ...overrides
  };
}

function pixel(id: string, overrides: Partial<PixelActivity> = {}): PixelActivity {
  return {
    id,
    name: `Pixel ${id}`,
    frozenAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    lastEventAt: null,
    ...overrides
  };
}

describe("rankActiveForms", () => {
  it("puts lead recency before update recency and no-lead forms last", () => {
    const forms = [
      form("a", { lastLeadAt: null, createdAt: "2026-11-20T00:00:00Z" }),
      form("b", { lastLeadAt: "2026-11-02T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" }),
      form("c", { lastLeadAt: "2026-11-10T00:00:00Z", createdAt: "2026-10-01T00:00:00Z" })
    ];
    assert.deepEqual(rankActiveForms(forms), ["c", "b", "a"]);
  });

  it("breaks ties by createdAt then id, and treats invalid dates as missing", () => {
    const forms = [
      form("z", { createdAt: "2026-11-05T00:00:00Z" }),
      form("y", { createdAt: "2026-11-05T00:00:00Z" }),
      form("x", { createdAt: "2026-11-09T00:00:00Z" }),
      form("w", { createdAt: "not a date" })
    ];
    assert.deepEqual(rankActiveForms(forms), ["x", "y", "z", "w"]);
  });

  it("leaves out drafts and frozen forms", () => {
    const forms = [
      form("active"),
      form("draft", { isPublished: false }),
      form("frozen", { isPublished: false, frozenAt: "2026-11-01T00:00:00Z" })
    ];
    assert.deepEqual(rankActiveForms(forms), ["active"]);
  });
});

describe("planFormFreeze", () => {
  const seven = Array.from({ length: 7 }, (_, i) =>
    form(`f${i}`, { lastLeadAt: i < 4 ? `2026-11-1${i}T00:00:00Z` : null, createdAt: `2026-10-0${i + 1}T00:00:00Z` })
  );

  it("keeps the best three of seven and freezes four", () => {
    const result = planFormFreeze(seven, 3);
    assert.deepEqual(result.keep, ["f3", "f2", "f1"]);
    assert.deepEqual(result.freeze, ["f0", "f6", "f5", "f4"]);
  });

  it("freezes nothing when the limit is above the count, everything at zero", () => {
    assert.deepEqual(planFormFreeze(seven, 30).freeze, []);
    assert.equal(planFormFreeze(seven, 0).keep.length, 0);
    assert.equal(planFormFreeze(seven, 0).freeze.length, 7);
  });
});

describe("rankPixels and planPixelFreeze", () => {
  it("prefers a pixel used by a kept form over a more recently active one", () => {
    const pixels = [
      pixel("busy", { lastEventAt: "2026-11-25T00:00:00Z" }),
      pixel("kept", { lastEventAt: "2026-10-01T00:00:00Z" }),
      pixel("frozen", { frozenAt: "2026-11-01T00:00:00Z" })
    ];
    const kept = [form("a", { metaPixelId: "kept" })];
    assert.deepEqual(rankPixels(pixels, kept), ["kept", "busy"]);
    assert.deepEqual(planPixelFreeze(pixels, kept, 1), { keep: ["kept"], freeze: ["busy"] });
  });

  it("ranks by last event, then newest created, then id", () => {
    const pixels = [
      pixel("p1", { createdAt: "2026-09-01T00:00:00Z" }),
      pixel("p2", { createdAt: "2026-10-01T00:00:00Z" }),
      pixel("p3", { lastEventAt: "2026-11-01T00:00:00Z" })
    ];
    assert.deepEqual(rankPixels(pixels, []), ["p3", "p2", "p1"]);
  });
});

describe("planFormRestore", () => {
  const forms = [
    form("active1"),
    form("old", { isPublished: false, frozenAt: "2026-11-20T00:00:00Z", lastLeadAt: "2026-10-01T00:00:00Z" }),
    form("recent", { isPublished: false, frozenAt: "2026-11-10T00:00:00Z", lastLeadAt: "2026-11-01T00:00:00Z" }),
    form("nolead", { isPublished: false, frozenAt: "2026-11-21T00:00:00Z" }),
    form("notready", { isPublished: false, frozenAt: "2026-11-22T00:00:00Z", lastLeadAt: "2026-11-24T00:00:00Z" }),
    form("down", {
      isPublished: false,
      frozenAt: "2026-11-22T00:00:00Z",
      takenDownAt: "2026-11-23T00:00:00Z",
      lastLeadAt: "2026-11-25T00:00:00Z"
    }),
    form("draft", { isPublished: false })
  ];
  const ready = new Set(["old", "recent", "nolead", "down", "draft"]);

  it("restores only frozen, not taken down, ready forms in lead then frozen order", () => {
    assert.deepEqual(rankRestorableForms(forms, ready), ["recent", "old", "nolead"]);
    assert.deepEqual(planFormRestore(forms, ready, 30), ["recent", "old", "nolead"]);
  });

  it("is limited to the free slots and empty when full", () => {
    assert.deepEqual(planFormRestore(forms, ready, 3), ["recent", "old"]);
    assert.deepEqual(planFormRestore(forms, ready, 1), []);
  });
});

describe("planPixelRestore", () => {
  it("unfreezes the most recently frozen first, up to the free slots", () => {
    const pixels = [
      pixel("live"),
      pixel("a", { frozenAt: "2026-11-01T00:00:00Z" }),
      pixel("b", { frozenAt: "2026-11-05T00:00:00Z" }),
      pixel("c", { frozenAt: "2026-11-03T00:00:00Z" })
    ];
    assert.deepEqual(planPixelRestore(pixels, 3), ["b", "c"]);
    assert.deepEqual(planPixelRestore(pixels, 1), []);
  });
});

describe("previewFreeze", () => {
  const forms = [
    form("a", { name: "Alpha", lastLeadAt: "2026-11-10T00:00:00Z", metaPixelId: "p1" }),
    form("b", { name: "Beta", lastLeadAt: "2026-11-09T00:00:00Z" }),
    form("c", { name: "Gamma", lastLeadAt: "2026-11-08T00:00:00Z" }),
    form("d", { name: "Delta" }),
    form("e", { name: "Epsilon", metaPixelId: "p2" })
  ];
  const pixels = [pixel("p1", { name: "Main" }), pixel("p2", { name: "Second", lastEventAt: "2026-11-20T00:00:00Z" })];

  it("names what would freeze on the free plan", () => {
    assert.deepEqual(previewFreeze(forms, pixels, "free"), { formNames: ["Delta", "Epsilon"], pixelNames: ["Second"] });
  });

  it("is empty for suspended and for Scaling under the limit", () => {
    assert.deepEqual(previewFreeze(forms, pixels, "suspended"), { formNames: [], pixelNames: [] });
    assert.deepEqual(previewFreeze(forms, pixels, "scaling"), { formNames: [], pixelNames: [] });
  });
});

describe("canReactivateForm and canReactivatePixel", () => {
  it("refuses when suspended or full, allows with a free slot", () => {
    assert.deepEqual(canReactivateForm("suspended", 0), { allowed: false, message: SUSPENDED_MESSAGE });
    assert.deepEqual(canReactivateForm("free", 3), { allowed: false, message: activeLimitMessage(PLANS.free) });
    assert.deepEqual(canReactivateForm("free", 2), { allowed: true });
    assert.deepEqual(canReactivatePixel("suspended", 0), { allowed: false, message: SUSPENDED_MESSAGE });
    assert.deepEqual(canReactivatePixel("free", 1), { allowed: false, message: pixelLimitMessage(PLANS.free) });
    assert.deepEqual(canReactivatePixel("scaling", 2), { allowed: true });
  });

  it("maps swap errors to plain messages", () => {
    assert.equal(freezeMessageFromError("x FORMBOOK_FREEZE:same_form"), FREEZE_COPY.sameForm);
    assert.equal(freezeMessageFromError("FORMBOOK_FREEZE:not_active"), FREEZE_COPY.notActive);
    assert.equal(freezeMessageFromError("FORMBOOK_FREEZE:not_frozen"), FREEZE_COPY.notFrozen);
    assert.equal(freezeMessageFromError("something else"), null);
  });
});

describe("planDirection", () => {
  const cases: Array<[PlanState, PlanState, string]> = [
    ["free", "free", "none"],
    ["scaling", "scaling", "none"],
    ["suspended", "suspended", "none"],
    ["free", "scaling", "upgrade"],
    ["scaling", "free", "downgrade"],
    ["free", "suspended", "suspend"],
    ["scaling", "suspended", "suspend"],
    ["suspended", "free", "restore"],
    ["suspended", "scaling", "restore"]
  ];
  for (const [from, to, expected] of cases) {
    it(`${from} to ${to} is ${expected}`, () => {
      assert.equal(planDirection(from, to), expected);
    });
  }

  it("limitsOf reads the plan constants and is null for suspended", () => {
    assert.equal(limitsOf("suspended"), null);
    assert.deepEqual(limitsOf("free"), {
      maxActiveForms: PLANS.free.maxActiveForms,
      maxDraftForms: PLANS.free.maxDraftForms,
      maxPixels: PLANS.free.maxPixels
    });
  });
});

describe("resolveOwnerPlanChange", () => {
  const NOW = "2026-11-27T10:00:00.000Z";
  const clean = (plan: PlanState): TenantPlanFields => ({
    plan,
    plan_before_suspension: null,
    suspended_at: null,
    suspension_reason: null
  });
  const suspended = (before: "free" | "scaling" | null): TenantPlanFields => ({
    plan: "suspended",
    plan_before_suspension: before,
    suspended_at: "2026-11-01T00:00:00.000Z",
    suspension_reason: "Abuse report"
  });

  it("set: clears suspension fields, or does nothing when already clean", () => {
    assert.deepEqual(resolveOwnerPlanChange(clean("free"), { kind: "set", plan: "scaling" }, NOW).update, {
      plan: "scaling",
      plan_before_suspension: null,
      suspended_at: null,
      suspension_reason: null
    });
    assert.equal(resolveOwnerPlanChange(clean("scaling"), { kind: "set", plan: "scaling" }, NOW).update, null);
    const fromSuspended = resolveOwnerPlanChange(suspended("scaling"), { kind: "set", plan: "free" }, NOW);
    assert.equal(fromSuspended.resultingPlan, "free");
    assert.equal(fromSuspended.update?.suspended_at, null);
  });

  it("suspend: saves the plan on a fresh suspension, reason only when already suspended", () => {
    const fresh = resolveOwnerPlanChange(clean("scaling"), { kind: "suspend", reason: "Spam" }, NOW);
    assert.deepEqual(fresh.update, {
      plan: "suspended",
      plan_before_suspension: "scaling",
      suspended_at: NOW,
      suspension_reason: "Spam"
    });
    assert.equal(fresh.reasonOnly, false);
    const again = resolveOwnerPlanChange(suspended("free"), { kind: "suspend", reason: "New reason" }, NOW);
    assert.equal(again.reasonOnly, true);
    assert.deepEqual(again.update, { suspension_reason: "New reason", suspended_at: "2026-11-01T00:00:00.000Z" });
  });

  it("restore: back to saved Scaling, default free, nothing when not suspended", () => {
    assert.equal(resolveOwnerPlanChange(suspended("scaling"), { kind: "restore" }, NOW).update?.plan, "scaling");
    assert.equal(resolveOwnerPlanChange(suspended(null), { kind: "restore" }, NOW).update?.plan, "free");
    const none = resolveOwnerPlanChange(clean("free"), { kind: "restore" }, NOW);
    assert.equal(none.update, null);
    assert.equal(none.resultingPlan, "free");
  });

  it("mergePlanUpdate keeps fields the update leaves out", () => {
    const merged = mergePlanUpdate(suspended("free"), { suspension_reason: "Changed" });
    assert.equal(merged.plan, "suspended");
    assert.equal(merged.plan_before_suspension, "free");
    assert.equal(merged.suspension_reason, "Changed");
  });
});

describe("account reference", () => {
  it("accepts only the exact format", () => {
    assert.equal(isAccountRef(REF), true);
    assert.ok(ACCOUNT_REF_PATTERN.test(REF));
    assert.equal(isAccountRef(REF.toUpperCase()), false);
    assert.equal(isAccountRef(` ${REF}`), false);
    assert.equal(isAccountRef(null), false);
  });

  it("normalizes case and spaces, rejects prefix, length and non-hex", () => {
    assert.equal(normalizeAccountRef(`  ${REF.toUpperCase()} `), REF);
    assert.equal(normalizeAccountRef("fbx_" + "0123456789abcdef01234567"), null);
    assert.equal(normalizeAccountRef("fba_" + "0123456789abcdef0123456"), null);
    assert.equal(normalizeAccountRef("fba_" + "0123456789abcdef012345678"), null);
    assert.equal(normalizeAccountRef("fba_" + "0123456789abcdef0123456g"), null);
    assert.equal(normalizeAccountRef(42), null);
  });

  it("buildUpgradeUrl adds exactly one ref and keeps the owner's parameters", () => {
    const plain = buildUpgradeUrl(PAY, REF);
    assert.equal(plain, `${PAY}?ref=${REF}`);
    const withParams = new URL(buildUpgradeUrl(`${PAY}?utm_source=app&ref=old`, REF) ?? "");
    assert.equal(withParams.searchParams.get("utm_source"), "app");
    assert.deepEqual(withParams.searchParams.getAll("ref"), [REF]);
    assert.deepEqual([...withParams.searchParams.keys()].sort(), ["ref", "utm_source"]);
  });

  it("buildUpgradeUrl refuses unsafe bases and invalid references", () => {
    assert.equal(buildUpgradeUrl("http://pay.example.com/formbook", REF), null);
    assert.equal(buildUpgradeUrl("http://localhost:3000/pay", REF), null);
    assert.equal(buildUpgradeUrl("http://localhost:3000/pay", REF, { allowHttpLocalhost: true }), `http://localhost:3000/pay?ref=${REF}`);
    assert.equal(buildUpgradeUrl("http://pay.example.com/x", REF, { allowHttpLocalhost: true }), null);
    assert.equal(buildUpgradeUrl("https://user:pw@pay.example.com/formbook", REF), null);
    assert.equal(buildUpgradeUrl("javascript:alert(1)", REF), null);
    assert.equal(buildUpgradeUrl(`${PAY}?x=${"a".repeat(2000)}`, REF), null);
    assert.equal(buildUpgradeUrl(PAY, "someone@example.com"), null);
    assert.equal(buildUpgradeUrl(undefined, REF), null);
    assert.equal(buildUpgradeUrl("", REF), null);
  });

  it("buildBillingPortalUrl returns the URL unchanged", () => {
    const portal = "https://billing.example.com/portal?account=self";
    assert.equal(buildBillingPortalUrl(portal), portal);
    assert.equal(buildBillingPortalUrl("ftp://billing.example.com"), null);
    assert.equal(buildBillingPortalUrl(undefined), null);
    assert.equal(parseOwnerLink("not a url"), null);
  });

  it("planLinks reads env values and allows http://localhost outside production only", () => {
    assert.deepEqual(planLinks({}, REF), { upgradeUrl: null, billingPortalUrl: null });
    assert.deepEqual(planLinks({ FORMBOOK_UPGRADE_URL: PAY }, null), { upgradeUrl: null, billingPortalUrl: null });
    const local = "http://localhost:3000/pay";
    assert.equal(planLinks({ FORMBOOK_UPGRADE_URL: local, NODE_ENV: "development" }, REF).upgradeUrl, `${local}?ref=${REF}`);
    assert.equal(planLinks({ FORMBOOK_UPGRADE_URL: local, NODE_ENV: "production" }, REF).upgradeUrl, null);
  });
});

describe("limit messages and upgrade prompts", () => {
  it("free messages offer Scaling with its numbers; Scaling messages do not", () => {
    const free = [activeLimitMessage(PLANS.free), draftLimitMessage(PLANS.free), pixelLimitMessage(PLANS.free)];
    for (const message of free) {
      assert.ok(message.includes(UPGRADE_PHRASE), message);
      assert.equal(isUpgradeableLimitMessage(message), true);
    }
    assert.ok(free[0].includes(`up to ${PLANS.scaling.maxActiveForms} active forms`));
    assert.ok(free[1].includes(`up to ${PLANS.scaling.maxDraftForms} drafts`));
    assert.ok(free[2].includes(`up to ${PLANS.scaling.maxPixels} Meta pixels`));
    assert.equal(
      pixelLimitMessage(PLANS.free),
      "You have reached the limit of 1 Meta pixel on the Bootstrapping plan. Remove a pixel first, or upgrade to Scaling for up to 3 Meta pixels."
    );
    for (const message of [activeLimitMessage(PLANS.scaling), draftLimitMessage(PLANS.scaling), pixelLimitMessage(PLANS.scaling)]) {
      assert.equal(isUpgradeableLimitMessage(message), false, message);
    }
    assert.equal(isUpgradeableLimitMessage(SUSPENDED_MESSAGE), false);
    assert.equal(isUpgradeableLimitMessage(null), false);
    assert.equal(isUpgradeableLimitMessage(undefined), false);
  });
});

describe("owner plan helpers", () => {
  it("clientFormStatus: taken down, then active, then frozen, then draft", () => {
    assert.equal(clientFormStatus({ is_published: false, taken_down_at: null, frozen_at: "2026-11-01T00:00:00Z" }), "Frozen");
    assert.equal(
      clientFormStatus({ is_published: false, taken_down_at: "2026-11-02T00:00:00Z", frozen_at: "2026-11-01T00:00:00Z" }),
      "Taken down"
    );
    assert.equal(clientFormStatus({ is_published: true, taken_down_at: null, frozen_at: null }), "Active");
    assert.equal(clientFormStatus({ is_published: false, taken_down_at: null }), "Draft");
  });

  it("downgrade warnings use the exact wording", () => {
    assert.equal(
      planDowngradeWarning("free", 5),
      "This client has 5 active forms and the Bootstrapping plan allows 3. Switching freezes 2 of them, the ones with the oldest leads. Nothing is deleted, and the client can choose which forms stay active."
    );
    assert.equal(
      pixelDowngradeWarning("free", 3),
      "This client has 3 Meta pixels and the Bootstrapping plan allows 1. Switching freezes 2 of them. Nothing is deleted."
    );
    assert.equal(pixelDowngradeWarning("free", 1), null);
    assert.equal(pixelDowngradeWarning("suspended", 9), null);
    assert.equal(wouldFreezeLine(["Delta", " ", "Epsilon"]), "Would freeze: Delta, Epsilon");
    assert.equal(wouldFreezeLine([]), null);
  });

  it("plan change notices and query counts", () => {
    assert.deepEqual(planChangeNotice({ frozenForms: 2, frozenPixels: 1, restoredForms: 0, restoredPixels: 0 }), [
      "2 forms and 1 Meta pixel were frozen."
    ]);
    assert.deepEqual(planChangeNotice({ frozenForms: 0, frozenPixels: 0, restoredForms: 1, restoredPixels: 0 }), [
      "1 form was restored."
    ]);
    assert.deepEqual(planChangeNotice({ frozenForms: 0, frozenPixels: 0, restoredForms: 0, restoredPixels: 0 }), []);
    assert.deepEqual(planChangeParams({ frozenForms: 2, frozenPixels: 0, restoredForms: 0, restoredPixels: 1 }), {
      frozen_forms: "2",
      restored_pixels: "1"
    });
    assert.deepEqual(parsePlanChangeParams({ frozen_forms: "2", frozen_pixels: "abc", restored_forms: "5000", restored_pixels: ["1"] }), {
      frozenForms: 2,
      frozenPixels: 0,
      restoredForms: 0,
      restoredPixels: 0
    });
  });
});

describe("copy", () => {
  it("has no em dash in FREEZE_COPY or PLAN_COPY", () => {
    const strings: string[] = [];
    const collect = (value: unknown) => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") {
        strings.push(String(value(2, 1)), String(value(1, 0)), String(value(0, 1)), String(value(3)));
      } else if (Array.isArray(value)) value.forEach(collect);
    };
    Object.values(FREEZE_COPY).forEach(collect);
    Object.values(PLAN_COPY).forEach(collect);
    assert.ok(strings.length > 30);
    for (const value of strings) assert.ok(!value.includes(EM_DASH), value);
  });

  it("list banner wording", () => {
    assert.equal(FREEZE_COPY.listBanner(2, 1), "2 forms and 1 Meta pixel are frozen because your plan changed. Nothing was deleted.");
    assert.equal(FREEZE_COPY.listBanner(1, 0), "1 form is frozen because your plan changed. Nothing was deleted.");
    assert.equal(FREEZE_COPY.listBanner(0, 1), "1 Meta pixel is frozen because your plan changed. Nothing was deleted.");
    assert.equal(FREEZE_COPY.listBanner(3, 0), "3 forms are frozen because your plan changed. Nothing was deleted.");
  });

  it("plan page lists what Scaling adds from the plan constants", () => {
    assert.ok(PLAN_COPY.addsItems[0].includes(String(PLANS.scaling.maxActiveForms)));
    assert.ok(PLAN_COPY.addsItems[2].includes(String(PLANS.scaling.maxPixels)));
  });
});
