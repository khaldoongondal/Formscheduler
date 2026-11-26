import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONTACT_EMAIL,
  PLANS,
  PLAN_IDS,
  PLAN_CHECK_FAILED_MESSAGE,
  SUSPENDED_MESSAGE,
  TAKEN_DOWN_MESSAGE,
  activeLimitMessage,
  checkFormLimit,
  draftLimitMessage,
  formatPlanPrice,
  isPlanId,
  isPlanState,
  parsePlanState,
  planLimitMessageFromError,
  type FormLimitResult
} from "@/lib/billing/plans";

const EM_DASH = String.fromCharCode(0x2014);

function blockedReason(result: FormLimitResult) {
  return result.allowed ? null : result.reason;
}

describe("plan definitions", () => {
  it("free is Bootstrapping with 3 active, 10 drafts, 1 pixel at no cost", () => {
    assert.deepEqual(PLANS.free, {
      id: "free",
      name: "Bootstrapping",
      monthlyPriceCents: 0,
      maxActiveForms: 3,
      maxDraftForms: 10,
      maxPixels: 1
    });
  });

  it("scaling is Scaling at 1447 cents with 30 active, 100 drafts, 3 pixels", () => {
    assert.deepEqual(PLANS.scaling, {
      id: "scaling",
      name: "Scaling",
      monthlyPriceCents: 1447,
      maxActiveForms: 30,
      maxDraftForms: 100,
      maxPixels: 3
    });
  });

  it("lists exactly the two plan ids", () => {
    assert.deepEqual([...PLAN_IDS], ["free", "scaling"]);
    assert.equal(isPlanId("free"), true);
    assert.equal(isPlanId("suspended"), false);
    assert.equal(isPlanState("suspended"), true);
    assert.equal(isPlanState("tier1"), false);
  });
});

describe("parsePlanState", () => {
  it("maps legacy tiers to scaling", () => {
    for (const tier of ["tier1", "tier2", "tier3"]) {
      assert.equal(parsePlanState(tier), "scaling");
    }
  });

  it("passes current states through", () => {
    assert.equal(parsePlanState("free"), "free");
    assert.equal(parsePlanState("scaling"), "scaling");
    assert.equal(parsePlanState("suspended"), "suspended");
  });

  it("falls back to free for anything else", () => {
    assert.equal(parsePlanState(null), "free");
    assert.equal(parsePlanState(undefined), "free");
    assert.equal(parsePlanState("gold"), "free");
    assert.equal(parsePlanState(3), "free");
  });
});

describe("checkFormLimit", () => {
  it("free activate is allowed at 2 active and blocked at 3", () => {
    assert.deepEqual(checkFormLimit("free", { activeForms: 2, draftForms: 0 }, "activate"), { allowed: true });
    const blocked = checkFormLimit("free", { activeForms: 3, draftForms: 0 }, "activate");
    assert.equal(blockedReason(blocked), "active_forms");
    assert.equal(blocked.allowed ? "" : blocked.message, activeLimitMessage(PLANS.free));
  });

  it("free create_draft is allowed at 9 drafts and blocked at 10", () => {
    assert.deepEqual(checkFormLimit("free", { activeForms: 0, draftForms: 9 }, "create_draft"), { allowed: true });
    const blocked = checkFormLimit("free", { activeForms: 0, draftForms: 10 }, "create_draft");
    assert.equal(blockedReason(blocked), "draft_forms");
    assert.equal(blocked.allowed ? "" : blocked.message, draftLimitMessage(PLANS.free));
  });

  it("scaling activate is allowed at 29 and blocked at 30", () => {
    assert.deepEqual(checkFormLimit("scaling", { activeForms: 29, draftForms: 0 }, "activate"), { allowed: true });
    assert.equal(blockedReason(checkFormLimit("scaling", { activeForms: 30, draftForms: 0 }, "activate")), "active_forms");
  });

  it("scaling create_draft is allowed at 99 and blocked at 100", () => {
    assert.deepEqual(checkFormLimit("scaling", { activeForms: 0, draftForms: 99 }, "create_draft"), { allowed: true });
    assert.equal(
      blockedReason(checkFormLimit("scaling", { activeForms: 0, draftForms: 100 }, "create_draft")),
      "draft_forms"
    );
  });

  it("active and draft limits are counted separately", () => {
    assert.deepEqual(checkFormLimit("free", { activeForms: 3, draftForms: 0 }, "create_draft"), { allowed: true });
    assert.deepEqual(checkFormLimit("free", { activeForms: 0, draftForms: 10 }, "activate"), { allowed: true });
  });

  it("deactivate is always allowed, even suspended or over the limit", () => {
    assert.deepEqual(checkFormLimit("free", { activeForms: 50, draftForms: 50 }, "deactivate"), { allowed: true });
    assert.deepEqual(checkFormLimit("suspended", { activeForms: 0, draftForms: 0 }, "deactivate"), { allowed: true });
  });

  it("suspended blocks create and activate", () => {
    const create = checkFormLimit("suspended", { activeForms: 0, draftForms: 0 }, "create_draft");
    const activate = checkFormLimit("suspended", { activeForms: 0, draftForms: 0 }, "activate");
    assert.equal(blockedReason(create), "suspended");
    assert.equal(blockedReason(activate), "suspended");
    assert.equal(create.allowed ? "" : create.message, SUSPENDED_MESSAGE);
  });
});

describe("messages", () => {
  it("use the exact wording", () => {
    assert.equal(
      activeLimitMessage(PLANS.free),
      `You have reached the limit of 3 active forms on the Bootstrapping plan. Switch another form to draft first, or email ${CONTACT_EMAIL} about the Scaling plan.`
    );
    assert.equal(
      activeLimitMessage(PLANS.scaling),
      "You have reached the limit of 30 active forms on the Scaling plan. Switch another form to draft first."
    );
    assert.equal(
      draftLimitMessage(PLANS.free),
      "You have reached the limit of 10 draft forms on the Bootstrapping plan. Delete a draft you no longer need, then try again."
    );
    assert.equal(SUSPENDED_MESSAGE, `This account is suspended. Email ${CONTACT_EMAIL} to restore it.`);
  });

  it("planLimitMessageFromError maps trigger errors and ignores unrelated text", () => {
    assert.equal(planLimitMessageFromError("x FORMBOOK_LIMIT:active_forms y", "free"), activeLimitMessage(PLANS.free));
    assert.equal(
      planLimitMessageFromError("FORMBOOK_LIMIT:active_forms", "scaling"),
      activeLimitMessage(PLANS.scaling)
    );
    assert.equal(planLimitMessageFromError("FORMBOOK_LIMIT:draft_forms", "scaling"), draftLimitMessage(PLANS.scaling));
    assert.equal(planLimitMessageFromError("FORMBOOK_LIMIT:suspended"), SUSPENDED_MESSAGE);
    assert.equal(planLimitMessageFromError("FORMBOOK_LIMIT:taken_down"), TAKEN_DOWN_MESSAGE);
    assert.equal(planLimitMessageFromError("FORMBOOK_LIMIT:tenant_missing"), PLAN_CHECK_FAILED_MESSAGE);
    assert.equal(planLimitMessageFromError("FORMBOOK_LIMIT:unknown_plan"), PLAN_CHECK_FAILED_MESSAGE);
    assert.equal(planLimitMessageFromError("duplicate key value violates unique constraint"), null);
    assert.equal(planLimitMessageFromError(""), null);
  });

  it("no message contains an em dash", () => {
    const messages = [
      activeLimitMessage(PLANS.free),
      activeLimitMessage(PLANS.scaling),
      draftLimitMessage(PLANS.free),
      draftLimitMessage(PLANS.scaling),
      SUSPENDED_MESSAGE,
      PLAN_CHECK_FAILED_MESSAGE,
      TAKEN_DOWN_MESSAGE
    ];
    for (const msg of messages) {
      assert.ok(!msg.includes(EM_DASH), msg);
    }
  });
});

describe("formatPlanPrice", () => {
  it("formats free and paid plans", () => {
    assert.equal(formatPlanPrice(PLANS.free), "Free");
    assert.equal(formatPlanPrice(PLANS.scaling), "$14.47 a month");
  });
});
