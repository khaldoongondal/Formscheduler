import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { planFormFreeze, rankActiveForms, type FormActivity } from "@/lib/billing/freeze";
import { canSaveWithoutFreeze } from "@/lib/billing/plan-transitions";
import {
  FORM_LINK_TITLE,
  FORM_NOT_AVAILABLE_MESSAGE,
  FORM_NOT_AVAILABLE_TITLE,
  formPageMetadata,
  splitLinkMetadata
} from "@/lib/funnels/public-copy";
import { HOME_METADATA, SITE_TITLE } from "@/lib/marketing/site";

const ROOT = process.cwd();
const EM_DASH = String.fromCharCode(0x2014);

/** Source text with line endings normalised, so checks do not depend on CRLF or LF. */
function source(...parts: string[]): string {
  return readFileSync(path.join(ROOT, ...parts), "utf8").replace(/\r\n/g, "\n");
}

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

describe("customer form pages do not inherit FormBook share metadata", () => {
  it("the root layout keeps only neutral defaults", () => {
    const layout = source("app", "layout.tsx");
    assert.doesNotMatch(layout, /openGraph|twitter|SITE_DESCRIPTION|SITE_TITLE|applicationName|HOME_METADATA|PRODUCT_ICONS|\bicons:/);
    assert.ok(!existsSync(path.join(ROOT, "app", "opengraph-image.tsx")), "root opengraph-image applies to every route");
    assert.ok(!existsSync(path.join(ROOT, "app", "twitter-image.tsx")), "root twitter-image applies to every route");
    assert.ok(!existsSync(path.join(ROOT, "app", "page.tsx")), "the home page lives in the (home) route group");
  });

  it("the share image and product metadata live with the home page only", () => {
    assert.ok(existsSync(path.join(ROOT, "app", "(home)", "opengraph-image.tsx")));
    assert.ok(existsSync(path.join(ROOT, "app", "(home)", "twitter-image.tsx")));
    assert.match(source("app", "(home)", "page.tsx"), /export const metadata: Metadata = HOME_METADATA;/);
    assert.equal(HOME_METADATA.openGraph?.url, "/");
    assert.deepEqual(HOME_METADATA.icons, { icon: "/brand/formbook-mark.png" });
    assert.deepEqual(HOME_METADATA.title, { absolute: SITE_TITLE });
  });

  it("a form page uses the form name, with no Open Graph image or url", () => {
    const meta = formPageMetadata({ name: "  Discovery   call ", description: "Pick a time." });
    assert.deepEqual(meta.title, { absolute: "Discovery call" });
    assert.equal(meta.description, "Pick a time.");
    const og = meta.openGraph as Record<string, unknown>;
    assert.equal(og.title, "Discovery call");
    assert.equal(og.url, undefined);
    assert.equal(og.images, undefined);
    assert.equal((meta.twitter as Record<string, unknown>).images, undefined);
    assert.equal(meta.robots, undefined);
    assert.ok(!JSON.stringify(meta).includes("FormBook"));
  });

  it("embeds are noindex, long descriptions are shortened, empty names fall back", () => {
    assert.deepEqual(formPageMetadata({ name: "X" }, { index: false }).robots, { index: false });
    const long = formPageMetadata({ name: "X", description: "word ".repeat(100) });
    assert.ok(typeof long.description === "string" && long.description.length <= 200);
    assert.deepEqual(formPageMetadata({ name: "   " }).title, { absolute: FORM_LINK_TITLE });
  });

  it("a hidden intro headline or description never reaches the page metadata", () => {
    const hidden = formPageMetadata({
      name: "Internal test label",
      description: "Hidden description text",
      show_intro_headline: false,
      show_intro_description: false
    });
    assert.deepEqual(hidden.title, { absolute: FORM_LINK_TITLE });
    assert.equal(hidden.description, undefined);
    assert.ok(!JSON.stringify(hidden).includes("Internal test label"));
    assert.ok(!JSON.stringify(hidden).includes("Hidden description text"));
    const headlineOnly = formPageMetadata({ name: "Shown", description: "Secret", show_intro_description: false });
    assert.deepEqual(headlineOnly.title, { absolute: "Shown" });
    assert.equal(headlineOnly.description, undefined);
    assert.ok(!JSON.stringify(headlineOnly).includes("Secret"));
    const descriptionOnly = formPageMetadata({ name: "Hidden name", description: "Shown text", show_intro_headline: false });
    assert.deepEqual(descriptionOnly.title, { absolute: FORM_LINK_TITLE });
    assert.equal(descriptionOnly.description, "Shown text");
    assert.ok(!JSON.stringify(descriptionOnly).includes("Hidden name"));
  });

  it("an unavailable form gets a neutral noindex title that does not say why", () => {
    const meta = formPageMetadata(null);
    assert.deepEqual(meta.title, { absolute: FORM_NOT_AVAILABLE_TITLE });
    assert.deepEqual(meta.robots, { index: false, follow: false });
    assert.equal(meta.openGraph, undefined);
  });

  it("split test links have a neutral noindex title", () => {
    const meta = splitLinkMetadata();
    assert.deepEqual(meta.title, { absolute: FORM_LINK_TITLE });
    assert.deepEqual(meta.robots, { index: false });
    assert.ok(!JSON.stringify(meta).includes("FormBook"));
  });

  for (const segment of [["book"], ["embed"], ["t"], ["embed", "t"]]) {
    const dir = ["app", ...segment, "[slug]"];
    it(`${dir.join("/")} sets its own metadata and shows the not-available view on 404`, () => {
      const page = source(...dir, "page.tsx");
      assert.doesNotMatch(page, /PRODUCT_ICONS|formbook-mark\.png/);
      assert.match(page, /formPageMetadata|splitLinkMetadata/);
      assert.match(page, /notFound\(\)/);
      assert.match(source(...dir, "not-found.tsx"), /FormNotAvailable as default/);
    });
  }

  it("the not-available view shows the promised text, without FormBook branding", () => {
    const view = source("components", "booking", "form-not-available.tsx");
    assert.match(view, /FORM_NOT_AVAILABLE_MESSAGE/);
    assert.doesNotMatch(view, /FormBook|Gondal/);
    assert.equal(FORM_NOT_AVAILABLE_MESSAGE, "This form is not available.");
    for (const text of [FORM_NOT_AVAILABLE_MESSAGE, FORM_NOT_AVAILABLE_TITLE, FORM_LINK_TITLE]) {
      assert.ok(!text.includes(EM_DASH));
    }
  });

  it("the API gate still uses the same message", () => {
    assert.match(source("lib", "funnels", "public-gate.ts"), /from "@\/lib\/funnels\/public-copy"/);
  });
});

describe("freeze ranking does not depend on updated_at", () => {
  it("ties after lead recency break on createdAt, newest first", () => {
    const forms = [
      form("old", { createdAt: "2026-01-01T00:00:00Z" }),
      form("new", { createdAt: "2026-06-01T00:00:00Z" }),
      form("mid", { createdAt: "2026-03-01T00:00:00Z" })
    ];
    assert.deepEqual(rankActiveForms(forms), ["new", "mid", "old"]);
  });

  it("downgrade, upgrade and downgrade again keeps the same forms live", () => {
    // Eight no-lead forms; A, B, C are the newest created and stay live.
    const created = ["A", "B", "C", "D", "E", "F", "G", "H"].map((id, i) =>
      form(id, { createdAt: `2026-0${9 - i}-01T00:00:00Z` })
    );
    const first = planFormFreeze(created, 3);
    assert.deepEqual(first.keep, ["A", "B", "C"]);
    // Restore all (an upgrade). Freezing and restoring would bump updated_at,
    // which is not part of the ranking input, so the order cannot change.
    const restored = created.map((f) => ({ ...f }));
    assert.deepEqual(planFormFreeze(restored, 3).keep, first.keep);
  });

  it("the migration ranks and freezes on created_at, and exposes it from tenant_form_activity", () => {
    const sql = source("supabase", "migrations", "0032_plan_changes_and_freeze.sql");
    assert.match(sql, /nulls last, f\.created_at desc, f\.id\n\s*offset v_limits\.max_active_forms/);
    assert.doesNotMatch(sql, /p_form_keep_order[^\n]*f\.updated_at/);
    assert.match(sql, /drop function if exists public\.tenant_form_activity\(uuid\);\ncreate or replace function public\.tenant_form_activity/);
    assert.match(sql, /last_lead_at timestamptz, created_at timestamptz\n\)/);
    assert.match(source("lib", "billing", "plan-change-service.ts"), /createdAt: row\.created_at/);
  });
});

describe("plan change safety", () => {
  it("connection read failures are not swallowed when checking frozen forms", () => {
    const text = source("lib", "billing", "plan-change-service.ts");
    const start = text.indexOf("export async function readyFrozenFormIds(");
    const end = text.indexOf("\n}\n", start);
    const body = text.slice(start, end);
    assert.match(body, /listGhlConnections\(tenantId\),/);
    assert.match(body, /listConnections\(tenantId\)\n/);
    assert.doesNotMatch(body, /\.catch\(/);
  });

  it("only changes that cannot need a freeze may skip the RPC", () => {
    assert.equal(canSaveWithoutFreeze("free", "scaling"), true);
    assert.equal(canSaveWithoutFreeze("scaling", "suspended"), true);
    assert.equal(canSaveWithoutFreeze("free", "suspended"), true);
    assert.equal(canSaveWithoutFreeze("free", "free"), true);
    assert.equal(canSaveWithoutFreeze("scaling", "free"), false);
    assert.equal(canSaveWithoutFreeze("suspended", "free"), false);
    assert.equal(canSaveWithoutFreeze("suspended", "scaling"), false);
  });

  it("a missing RPC on a downgrade throws a 503 PublicError instead of a direct update", () => {
    const text = source("lib", "billing", "plan-change-service.ts");
    const start = text.indexOf("async function applyWithoutFreeze(");
    const body = text.slice(start, text.indexOf("\n}\n", start));
    const guard = body.indexOf("if (!canSaveWithoutFreeze(from, to))");
    const update = body.indexOf('.from("tenants").update(update)');
    assert.ok(guard >= 0 && update > guard, "the guard must run before the direct update");
    assert.match(body, /throw new PublicError\(PLAN_UPDATE_PAUSED_MESSAGE, 503\)/);
    assert.match(text, /applyWithoutFreeze\(input\.tenantId, update, current\.plan, target\)/);
  });
});

describe("public release notes keep internal setup private", () => {
  it("the deployment guide has no GoHighLevel workflow, tag or retry details for Sprint 4", () => {
    const doc = source("docs", "production-deployment.md");
    const sprint4 = doc.slice(doc.indexOf("## Sprint 4 release checklist"), doc.indexOf("## Sprint 3 release checklist"));
    assert.ok(sprint4.length > 0);
    assert.doesNotMatch(sprint4, /Workflow [A-D]|formbook-payment-failed|formbook-scaling|nurture|Wait 7 days|Refunds\./);
    assert.match(sprint4, /private release notes/);
  });
});
