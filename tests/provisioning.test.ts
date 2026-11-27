import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AUTOMATION_SUSPENSION_REASON,
  resolveProvisionPlanChange,
  type TenantPlanFields
} from "@/lib/provisioning/plan-change";

const NOW = "2026-11-26T12:00:00.000Z";
const EARLIER = "2026-11-01T00:00:00.000Z";

function active(plan: "free" | "scaling"): TenantPlanFields {
  return { plan, plan_before_suspension: null, suspended_at: null, suspension_reason: null };
}

describe("resolveProvisionPlanChange", () => {
  it("saves the paid plan when the automation suspends, so Restore brings it back", () => {
    const change = resolveProvisionPlanChange(active("scaling"), "suspended", NOW);
    assert.deepEqual(change.update, {
      plan: "suspended",
      plan_before_suspension: "scaling",
      suspended_at: NOW,
      suspension_reason: AUTOMATION_SUSPENSION_REASON
    });
    assert.equal(change.resultingPlan, "suspended");
  });

  it("leaves an existing suspension untouched when suspended again", () => {
    const current: TenantPlanFields = {
      plan: "suspended",
      plan_before_suspension: "scaling",
      suspended_at: EARLIER,
      suspension_reason: "Owner reason"
    };
    assert.equal(resolveProvisionPlanChange(current, "suspended", NOW).update, null);
  });

  it("lifts an automation suspension and clears every suspension field", () => {
    const current: TenantPlanFields = {
      plan: "suspended",
      plan_before_suspension: "scaling",
      suspended_at: EARLIER,
      suspension_reason: AUTOMATION_SUSPENSION_REASON
    };
    const change = resolveProvisionPlanChange(current, "scaling", NOW);
    assert.deepEqual(change.update, {
      plan: "scaling",
      plan_before_suspension: null,
      suspended_at: null,
      suspension_reason: null
    });
    assert.equal(change.resultingPlan, "scaling");
    assert.equal(change.keptOwnerSuspension, false);
  });

  it("never lifts an owner suspension; it only records the plan to restore to", () => {
    for (const reason of ["Spam forms", null]) {
      const current: TenantPlanFields = {
        plan: "suspended",
        plan_before_suspension: "free",
        suspended_at: EARLIER,
        suspension_reason: reason
      };
      const change = resolveProvisionPlanChange(current, "scaling", NOW);
      assert.deepEqual(change.update, { plan_before_suspension: "scaling" });
      assert.equal(change.resultingPlan, "suspended");
      assert.equal(change.keptOwnerSuspension, true);
    }
  });

  it("clears stale suspension fields on a plain plan change", () => {
    const current: TenantPlanFields = {
      plan: "free",
      plan_before_suspension: "scaling",
      suspended_at: EARLIER,
      suspension_reason: "old"
    };
    assert.deepEqual(resolveProvisionPlanChange(current, "free", NOW).update, {
      plan: "free",
      plan_before_suspension: null,
      suspended_at: null,
      suspension_reason: null
    });
  });

  it("does nothing when the plan already matches", () => {
    assert.equal(resolveProvisionPlanChange(active("scaling"), "scaling", NOW).update, null);
  });
});
