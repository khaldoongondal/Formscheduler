import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  WORST_CASE_DELIVERY_MS,
  classifyFailure,
  retryDelaySeconds,
  shouldStopClaiming
} from "@/lib/meta/delivery-rules";

describe("retryDelaySeconds", () => {
  it("doubles from 30 seconds and caps at an hour", () => {
    assert.deepEqual(
      [1, 2, 3, 4, 5, 6, 7, 8].map(retryDelaySeconds),
      [30, 60, 120, 240, 480, 960, 1920, 3600]
    );
    for (let n = 1; n <= 40; n++) assert.ok(retryDelaySeconds(n) <= 3600);
  });
});

describe("classifyFailure", () => {
  it("retries network errors, transient errors, rate limits and 5xx", () => {
    assert.equal(classifyFailure(null), "retry");
    assert.equal(classifyFailure(400, { error: { is_transient: true, code: 100 } }), "retry");
    assert.equal(classifyFailure(400, { error: { code: 613 } }), "retry");
    assert.equal(classifyFailure(429), "retry");
    assert.equal(classifyFailure(503), "retry");
  });
  it("fails other 4xx", () => {
    assert.equal(classifyFailure(400, { error: { code: 190 } }), "failed");
    assert.equal(classifyFailure(404), "failed");
  });
});

describe("shouldStopClaiming", () => {
  it("stops exactly when the remaining budget fits one worst-case delivery", () => {
    const budget = 45000;
    const started = 1000;
    assert.equal(shouldStopClaiming(started, started + budget - WORST_CASE_DELIVERY_MS - 1, budget), false);
    assert.equal(shouldStopClaiming(started, started + budget - WORST_CASE_DELIVERY_MS, budget), true);
  });
});
