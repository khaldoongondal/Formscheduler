import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DAILY_CAPS, EMAIL_SEND_COOLDOWNS, IP_LIMITS } from "@/lib/security/limits";
import {
  buildBucketKey,
  buildDailyCapChecks,
  hashSubject,
  runCapChecks,
  type CapCheck
} from "@/lib/security/rate-limit-core";

const funnelId = "00000000-0000-0000-0000-00000000000f";
const tenantId = "00000000-0000-0000-0000-00000000000a";

/** Simulates the counters: "count" always adds, "capped" adds only while under the limit. */
function simulatedCounters() {
  const counters = new Map<string, number>();
  const hit = async (check: CapCheck) => {
    const current = counters.get(check.subject) ?? 0;
    if (check.mode === "capped") {
      if (current >= check.limit) return false;
      counters.set(check.subject, current + 1);
      return true;
    }
    counters.set(check.subject, current + 1);
    return current + 1 <= check.limit;
  };
  return { counters, hit };
}

function leadChecks(ipHash: string) {
  return buildDailyCapChecks({
    scope: "cap-lead",
    funnelId,
    tenantId,
    ipHash,
    perIpPerForm: DAILY_CAPS.leadSessionsPerIpPerForm,
    perForm: DAILY_CAPS.leadSessionsPerForm,
    perTenant: DAILY_CAPS.leadSessionsPerTenant
  });
}

describe("limit settings", () => {
  it("uses short per-address email cooldowns, not hourly lockouts", () => {
    for (const { limit, windowSeconds } of Object.values(EMAIL_SEND_COOLDOWNS)) {
      assert.ok(limit > 0 && windowSeconds > 0 && windowSeconds <= 600);
    }
  });

  it("gives signup resend its own budget, separate from signup", () => {
    assert.ok("signup-resend" in IP_LIMITS);
    assert.ok("signup" in IP_LIMITS);
  });

  it("keeps each per-IP form budget well below the shared caps", () => {
    assert.ok(DAILY_CAPS.leadSessionsPerIpPerForm * 20 <= DAILY_CAPS.leadSessionsPerForm);
    assert.ok(DAILY_CAPS.leadSessionsPerForm < DAILY_CAPS.leadSessionsPerTenant);
    assert.ok(DAILY_CAPS.analyticsPerIpPerForm * 20 <= DAILY_CAPS.analyticsPerForm);
    assert.ok(DAILY_CAPS.reportsPerIpPerForm < DAILY_CAPS.reportsPerForm);
  });

  it("keeps per-IP cap keys within the 200 character column limit", () => {
    const [ipCheck] = buildDailyCapChecks({
      scope: "cap-analytics",
      funnelId,
      ipHash: hashSubject("203.0.113.7", "salt"),
      perIpPerForm: 1,
      perForm: 2,
      perTenant: 3
    });
    assert.ok(buildBucketKey(ipCheck.scope, ipCheck.subject, 1_800_000_000).length <= 200);
    for (const scope of Object.keys(EMAIL_SEND_COOLDOWNS)) {
      assert.ok(buildBucketKey(scope, hashSubject("a@b.c", "s"), 1_800_000_000).length <= 200);
    }
  });
});

describe("daily cap checks", () => {
  it("orders checks per IP and form, then form, then tenant, with shared counters capped", () => {
    assert.deepEqual(
      buildDailyCapChecks({
        scope: "cap-lead",
        funnelId,
        tenantId,
        ipHash: "abc",
        perIpPerForm: 30,
        perForm: 2000,
        perTenant: 10000
      }).map((check) => [check.subject, check.limit, check.mode]),
      [
        [`ip-abc-form-${funnelId}`, 30, "count"],
        [`form-${funnelId}`, 2000, "capped"],
        [`tenant-${tenantId}`, 10000, "capped"]
      ]
    );
  });

  it("skips the IP check without an IP and the tenant check without a tenant cap", () => {
    const checks = buildDailyCapChecks({ scope: "cap-report", funnelId, perIpPerForm: 3, perForm: 50, perTenant: null });
    assert.deepEqual(
      checks.map((check) => check.subject),
      [`form-${funnelId}`]
    );
  });

  it("stops at the first block so shared counters are not touched", async () => {
    const called: string[] = [];
    const allowed = await runCapChecks(leadChecks("abc"), async (check) => {
      called.push(check.subject);
      return !check.subject.startsWith("ip-");
    });
    assert.equal(allowed, false);
    assert.deepEqual(called, [`ip-abc-form-${funnelId}`]);
  });

  it("one IP cannot use up a form's cap, and its blocked hits do not count", async () => {
    const { counters, hit } = simulatedCounters();
    let attackerAllowed = 0;
    for (let i = 0; i < 5000; i += 1) {
      if (await runCapChecks(leadChecks("attacker"), hit)) attackerAllowed += 1;
    }
    assert.equal(attackerAllowed, DAILY_CAPS.leadSessionsPerIpPerForm);
    assert.equal(counters.get(`form-${funnelId}`), DAILY_CAPS.leadSessionsPerIpPerForm);
    assert.equal(counters.get(`tenant-${tenantId}`), DAILY_CAPS.leadSessionsPerIpPerForm);
    assert.equal(await runCapChecks(leadChecks("visitor"), hit), true);
  });

  it("refused requests at a full form cap leave the tenant counter alone", async () => {
    const { counters, hit } = simulatedCounters();
    const checks = buildDailyCapChecks({ scope: "cap-lead", funnelId, tenantId, perIpPerForm: 1, perForm: 2, perTenant: 100 });
    for (let i = 0; i < 10; i += 1) await runCapChecks(checks, hit);
    assert.equal(counters.get(`form-${funnelId}`), 2);
    assert.equal(counters.get(`tenant-${tenantId}`), 2);
  });
});
