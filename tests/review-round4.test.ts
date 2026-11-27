import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { META_DEFER_SECONDS, funnelSendDecision, type FunnelSendState } from "@/lib/meta/delivery-rules";
import { deliverMetaRow } from "@/lib/meta/drain";
import { STATUS_REASON_LABELS } from "@/lib/meta/log-format";
import { DEFAULT_CONSENT_LABEL, consentCheckboxLabelFor } from "@/lib/meta/pixel-input";
import { funnelDeleteBlocker, funnelDeleteTestNote } from "@/lib/split-tests/rules";
import { KEYSET_MAX_ROWS, TOO_MUCH_DATA_MESSAGE, selectAllByKeyset } from "@/lib/supabase/paging";
import type { PixelSendConfig } from "@/lib/meta/pixels";
import type { MetaEventDelivery } from "@/lib/types/database";

const PIXEL = "11111111-1111-4111-8111-111111111111";
const OTHER_PIXEL = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const FUNNEL = "44444444-4444-4444-8444-444444444444";
const ROW_ID = "77777777-7777-4777-8777-777777777777";

function source(...parts: string[]): string {
  return readFileSync(path.join(process.cwd(), ...parts), "utf8");
}

function liveFunnel(overrides: Partial<FunnelSendState> = {}): FunnelSendState {
  return {
    meta_pixel_id: PIXEL,
    meta_consent_confirmed_at: "2026-11-20T10:00:00Z",
    is_published: true,
    taken_down_at: null,
    tenant_plan: "free",
    ...overrides
  };
}

function pixelConfig(): PixelSendConfig {
  return {
    id: PIXEL,
    tenantId: TENANT,
    datasetId: "123",
    accessToken: "token",
    testEventCode: null,
    sendingMode: "send" as PixelSendConfig["sendingMode"],
    switches: {} as PixelSendConfig["switches"]
  };
}

function pendingRow(): MetaEventDelivery {
  return {
    id: ROW_ID,
    tenant_id: TENANT,
    pixel_id: PIXEL,
    funnel_id: FUNNEL,
    lead_session_id: null,
    split_test_id: null,
    visitor_id: null,
    event_key: "lead",
    event_name: "Lead",
    event_id: "evt-1",
    event_time: "2026-11-25T10:00:00Z",
    payload: { event_name: "Lead" },
    match_keys: [],
    status: "pending",
    status_reason: null,
    attempts: 2,
    max_attempts: 8,
    next_attempt_at: "2026-11-25T10:00:00Z",
    lease_owner: "owner",
    lease_expires_at: null,
    meta_response: null,
    last_error: null,
    test_event_code_used: null,
    fired_by: null,
    fired_at: null,
    sent_at: null,
    created_at: "2026-11-25T10:00:00Z",
    updated_at: "2026-11-25T10:00:00Z"
  } as MetaEventDelivery;
}

describe("send-time form check: pauses wait, detaches skip", () => {
  const row = { pixel_id: PIXEL, funnel_id: FUNNEL };

  it("sends for a live form", () => {
    assert.equal(funnelSendDecision(row, liveFunnel()), "send");
  });

  it("defers an unpublished form or a suspended or unknown tenant", () => {
    assert.equal(funnelSendDecision(row, liveFunnel({ is_published: false })), "defer");
    assert.equal(funnelSendDecision(row, liveFunnel({ tenant_plan: "suspended" })), "defer");
    assert.equal(funnelSendDecision(row, liveFunnel({ tenant_plan: null })), "defer");
  });

  it("skips for good when the form is gone, detached, unconfirmed or taken down", () => {
    assert.equal(funnelSendDecision(row, null), "skip");
    assert.equal(funnelSendDecision({ ...row, funnel_id: null }, liveFunnel()), "skip");
    assert.equal(funnelSendDecision(row, liveFunnel({ meta_pixel_id: null })), "skip");
    assert.equal(funnelSendDecision(row, liveFunnel({ meta_pixel_id: OTHER_PIXEL })), "skip");
    assert.equal(funnelSendDecision(row, liveFunnel({ meta_consent_confirmed_at: null })), "skip");
    assert.equal(
      funnelSendDecision(row, liveFunnel({ taken_down_at: "2026-11-21T00:00:00Z", is_published: false })),
      "skip"
    );
  });

  it("a pending row of an unpublished form is deferred, not settled as skipped, and nothing is sent", async () => {
    const settled: string[] = [];
    let sends = 0;
    const outcome = await deliverMetaRow(pendingRow(), "owner", {
      loadPixel: async () => pixelConfig(),
      loadFunnelState: async () => liveFunnel({ is_published: false }),
      settle: async (_row, _owner, args) => {
        settled.push(`${args.outcome}:${args.reason ?? ""}`);
        return true;
      },
      send: async () => {
        sends++;
        throw new Error("must not send");
      },
      recordTestCode: async () => undefined
    });
    assert.equal(outcome, "deferred");
    assert.deepEqual(settled, ["deferred:form_paused"]);
    assert.equal(sends, 0);
  });

  it("a row whose form switched pixel is still skipped", async () => {
    const settled: string[] = [];
    await deliverMetaRow(pendingRow(), "owner", {
      loadPixel: async () => pixelConfig(),
      loadFunnelState: async () => liveFunnel({ meta_pixel_id: OTHER_PIXEL }),
      settle: async (_row, _owner, args) => {
        settled.push(`${args.outcome}:${args.reason ?? ""}`);
        return true;
      }
    });
    assert.deepEqual(settled, ["skipped:pixel_detached"]);
  });

  it("settle_meta_delivery keeps a deferred row pending, refunds the attempt and waits", () => {
    const sql = source("supabase", "migrations", "0027_meta_pixels_and_events.sql");
    assert.match(sql, /p_outcome not in \('sent', 'retry', 'failed', 'skipped', 'deferred'\)/);
    assert.match(sql, /if p_outcome = 'deferred' then\s+--[^\n]*\n(?:\s+--[^\n]*\n)*\s+update public\.meta_event_deliveries\s+set status = 'pending',/);
    assert.match(sql, /attempts = greatest\(attempts - 1, 0\),\s+next_attempt_at = now\(\) \+ interval '(\d+) seconds'/);
    const seconds = Number(/next_attempt_at = now\(\) \+ interval '(\d+) seconds'/.exec(sql)?.[1]);
    assert.equal(seconds, META_DEFER_SECONDS);
  });

  it("has a log label for the wait reason", () => {
    assert.ok(STATUS_REASON_LABELS.form_paused);
    assert.ok(!STATUS_REASON_LABELS.form_paused.includes("—"));
  });
});

describe("deleting a form in a split test", () => {
  it("is refused while a running test uses the form", () => {
    const message = funnelDeleteBlocker([
      { name: "Ended one", status: "ended" },
      { name: "Test 1", status: "running" }
    ]);
    assert.equal(message, 'This form is in the running split test "Test 1". End the test before you delete it.');
  });

  it("is allowed for draft or ended tests, with a note in the confirmation", () => {
    const tests = [
      { name: "Draft test", status: "draft" as const },
      { name: "Old test", status: "ended" as const }
    ];
    assert.equal(funnelDeleteBlocker(tests), null);
    assert.match(funnelDeleteTestNote(tests), /"Draft test", "Old test" will lose this form/);
    assert.match(funnelDeleteTestNote([tests[0]]), /The split test "Draft test" will lose this form/);
    assert.equal(funnelDeleteTestNote([]), "");
  });

  it("both delete paths check split tests and scope the delete to the tenant", () => {
    const action = source("app", "(admin)", "admin", "funnels", "actions.ts");
    assert.match(action, /funnelDeleteBlocker\(await listSplitTestsUsingFunnel\(tenantId, id\)\)/);
    assert.match(action, /deleteFunnel\(id, tenantId\)/);
    const route = source("app", "api", "funnels", "[id]", "route.ts");
    assert.match(route, /funnelDeleteBlocker\(await listSplitTestsUsingFunnel\(tenantId, id\)\)/);
    assert.match(route, /deleteFunnel\(id, tenantId\)/);
    const service = source("lib", "funnels", "service.ts");
    assert.match(service, /from\("funnels"\)\.delete\(\)\.eq\("id", id\)\.eq\("tenant_id", tenantId\)/);
  });
});

describe("public form load reads the consent checkbox with the form row", () => {
  it("derives the checkbox label from the row", () => {
    const row = {
      meta_pixel_id: PIXEL,
      meta_consent_confirmed_at: "2026-11-20T10:00:00Z",
      meta_consent_checkbox_enabled: true,
      meta_consent_checkbox_label: "  Share with Meta  "
    };
    assert.equal(consentCheckboxLabelFor(row), "Share with Meta");
    assert.equal(consentCheckboxLabelFor({ ...row, meta_consent_checkbox_label: " " }), DEFAULT_CONSENT_LABEL);
    assert.equal(consentCheckboxLabelFor({ ...row, meta_pixel_id: null }), null);
    assert.equal(consentCheckboxLabelFor({ ...row, meta_consent_confirmed_at: null }), null);
    assert.equal(consentCheckboxLabelFor({ ...row, meta_consent_checkbox_enabled: false }), null);
    assert.equal(consentCheckboxLabelFor({}), null);
    assert.equal(consentCheckboxLabelFor(null), null);
  });

  it("makes no separate funnels query for the checkbox", () => {
    const service = source("lib", "funnels", "service.ts");
    assert.doesNotMatch(service, /loadMetaConsentCheckboxLabel/);
    assert.match(service, /meta_pixel_id,meta_consent_confirmed_at,meta_consent_checkbox_enabled,meta_consent_checkbox_label/);
    assert.match(service, /consentCheckboxLabelFor\(funnelRow\)/);
  });
});

describe("selectAllByKeyset", () => {
  function fakeTable(total: number) {
    const ids = Array.from({ length: total }, (_, index) => ({ id: String(index).padStart(8, "0") }));
    const calls: Array<string | null> = [];
    const build = async (afterId: string | null, limit: number) => {
      calls.push(afterId);
      const start = afterId === null ? 0 : ids.findIndex((row) => row.id > afterId);
      return { data: start < 0 ? [] : ids.slice(start, start + limit), error: null };
    };
    return { calls, build };
  }

  it("reads every row by the last id, not by offset", async () => {
    const table = fakeTable(2500);
    const rows = await selectAllByKeyset(table.build);
    assert.equal(rows.length, 2500);
    assert.equal(new Set(rows.map((row) => row.id)).size, 2500);
    assert.deepEqual(table.calls, [null, "00000999", "00001999"]);
  });

  it("stops after an empty page on an exact multiple", async () => {
    const table = fakeTable(2000);
    assert.equal((await selectAllByKeyset(table.build)).length, 2000);
    assert.equal(table.calls.length, 3);
  });

  it("throws past the cap, which defaults to tens of thousands", async () => {
    assert.ok(KEYSET_MAX_ROWS <= 100000);
    await assert.rejects(selectAllByKeyset(fakeTable(5000).build, { maxRows: 2500 }), {
      message: TOO_MUCH_DATA_MESSAGE
    });
  });

  it("refuses a query that does not advance", async () => {
    const stuck = async () => ({ data: Array.from({ length: 2 }, () => ({ id: "a" })), error: null });
    await assert.rejects(selectAllByKeyset(stuck, { pageSize: 2 }), /did not advance/);
  });

  it("passes a query error on", async () => {
    await assert.rejects(selectAllByKeyset(async () => ({ data: null, error: { message: "boom" } })), {
      message: "boom"
    });
  });

  it("form analytics read history for that form only", () => {
    const service = source("lib", "analytics", "service.ts");
    assert.match(service, /lead_sessions!inner\(funnel_id\)/);
    assert.match(service, /query\.eq\("lead_sessions\.funnel_id", funnelId\)/);
    assert.doesNotMatch(service, /\.range\(from, to\)[\s\S]{0,40}analytics_events/);
  });
});
