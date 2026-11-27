import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { visitorCookieToWrite } from "@/lib/booking/visitor-id";
import { FUNNEL_COPY_RESETS, funnelCopyPayload } from "@/lib/funnels/copy-payload";
import { SERVER_ONLY_SESSION_FIELDS, toAbandonResponse, toPublicSession } from "@/lib/lead-sessions/public";
import {
  CRON_DRAIN_BATCH_SIZE,
  CRON_DRAIN_ROW_LIMIT,
  funnelStillSends,
  type FunnelSendState
} from "@/lib/meta/delivery-rules";
import { leadEventRef, toClientEvents } from "@/lib/meta/client-events";
import { META_CONTROLS_COPY, STATUS_REASON_LABELS } from "@/lib/meta/log-format";
import { pixelDetached } from "@/lib/meta/pixel-input";
import type { LeadSession } from "@/lib/types/database";

const PIXEL = "11111111-1111-4111-8111-111111111111";
const OTHER_PIXEL = "22222222-2222-4222-8222-222222222222";
const TENANT = "33333333-3333-4333-8333-333333333333";
const FUNNEL = "44444444-4444-4444-8444-444444444444";
const LEAD = "55555555-5555-4555-8555-555555555555";
const REF = "66666666-6666-4666-8666-666666666666";

function migration(name: string): string {
  return readFileSync(path.join(process.cwd(), "supabase", "migrations", name), "utf8");
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

describe("funnelStillSends (send-time form check)", () => {
  const row = { pixel_id: PIXEL, funnel_id: FUNNEL };

  it("allows a live form that still uses the pixel with consent", () => {
    assert.equal(funnelStillSends(row, liveFunnel()), true);
  });

  it("stops rows whose form is gone, detached, switched, unconfirmed, offline or suspended", () => {
    assert.equal(funnelStillSends(row, null), false);
    assert.equal(funnelStillSends({ ...row, funnel_id: null }, liveFunnel()), false);
    assert.equal(funnelStillSends(row, liveFunnel({ meta_pixel_id: null })), false);
    assert.equal(funnelStillSends(row, liveFunnel({ meta_pixel_id: OTHER_PIXEL })), false);
    assert.equal(funnelStillSends(row, liveFunnel({ meta_consent_confirmed_at: null })), false);
    assert.equal(funnelStillSends(row, liveFunnel({ is_published: false })), false);
    assert.equal(funnelStillSends(row, liveFunnel({ taken_down_at: "2026-11-21T00:00:00Z" })), false);
    assert.equal(funnelStillSends(row, liveFunnel({ tenant_plan: "suspended" })), false);
    assert.equal(funnelStillSends(row, liveFunnel({ tenant_plan: null })), false);
  });

  it("has a log label for the skip reason", () => {
    assert.ok(STATUS_REASON_LABELS.pixel_detached);
  });
});

describe("migrations stop detached rows and serialise split test edits", () => {
  it("meta_release_held only releases rows whose form still uses the pixel with consent", () => {
    const sql = migration("0028_meta_controls_and_demo_marks.sql");
    assert.match(sql, /f\.meta_pixel_id = q\.pixel_id/);
    assert.match(sql, /f\.meta_consent_confirmed_at is not null/);
    assert.match(sql, /t\.plan <> 'suspended'/);
  });

  it("the cron claims the oldest events first", () => {
    const sql = migration("0027_meta_pixels_and_events.sql");
    assert.match(sql, /order by c\.event_time, c\.next_attempt_at/);
  });

  it("lead sessions get an opaque Meta event reference", () => {
    const sql = migration("0027_meta_pixels_and_events.sql");
    assert.match(sql, /add column if not exists meta_event_ref uuid not null default gen_random_uuid\(\)/);
  });

  it("split test members are swapped in one locked function, for the service role only", () => {
    const sql = migration("0025_split_tests.sql");
    assert.match(sql, /create or replace function public\.split_test_replace_members/);
    assert.match(sql, /where t\.id = p_test_id and t\.tenant_id = p_tenant_id\s+for update;/);
    assert.match(sql, /if v_status <> 'draft' then\s+raise exception 'FORMBOOK_SPLIT:locked'/);
    assert.match(
      sql,
      /revoke all on function public\.split_test_replace_members\(uuid, uuid, uuid\[\]\) from public, anon, authenticated;/
    );
    assert.match(sql, /grant execute on function public\.split_test_replace_members\(uuid, uuid, uuid\[\]\) to service_role;/);
  });

  it("the cron drains a few hundred rows a run", () => {
    assert.ok(CRON_DRAIN_ROW_LIMIT >= 300);
    assert.ok(CRON_DRAIN_BATCH_SIZE >= 10 && CRON_DRAIN_BATCH_SIZE <= 50);
  });
});

describe("pixelDetached", () => {
  it("is true only when a pixel is dropped or switched", () => {
    assert.equal(pixelDetached(PIXEL, null), true);
    assert.equal(pixelDetached(PIXEL, OTHER_PIXEL), true);
    assert.equal(pixelDetached(PIXEL, PIXEL), false);
    assert.equal(pixelDetached(null, PIXEL), false);
    assert.equal(pixelDetached(null, null), false);
  });
});

describe("lead event ids never carry the session id", () => {
  it("uses the opaque reference", () => {
    assert.equal(leadEventRef({ id: LEAD, meta_event_ref: REF }), REF);
  });

  it("refuses a missing reference or one equal to the session id", () => {
    assert.equal(leadEventRef({ id: LEAD, meta_event_ref: null }), null);
    assert.equal(leadEventRef({ id: LEAD }), null);
    assert.equal(leadEventRef({ id: LEAD, meta_event_ref: LEAD }), null);
    assert.equal(leadEventRef({ id: LEAD, meta_event_ref: "bad ref!" }), null);
  });
});

describe("toClientEvents", () => {
  it("tells the browser only about pending events, never held ones", () => {
    const events = toClientEvents([
      { id: "a", eventName: "Lead", eventId: "fbk1.lead.one", status: "pending" },
      { id: "b", eventName: "Lead", eventId: "fbk1.lead.two", status: "held" },
      { id: "c", eventName: "Lead", eventId: "fbk1.lead.three", status: "awaiting_consent" },
      null
    ]);
    assert.deepEqual(events, [{ event_name: "Lead", event_id: "fbk1.lead.one" }]);
  });

  it("the bridge help says held events stay out of the browser", () => {
    assert.match(META_CONTROLS_COPY.bridgeHelp, /held for review are not passed to the browser/);
  });
});

describe("public lead session responses", () => {
  const session = {
    id: LEAD,
    tenant_id: TENANT,
    status: "abandoned",
    email: "visitor@example.com",
    phone: "+15555550100",
    ip_address: "203.0.113.7",
    meta_consent: true,
    meta_released_at: "2026-11-25T10:00:00Z",
    meta_released_by: "staff@example.com",
    meta_event_ref: REF
  } as unknown as LeadSession;

  it("drops every server-only field", () => {
    const publicSession = toPublicSession(session) as Record<string, unknown>;
    for (const field of SERVER_ONLY_SESSION_FIELDS) assert.equal(field in publicSession, false, field);
    assert.equal(publicSession.id, LEAD);
    assert.equal("ip_address" in publicSession, false);
    assert.equal("meta_released_by" in publicSession, false);
  });

  it("the abandon response carries only the id and status", () => {
    assert.deepEqual(toAbandonResponse(session), { id: LEAD, status: "abandoned" });
  });
});

describe("visitorCookieToWrite", () => {
  it("writes only the id the server used for assignment", () => {
    assert.equal(visitorCookieToWrite("visitor-abcdef12"), "visitor-abcdef12");
    assert.equal(visitorCookieToWrite(null), null);
    assert.equal(visitorCookieToWrite(undefined), null);
    assert.equal(visitorCookieToWrite("bad id"), null);
  });
});

describe("funnelCopyPayload", () => {
  it("a copy of a form with a pixel has no pixel, no consent confirmation and no demo mark", () => {
    const source = {
      id: FUNNEL,
      tenant_id: TENANT,
      name: "Main form",
      slug: "main-form",
      is_published: true,
      created_at: "2026-11-01T00:00:00Z",
      updated_at: "2026-11-02T00:00:00Z",
      taken_down_at: null,
      taken_down_reason: null,
      questions: [],
      meta_pixel_id: PIXEL,
      meta_consent_confirmed_at: "2026-11-20T10:00:00Z",
      meta_consent_confirmed_by: "owner@example.com",
      meta_consent_checkbox_enabled: true,
      meta_consent_checkbox_label: "Share with Meta",
      demo_seed_batch: "demo-1",
      headline: "Book a call"
    };
    const copy = funnelCopyPayload(source, "main-form-copy-abc1") as Record<string, unknown>;
    assert.equal(copy.meta_pixel_id, null);
    assert.equal(copy.meta_consent_confirmed_at, null);
    assert.equal(copy.meta_consent_confirmed_by, null);
    assert.equal(copy.meta_consent_checkbox_enabled, false);
    assert.equal(copy.demo_seed_batch, null);
    assert.equal(copy.is_published, false);
    assert.equal(copy.name, "Main form Copy");
    assert.equal(copy.slug, "main-form-copy-abc1");
    assert.equal(copy.headline, "Book a call");
    assert.equal(copy.tenant_id, TENANT);
    for (const dropped of ["id", "created_at", "updated_at", "taken_down_at", "taken_down_reason", "questions"]) {
      assert.equal(dropped in copy, false, dropped);
    }
    for (const [key, value] of Object.entries(FUNNEL_COPY_RESETS)) assert.equal(copy[key], value);
  });
});
