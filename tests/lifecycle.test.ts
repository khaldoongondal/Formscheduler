import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PlanState } from "@/lib/billing/plans";
import {
  drainLifecycleDeliveries,
  type LifecycleClaimedRow,
  type LifecycleDrainDeps,
  type LifecycleSettle
} from "@/lib/lifecycle/drain";
import {
  LIFECYCLE_COPY,
  LIFECYCLE_EVENTS,
  LIFECYCLE_PAYLOAD_KEYS,
  LIFECYCLE_SCHEMA,
  buildLifecyclePayload,
  isLifecycleEvent,
  lifecycleConfig,
  lifecycleEventForPlanChange,
  lifecycleHeaders,
  parseLifecycleSnapshot,
  type LifecycleSnapshot
} from "@/lib/lifecycle/events";
import {
  ACTIVATION_COPY,
  activationFunnel,
  clientStage,
  inPeriod,
  parsePeriod,
  pct,
  planHistoryEffect,
  type ActivationRow
} from "@/lib/owner/activation";
import { verifySignature } from "@/lib/webhooks/signing";

const EM_DASH = String.fromCharCode(0x2014);
// Built by concatenation so it never looks like a real key.
const SECRET = ["test", "lifecycle", "signing", "value", "0123456789"].join("-");
const REF = "fba_" + "0123456789abcdef01234567";
const ROW_ID = "6f1c2a1e-0000-4000-8000-0000000000aa";
const NOW_ISO = "2026-11-27T12:00:00.000Z";

const SNAPSHOT: LifecycleSnapshot = {
  account_ref: REF,
  contact_name: "Sam Example",
  email: "sam@example.com",
  phone: "+1 416 555 0123",
  business_name: "Example Studio",
  website: "https://example.com",
  plan: "free",
  signed_up_at: "2026-11-20T10:00:00.000Z",
  active_forms: 2,
  draft_forms: 1,
  frozen_forms: 1,
  meta_pixels: 1,
  connections: 2,
  leads_total: 14,
  bookings_total: 5
};

const DOCUMENTED_KEYS = [
  "schema",
  "event",
  "event_id",
  "occurred_at",
  "sent_at",
  "account_ref",
  "contact_name",
  "email",
  "phone",
  "business_name",
  "website",
  "plan",
  "plan_name",
  "previous_plan",
  "previous_plan_name",
  "frozen_forms_by_change",
  "frozen_pixels_by_change",
  "active_forms",
  "draft_forms",
  "frozen_forms",
  "meta_pixels",
  "connections",
  "leads_total",
  "bookings_total",
  "signed_up_at"
];

describe("lifecycleEventForPlanChange", () => {
  const states: Array<PlanState | null> = [null, "free", "scaling", "suspended"];
  const expected: Record<string, string | null> = {
    "null>free": null,
    "null>scaling": null,
    "null>suspended": null,
    "free>free": null,
    "free>scaling": "plan_changed",
    "free>suspended": "account_suspended",
    "scaling>free": "plan_changed",
    "scaling>scaling": null,
    "scaling>suspended": "account_suspended",
    "suspended>free": "account_restored",
    "suspended>scaling": "account_restored",
    "suspended>suspended": null
  };
  for (const from of states) {
    for (const to of ["free", "scaling", "suspended"] as PlanState[]) {
      const key = `${from}>${to}`;
      it(`${key} gives ${expected[key]}`, () => {
        assert.equal(lifecycleEventForPlanChange(from, to), expected[key]);
      });
    }
  }
});

describe("isLifecycleEvent", () => {
  it("accepts the nine events and nothing else", () => {
    assert.equal(LIFECYCLE_EVENTS.length, 9);
    for (const event of LIFECYCLE_EVENTS) assert.equal(isLifecycleEvent(event), true);
    assert.equal(isLifecycleEvent("lead.created"), false);
    assert.equal(isLifecycleEvent(undefined), false);
  });
});

describe("buildLifecyclePayload", () => {
  it("builds a full payload from the snapshot", () => {
    const payload = buildLifecyclePayload(
      { id: ROW_ID, event: "first_lead", occurred_at: "2026-11-26T09:00:00.000Z", details: {} },
      SNAPSHOT,
      NOW_ISO
    );
    assert.ok(payload);
    assert.equal(payload.schema, LIFECYCLE_SCHEMA);
    assert.equal(payload.event, "first_lead");
    assert.equal(payload.event_id, ROW_ID);
    assert.equal(payload.sent_at, NOW_ISO);
    assert.equal(payload.occurred_at, "2026-11-26T09:00:00.000Z");
    assert.equal(payload.account_ref, REF);
    assert.equal(payload.email, "sam@example.com");
    assert.equal(payload.plan, "free");
    assert.equal(payload.plan_name, "Bootstrapping");
    assert.equal(payload.previous_plan, "");
    assert.equal(payload.previous_plan_name, "");
    assert.equal(payload.frozen_forms_by_change, 0);
    assert.equal(payload.frozen_pixels_by_change, 0);
    assert.equal(payload.leads_total, 14);
    assert.equal(payload.bookings_total, 5);
    assert.equal(payload.signed_up_at, SNAPSHOT.signed_up_at);
  });

  it("turns nulls into empty strings", () => {
    const payload = buildLifecyclePayload(
      { id: ROW_ID, event: "signup_verified", occurred_at: NOW_ISO, details: {} },
      { ...SNAPSHOT, contact_name: null, email: null, phone: null, business_name: null, website: null },
      NOW_ISO
    );
    assert.ok(payload);
    for (const key of ["contact_name", "email", "phone", "business_name", "website"] as const) {
      assert.equal(payload[key], "");
    }
  });

  it("fills the previous plan and change counts for plan events", () => {
    const payload = buildLifecyclePayload(
      {
        id: ROW_ID,
        event: "plan_changed",
        occurred_at: NOW_ISO,
        details: { from_plan: "scaling", to_plan: "free", frozen_forms: 4, frozen_pixels: 2, restored_forms: 0, restored_pixels: 0 }
      },
      SNAPSHOT,
      NOW_ISO
    );
    assert.ok(payload);
    assert.equal(payload.previous_plan, "scaling");
    assert.equal(payload.previous_plan_name, "Scaling");
    assert.equal(payload.frozen_forms_by_change, 4);
    assert.equal(payload.frozen_pixels_by_change, 2);

    const suspended = buildLifecyclePayload(
      { id: ROW_ID, event: "account_suspended", occurred_at: NOW_ISO, details: { from_plan: "free", to_plan: "suspended" } },
      { ...SNAPSHOT, plan: "suspended" },
      NOW_ISO
    );
    assert.equal(suspended?.plan_name, "Suspended");
    assert.equal(suspended?.previous_plan_name, "Bootstrapping");
  });

  it("leaves plan fields empty for non-plan events even when details carry them", () => {
    const payload = buildLifecyclePayload(
      { id: ROW_ID, event: "first_booking", occurred_at: NOW_ISO, details: { from_plan: "scaling", frozen_forms: 3 } },
      SNAPSHOT,
      NOW_ISO
    );
    assert.equal(payload?.previous_plan, "");
    assert.equal(payload?.frozen_forms_by_change, 0);
  });

  it("has exactly the documented keys and nothing that identifies a tenant, user or secret", () => {
    const payload = buildLifecyclePayload({ id: ROW_ID, event: "test_ping", occurred_at: NOW_ISO, details: {} }, SNAPSHOT, NOW_ISO);
    assert.ok(payload);
    assert.deepEqual(Object.keys(payload), DOCUMENTED_KEYS);
    assert.deepEqual([...LIFECYCLE_PAYLOAD_KEYS], DOCUMENTED_KEYS);
    for (const key of Object.keys(payload)) {
      assert.doesNotMatch(key, /tenant|user|token|secret/i);
    }
  });

  it("returns null for an unknown event or a missing account reference", () => {
    assert.equal(buildLifecyclePayload({ id: ROW_ID, event: "lead.created", occurred_at: NOW_ISO, details: {} }, SNAPSHOT, NOW_ISO), null);
    assert.equal(
      buildLifecyclePayload({ id: ROW_ID, event: "first_lead", occurred_at: NOW_ISO, details: {} }, { ...SNAPSHOT, account_ref: "" }, NOW_ISO),
      null
    );
  });
});

describe("parseLifecycleSnapshot", () => {
  it("normalises the database snapshot and rejects one without a reference", () => {
    const parsed = parseLifecycleSnapshot({ ...SNAPSHOT, leads_total: "14", contact_name: "" });
    assert.equal(parsed?.leads_total, 14);
    assert.equal(parsed?.contact_name, null);
    assert.equal(parseLifecycleSnapshot({ ...SNAPSHOT, account_ref: null }), null);
    assert.equal(parseLifecycleSnapshot(null), null);
  });
});

describe("lifecycleConfig", () => {
  const url = "https://hooks.example.com/lifecycle";
  it("is null when unset", () => {
    assert.equal(lifecycleConfig({}), null);
    assert.equal(lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: url }), null);
    assert.equal(lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET }), null);
  });
  it("refuses http, credentials and long URLs", () => {
    assert.equal(lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: "http://hooks.example.com/x", FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET }), null);
    assert.equal(
      lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: "https://user:pw@hooks.example.com/x", FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET }),
      null
    );
    assert.equal(
      lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: `https://hooks.example.com/${"a".repeat(2048)}`, FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET }),
      null
    );
    assert.equal(lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: "not a url", FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET }), null);
  });
  it("refuses a short secret", () => {
    assert.equal(lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: url, FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: "short" }), null);
  });
  it("accepts a valid pair", () => {
    const config = lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: url, FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET });
    assert.ok(config);
    assert.equal(config.url.toString(), url);
    assert.equal(config.secret, SECRET);
  });
});

describe("lifecycleHeaders", () => {
  it("signs the raw body so verifySignature accepts it", () => {
    const rawBody = JSON.stringify({ hello: "world" });
    const headers = lifecycleHeaders({ secret: SECRET, timestampSec: 1_800_000_000, rawBody, event: "first_lead", eventId: ROW_ID });
    assert.equal(headers["Content-Type"], "application/json");
    assert.equal(headers["User-Agent"], "FormBook-Lifecycle/1.0");
    assert.equal(headers["X-FormBook-Event"], "first_lead");
    assert.equal(headers["X-FormBook-Event-Id"], ROW_ID);
    assert.equal(headers["X-FormBook-Timestamp"], "1800000000");
    assert.equal(verifySignature(headers["X-FormBook-Signature"], rawBody, SECRET, 1_800_000_010), true);
    assert.equal(verifySignature(headers["X-FormBook-Signature"], rawBody + " ", SECRET, 1_800_000_010), false);
  });
});

function makeRow(index: number, event = "first_lead"): LifecycleClaimedRow {
  return {
    id: `6f1c2a1e-0000-4000-8000-00000000000${index}`,
    tenant_id: "6f1c2a1e-0000-4000-8000-0000000000ff",
    event: event as LifecycleClaimedRow["event"],
    occurred_at: NOW_ISO,
    details: {}
  };
}

function harness(opts: { rows: LifecycleClaimedRow[]; status?: number | null; snapshot?: LifecycleSnapshot | null; configured?: boolean; stepMs?: number }) {
  let clock = 0;
  const settles: Array<{ id: string; args: LifecycleSettle }> = [];
  const released: string[] = [];
  const posts: Array<{ body: string; headers: Record<string, string> }> = [];
  let claimCalls = 0;
  let served = false;
  const deps: Partial<LifecycleDrainDeps> = {
    config: () =>
      opts.configured === false
        ? null
        : lifecycleConfig({ FORMBOOK_LIFECYCLE_WEBHOOK_URL: "https://hooks.example.com/in", FORMBOOK_LIFECYCLE_WEBHOOK_SECRET: SECRET }),
    claim: async () => {
      claimCalls += 1;
      if (served) return [];
      served = true;
      return opts.rows;
    },
    claimByIds: async (_owner, ids) => opts.rows.filter((row) => ids.includes(row.id)),
    settle: async (row, _owner, args) => {
      settles.push({ id: row.id, args });
      return true;
    },
    release: async (row) => {
      released.push(row.id);
    },
    loadSnapshot: async () => (opts.snapshot === undefined ? SNAPSHOT : opts.snapshot),
    post: async (_url, body, headers) => {
      posts.push({ body, headers });
      clock += opts.stepMs ?? 100;
      return { status: opts.status === undefined ? 200 : opts.status, bodySnippet: "", error: null };
    },
    now: () => Date.parse(NOW_ISO) + clock
  };
  return { deps, settles, released, posts, claimCalls: () => claimCalls };
}

describe("drainLifecycleDeliveries", () => {
  const OWNER = "6f1c2a1e-0000-4000-8000-0000000000ee";

  it("claims nothing when not configured", async () => {
    const h = harness({ rows: [makeRow(1)], configured: false });
    const tally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, h.deps);
    assert.equal(tally.configured, false);
    assert.equal(tally.claimed, 0);
    assert.equal(h.claimCalls(), 0);
    assert.equal(h.posts.length, 0);
  });

  it("settles a 2xx as sent with a signed body", async () => {
    const h = harness({ rows: [makeRow(1)] });
    const tally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, h.deps);
    assert.deepEqual(tally, { claimed: 1, sent: 1, retried: 0, failed: 0, skipped: 0, configured: true });
    assert.equal(h.settles[0].args.outcome, "sent");
    const post = h.posts[0];
    const body = JSON.parse(post.body);
    assert.equal(body.event_id, makeRow(1).id);
    assert.equal(body.account_ref, REF);
    assert.equal(verifySignature(post.headers["X-FormBook-Signature"], post.body, SECRET, Math.floor(Date.parse(NOW_ISO) / 1000)), true);
  });

  it("retries a 500 and fails a 400", async () => {
    const retry = harness({ rows: [makeRow(1)], status: 500 });
    const retryTally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, retry.deps);
    assert.equal(retryTally.retried, 1);
    assert.equal(retry.settles[0].args.outcome, "retry");
    assert.equal(retry.settles[0].args.status, 500);

    const fail = harness({ rows: [makeRow(1)], status: 400 });
    const failTally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, fail.deps);
    assert.equal(failTally.failed, 1);
    assert.equal(fail.settles[0].args.outcome, "failed");
    assert.ok((fail.settles[0].args.error ?? "").length <= 200);
  });

  it("skips a row whose tenant snapshot is missing, and an unknown event", async () => {
    const missing = harness({ rows: [makeRow(1)], snapshot: null });
    const tally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, missing.deps);
    assert.equal(tally.skipped, 1);
    assert.deepEqual(missing.settles[0].args, { outcome: "skipped", reason: "tenant_missing" });
    assert.equal(missing.posts.length, 0);

    const bad = harness({ rows: [makeRow(2, "lead.created")] });
    await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, bad.deps);
    assert.deepEqual(bad.settles[0].args, { outcome: "skipped", reason: "bad_event" });
  });

  it("stops at the budget and releases the rows it did not send", async () => {
    const h = harness({ rows: [makeRow(1), makeRow(2), makeRow(3)], stepMs: 7000 });
    const tally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 10 }, h.deps);
    assert.equal(tally.claimed, 3);
    assert.equal(tally.sent, 1);
    assert.deepEqual(h.released, [makeRow(2).id, makeRow(3).id]);
  });

  it("sends only the given ids for the owner's test", async () => {
    const h = harness({ rows: [makeRow(1, "test_ping"), makeRow(2)] });
    const tally = await drainLifecycleDeliveries(OWNER, { budgetMs: 20000, limit: 1, ids: [makeRow(1).id] }, h.deps);
    assert.equal(tally.sent, 1);
    assert.equal(h.claimCalls(), 0);
    assert.equal(JSON.parse(h.posts[0].body).event, "test_ping");
  });
});

const NOW = new Date("2026-11-27T00:00:00.000Z");
const DAY = 86_400_000;

function tenant(id: string, overrides: Partial<ActivationRow> = {}): ActivationRow {
  return {
    tenantId: id,
    signupSource: "self_serve",
    plan: "free",
    createdAt: new Date(NOW.getTime() - 5 * DAY).toISOString(),
    firstConnectionAt: null,
    firstFormActivatedAt: null,
    firstLeadAt: null,
    firstBookingAt: null,
    everScaling: false,
    ...overrides
  };
}

const T = "2026-11-25T00:00:00.000Z";

describe("activationFunnel", () => {
  const rows: ActivationRow[] = [
    tenant("t1", { firstConnectionAt: T, firstFormActivatedAt: T, firstLeadAt: T, firstBookingAt: T, everScaling: true }),
    tenant("t2", { firstConnectionAt: T, firstFormActivatedAt: T, firstLeadAt: T }),
    tenant("t3", { firstConnectionAt: T, firstFormActivatedAt: T }),
    tenant("t4", { firstConnectionAt: T }),
    tenant("t5"),
    tenant("t6", { signupSource: "provisioned", firstConnectionAt: T, firstFormActivatedAt: T, firstLeadAt: T, firstBookingAt: T }),
    tenant("t7", { signupSource: "provisioned", plan: "scaling", everScaling: true }),
    tenant("t8", { firstConnectionAt: T }),
    tenant("l1", { signupSource: "legacy", firstConnectionAt: T, firstFormActivatedAt: T, firstLeadAt: T, everScaling: true }),
    tenant("l2", { signupSource: "legacy" })
  ];
  const pending = [T, T, T];

  it("gives the exact counts and percentages for the worked example", () => {
    const { steps, excludedLegacy } = activationFunnel(rows, pending, "all", NOW);
    assert.equal(excludedLegacy, 2);
    const byKey = Object.fromEntries(steps.map((step) => [step.key, step]));
    assert.deepEqual(
      steps.map((step) => step.key),
      ["signed_up", "verified", "connected", "first_active_form", "first_lead", "first_booking", "upgraded"]
    );
    assert.deepEqual(
      steps.map((step) => step.count),
      [11, 8, 6, 4, 3, 2, 2]
    );
    assert.deepEqual(
      steps.map((step) => step.pctOfSignups),
      [100, 73, 55, 36, 27, 18, 18]
    );
    assert.deepEqual(
      steps.map((step) => step.pctOfBase),
      [null, 73, 75, 67, 75, 67, 25]
    );
    assert.equal(byKey.signed_up.baseLabel, null);
    assert.equal(byKey.upgraded.baseLabel, ACTIVATION_COPY.steps.verified);
    assert.equal(byKey.connected.baseLabel, ACTIVATION_COPY.steps.verified);
    assert.equal(byKey.first_booking.baseLabel, ACTIVATION_COPY.steps.first_lead);
  });

  it("gives null percentages when a base is zero", () => {
    const { steps } = activationFunnel([], [], "all", NOW);
    for (const step of steps) {
      assert.equal(step.count, 0);
      assert.equal(step.pctOfSignups, null);
      assert.equal(step.pctOfBase, null);
    }
    const onlyPending = activationFunnel([], [T], "all", NOW).steps;
    assert.equal(onlyPending[0].pctOfSignups, 100);
    assert.equal(onlyPending[1].pctOfBase, 0);
    assert.equal(onlyPending[2].pctOfBase, null);
  });

  it("filters by signup date, inclusive at exactly 30 days", () => {
    const exactly30 = new Date(NOW.getTime() - 30 * DAY).toISOString();
    const justOver = new Date(NOW.getTime() - 30 * DAY - 1).toISOString();
    assert.equal(inPeriod(exactly30, "30", NOW), true);
    assert.equal(inPeriod(justOver, "30", NOW), false);
    assert.equal(inPeriod(justOver, "90", NOW), true);
    assert.equal(inPeriod("2020-01-01T00:00:00.000Z", "all", NOW), true);
    assert.equal(inPeriod("not a date", "30", NOW), false);

    const periodRows = [
      tenant("a", { createdAt: exactly30 }),
      tenant("b", { createdAt: justOver }),
      tenant("c", { createdAt: justOver, signupSource: "legacy" })
    ];
    const result = activationFunnel(periodRows, [exactly30, justOver], "30", NOW);
    assert.equal(result.steps[0].count, 2);
    assert.equal(result.steps[1].count, 1);
    assert.equal(result.excludedLegacy, 0);
    assert.equal(activationFunnel(periodRows, [], "90", NOW).excludedLegacy, 1);
  });

  it("parses the period with a safe default", () => {
    assert.equal(parsePeriod("30"), "30");
    assert.equal(parsePeriod("90"), "90");
    assert.equal(parsePeriod(["90", "30"]), "90");
    assert.equal(parsePeriod("7"), "all");
    assert.equal(parsePeriod(undefined), "all");
  });

  it("rounds percentages and returns null for a zero whole", () => {
    assert.equal(pct(1, 3), 33);
    assert.equal(pct(2, 3), 67);
    assert.equal(pct(0, 0), null);
  });
});

describe("clientStage", () => {
  const none = { firstConnectionAt: null, firstFormActivatedAt: null, firstLeadAt: null, firstBookingAt: null };
  it("picks the furthest milestone even when an earlier one is missing", () => {
    assert.equal(clientStage(none), "verified");
    assert.equal(clientStage({ ...none, firstConnectionAt: T }), "connected");
    assert.equal(clientStage({ ...none, firstFormActivatedAt: T }), "form_live");
    assert.equal(clientStage({ ...none, firstLeadAt: T }), "first_lead");
    assert.equal(clientStage({ ...none, firstBookingAt: T }), "first_booking");
    assert.equal(clientStage({ firstConnectionAt: T, firstFormActivatedAt: T, firstLeadAt: T, firstBookingAt: T }), "first_booking");
  });
});

describe("planHistoryEffect", () => {
  it("lists non-zero parts and a dash when nothing changed", () => {
    assert.equal(planHistoryEffect({ frozenForms: 0, frozenPixels: 0, restoredForms: 0, restoredPixels: 0, endedSplitTests: 0 }), "-");
    assert.equal(
      planHistoryEffect({ frozenForms: 2, frozenPixels: 1, restoredForms: 0, restoredPixels: 0, endedSplitTests: 1 }),
      "2 forms frozen, 1 pixel frozen, 1 split test ended"
    );
  });
});

describe("lifecycle and activation copy", () => {
  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "function") return [String((value as (n: number) => string)(1)), String((value as (n: number) => string)(2))];
    if (value && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  }
  it("has no em dash", () => {
    for (const text of [...strings(LIFECYCLE_COPY), ...strings(ACTIVATION_COPY)]) {
      assert.equal(text.includes(EM_DASH), false, text);
    }
  });
});
