import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  HELP_COPY,
  WEBHOOK_EXAMPLE_EVENT,
  WEBHOOK_EXAMPLE_JSON,
  WEBHOOK_VERIFY_SNIPPET,
  supportEmailFrom
} from "@/lib/help/connections-copy";
import {
  SETUP_COPY,
  connectionIdsOfForm,
  countFormsByConnection,
  formSetupError,
  helpHref,
  readinessFixHref,
  welcomeSetupState
} from "@/lib/connections/setup-state";
import { PROVIDERS, type ProviderKind } from "@/lib/connections/registry";
import { READINESS_COPY } from "@/lib/connections/readiness";
import { PUBLISH_NEEDS_CALENDAR_MESSAGE, PUBLISH_NEEDS_CONNECTION_MESSAGE } from "@/lib/funnels/publish-readiness";
import { buildFormBookEvent } from "@/lib/crm/event-payload";
import { LEAD_DETAIL_COPY } from "@/lib/crm/copy";
import { signPayload } from "@/lib/webhooks/signing";
import type { LeadSession } from "@/lib/types/database";

const EM_DASH = String.fromCharCode(0x2014);
const GHL_ID = "33333333-3333-4333-8333-333333333333";
const CAL_ID = "11111111-1111-4111-8111-111111111111";
const CRM_ID = "22222222-2222-4222-8222-222222222222";

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") return allStrings((value as (...args: unknown[]) => unknown)(2, "x"));
  if (Array.isArray(value)) return value.flatMap(allStrings);
  if (value && typeof value === "object") return Object.values(value).flatMap(allStrings);
  return [];
}

function keyTree(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return typeof value;
  return Object.fromEntries(
    Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => [key, keyTree((value as Record<string, unknown>)[key])])
  );
}

function topAndNestedKeys(value: Record<string, unknown>) {
  const tree = keyTree(value) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(tree).map(([key, nested]) => [key, nested && typeof nested === "object" ? Object.keys(nested as object).sort() : "leaf"])
  );
}

describe("HELP_COPY", () => {
  it("has no em dash", () => {
    for (const text of allStrings(HELP_COPY)) assert.ok(!text.includes(EM_DASH), text);
    assert.ok(!WEBHOOK_VERIFY_SNIPPET.includes(EM_DASH));
    assert.ok(!WEBHOOK_EXAMPLE_JSON.includes(EM_DASH));
  });

  it("names the product as FormBook, a tool from Gondal Tech", () => {
    assert.equal(HELP_COPY.subtitle, "FormBook, a tool from Gondal Tech");
    assert.equal(HELP_COPY.title, "Connecting your calendar and CRM");
  });

  it("has a section for every provider, with the registry's anchor, plus how it works and troubleshooting", () => {
    const anchors = HELP_COPY.sections.map((section) => section.anchor);
    for (const kind of Object.keys(PROVIDERS) as ProviderKind[]) {
      assert.ok(anchors.includes(PROVIDERS[kind].helpAnchor), kind);
    }
    assert.equal(anchors[0], "how-it-works");
    assert.equal(anchors[anchors.length - 1], "troubleshooting");
    assert.equal(new Set(anchors).size, anchors.length, "anchors are unique");
    for (const anchor of anchors) assert.match(anchor, /^[a-z0-9-]+$/);
  });

  it("help links from the admin land on a section of the page", () => {
    const anchors = new Set(HELP_COPY.sections.map((section) => section.anchor));
    for (const kind of Object.keys(PROVIDERS) as ProviderKind[]) {
      const href = helpHref(kind);
      assert.ok(href.startsWith("/help/connections#"), href);
      assert.ok(anchors.has(href.split("#")[1]), href);
    }
  });

  it("the webhook section states the published delivery rules", () => {
    const webhook = HELP_COPY.sections.find((section) => section.anchor === PROVIDERS.webhook.helpAnchor);
    const text = [webhook?.intro, ...(webhook?.steps ?? []), ...(webhook?.notes ?? [])].join(" ");
    for (const phrase of ["lead.captured", "lead.qualified", "lead.disqualified", "lead.booked", "test.ping", "8 times", "10 seconds", "Redirects are not followed", "X-FormBook-Signature", "5 minutes"]) {
      assert.ok(text.includes(phrase), phrase);
    }
  });
});

describe("webhook example payload", () => {
  it("parses as JSON and equals the typed example", () => {
    assert.deepEqual(JSON.parse(WEBHOOK_EXAMPLE_JSON), WEBHOOK_EXAMPLE_EVENT);
  });

  it("has every FormBookEvent key, nested keys included", () => {
    const session = {
      id: "99999999-9999-4999-8999-999999999999",
      tenant_id: "66666666-6666-4666-8666-666666666666",
      funnel_id: WEBHOOK_EXAMPLE_EVENT.form.id,
      status: "booked",
      first_name: "Alex",
      last_name: "Example",
      full_name: "Alex Example",
      email: "alex@example.com",
      phone: "+14165550101",
      visitor_id: null,
      ghl_connection_id: null,
      ghl_contact_id: null,
      ghl_opportunity_id: null,
      source_url: "https://example.com/book",
      referrer: null,
      utm_source: "facebook",
      utm_medium: "paid",
      utm_campaign: "winter",
      utm_content: null,
      utm_term: null,
      user_agent: null,
      ip_address: null,
      metadata: {},
      external_ref: WEBHOOK_EXAMPLE_EVENT.lead.id,
      started_at: "2026-12-01T15:00:00.000Z",
      qualified_at: null,
      slots_shown_at: null,
      booked_at: null,
      disqualified_at: null,
      abandoned_at: null,
      errored_at: null,
      created_at: "2026-12-01T15:00:00.000Z",
      updated_at: "2026-12-01T15:00:00.000Z"
    } as unknown as LeadSession;
    const built = buildFormBookEvent({
      type: "lead.booked",
      nowIso: WEBHOOK_EXAMPLE_EVENT.created_at,
      funnel: WEBHOOK_EXAMPLE_EVENT.form,
      session,
      answers: [],
      booking: WEBHOOK_EXAMPLE_EVENT.booking
    });
    const example = JSON.parse(WEBHOOK_EXAMPLE_JSON) as Record<string, unknown>;
    assert.deepEqual(topAndNestedKeys(built as unknown as Record<string, unknown>), topAndNestedKeys(example));
    assert.equal(example.version, built.version);
  });

  it("uses made-up values only", () => {
    assert.match(WEBHOOK_EXAMPLE_EVENT.lead.email ?? "", /@example\.com$/);
    assert.match(WEBHOOK_EXAMPLE_EVENT.lead.phone ?? "", /^\+1416555/);
  });
});

describe("the help page signature check", () => {
  // The snippet is shown to customers; run it to prove it accepts FormBook's own signature.
  const isFromFormBook = new Function(
    "createHmac",
    "timingSafeEqual",
    "Buffer",
    `${WEBHOOK_VERIFY_SNIPPET.replace(/^import .*\n/, "").replace("export function", "function")}\nreturn isFromFormBook;`
  )(createHmac, (a: Buffer, b: Buffer) => a.equals(b), Buffer) as (header: string, body: string, secret: string) => boolean;
  const secret = "whsec_test_secret_value_0123456789abcdef";
  const body = WEBHOOK_EXAMPLE_JSON;

  it("accepts a fresh FormBook signature", () => {
    const header = signPayload(secret, Math.floor(Date.now() / 1000), body);
    assert.equal(isFromFormBook(header, body, secret), true);
  });

  it("rejects a tampered body, a wrong secret and an old timestamp", () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(isFromFormBook(signPayload(secret, now, body), `${body} `, secret), false);
    assert.equal(isFromFormBook(signPayload(secret, now, body), body, "whsec_other_secret_value_0123456789"), false);
    assert.equal(isFromFormBook(signPayload(secret, now - 301, body), body, secret), false);
  });
});

describe("supportEmailFrom", () => {
  it("returns a trimmed address", () => {
    assert.equal(supportEmailFrom(" help@example.com "), "help@example.com");
  });

  it("hides the line when unset or not an address", () => {
    assert.equal(supportEmailFrom(undefined), null);
    assert.equal(supportEmailFrom(""), null);
    assert.equal(supportEmailFrom("not an email"), null);
    assert.equal(supportEmailFrom("a@b"), null);
    assert.equal(supportEmailFrom('x"@example.com<script>'), null);
  });
});

describe("setup states", () => {
  it("SETUP_COPY and LEAD_DETAIL_COPY have no em dash", () => {
    for (const text of [...allStrings(SETUP_COPY), ...allStrings(LEAD_DETAIL_COPY)]) assert.ok(!text.includes(EM_DASH), text);
  });

  it("usedBy counts in plain English", () => {
    assert.equal(SETUP_COPY.usedBy(0), "Used by 0 forms");
    assert.equal(SETUP_COPY.usedBy(1), "Used by 1 form");
    assert.equal(SETUP_COPY.usedBy(3), "Used by 3 forms");
  });

  it("welcome: an empty tenant has nothing done", () => {
    assert.deepEqual(welcomeSetupState([], []), { calendarDone: false, crmDone: false });
  });

  it("welcome: an active GoHighLevel connection completes both steps; an inactive one does not", () => {
    assert.deepEqual(welcomeSetupState([{ is_active: true }], []), { calendarDone: true, crmDone: true });
    assert.deepEqual(welcomeSetupState([{ is_active: false }], []), { calendarDone: false, crmDone: false });
  });

  it("welcome: a connected calendar or CRM row completes its own step only", () => {
    assert.deepEqual(welcomeSetupState([], [{ provider: "google_calendar", status: "connected" }]), { calendarDone: true, crmDone: false });
    assert.deepEqual(welcomeSetupState([], [{ provider: "webhook", status: "connected" }]), { calendarDone: false, crmDone: true });
    assert.deepEqual(welcomeSetupState([], [{ provider: "calendly", status: "needs_attention" }, { provider: "hubspot", status: "disabled" }]), {
      calendarDone: false,
      crmDone: false
    });
  });

  it("counts each form once per connection it uses", () => {
    const forms = [
      { ghl_connection_id: GHL_ID, calendar_id: null },
      { ghl_connection_id: GHL_ID, calendar_id: null, calendar_provider: "ghl" as const, crm_provider: "ghl" as const },
      { ghl_connection_id: GHL_ID, calendar_id: null, calendar_provider: "google_calendar" as const, calendar_connection_id: CAL_ID, crm_provider: "ghl" as const },
      { ghl_connection_id: null, calendar_id: null, calendar_provider: "google_calendar" as const, calendar_connection_id: CAL_ID, crm_provider: "webhook" as const, crm_connection_id: CRM_ID },
      // A stale GoHighLevel id on a form that no longer uses GoHighLevel is not counted.
      { ghl_connection_id: GHL_ID, calendar_id: null, calendar_provider: "calcom" as const, calendar_connection_id: null, crm_provider: "hubspot" as const, crm_connection_id: CRM_ID }
    ];
    const counts = countFormsByConnection(forms);
    assert.equal(counts.get(GHL_ID), 3);
    assert.equal(counts.get(CAL_ID), 2);
    assert.equal(counts.get(CRM_ID), 2);
    assert.deepEqual(connectionIdsOfForm(forms[4]), [CRM_ID]);
  });

  it("formSetupError follows the activation rule from loaded rows", () => {
    const ghl = [{ id: GHL_ID, calendar_id: "cal-1", is_active: true }];
    // GoHighLevel form with a default calendar on its connection: ready.
    assert.equal(formSetupError({ ghl_connection_id: GHL_ID, calendar_id: null }, ghl, []), null);
    // No connection at all: the original GoHighLevel message.
    assert.equal(formSetupError({ ghl_connection_id: null, calendar_id: null }, ghl, []), PUBLISH_NEEDS_CONNECTION_MESSAGE);
    const google = { id: CAL_ID, provider: "google_calendar" as const, status: "connected" as const, availabilityConfirmedAt: "2026-12-01T00:00:00Z", settings: {} };
    const webhook = { id: CRM_ID, provider: "webhook" as const, status: "connected" as const, availabilityConfirmedAt: null, settings: {} };
    const form = {
      ghl_connection_id: null,
      calendar_id: null,
      calendar_provider: "google_calendar" as const,
      calendar_connection_id: CAL_ID,
      crm_provider: "webhook" as const,
      crm_connection_id: CRM_ID
    };
    assert.equal(formSetupError(form, [], [google, webhook]), null);
    assert.equal(formSetupError(form, [], [{ ...google, availabilityConfirmedAt: null }, webhook]), READINESS_COPY.googleHours);
    assert.equal(formSetupError(form, [], [google]), READINESS_COPY.needsCrm);
    assert.equal(formSetupError(form, [], [google, { ...webhook, status: "disabled" }]), READINESS_COPY.crmDisabled);
  });

  it("Fix this goes to the connection to repair, the Connections section, or the picker", () => {
    const form = { calendar_connection_id: CAL_ID, crm_connection_id: CRM_ID };
    const choices = { hasCalendarChoices: true, hasCrmChoices: true };
    const none = { hasCalendarChoices: false, hasCrmChoices: false };
    assert.equal(readinessFixHref(READINESS_COPY.googleHours, form, choices), `/admin/connections/${CAL_ID}`);
    assert.equal(readinessFixHref(READINESS_COPY.calendlyConfirmations, form, choices), `/admin/connections/${CAL_ID}`);
    assert.equal(readinessFixHref(READINESS_COPY.crmNeedsAttention, form, choices), `/admin/connections/${CRM_ID}`);
    assert.equal(readinessFixHref(READINESS_COPY.crmDisabled, { calendar_connection_id: null, crm_connection_id: null }, choices), "/admin/connections#crms");
    assert.equal(readinessFixHref(READINESS_COPY.needsCalendar, form, choices), "#calendar_choice");
    assert.equal(readinessFixHref(READINESS_COPY.needsCalendar, form, none), "/admin/connections#calendars");
    assert.equal(readinessFixHref(PUBLISH_NEEDS_CONNECTION_MESSAGE, form, none), "/admin/connections#calendars");
    assert.equal(readinessFixHref(READINESS_COPY.needsCrm, form, choices), "#crm_choice");
    assert.equal(readinessFixHref(READINESS_COPY.needsCrm, form, none), "/admin/connections#crms");
    assert.equal(readinessFixHref(READINESS_COPY.calcomEventType, form, choices), "#calendar_choice");
    assert.equal(readinessFixHref(PUBLISH_NEEDS_CALENDAR_MESSAGE, form, choices), "#calendar_choice");
    assert.equal(readinessFixHref(READINESS_COPY.hubspotStages, form, choices), "#crm_choice");
  });

  it("every readiness message has a Fix this target", () => {
    const form = { calendar_connection_id: CAL_ID, crm_connection_id: CRM_ID };
    for (const message of [...Object.values(READINESS_COPY), PUBLISH_NEEDS_CALENDAR_MESSAGE, PUBLISH_NEEDS_CONNECTION_MESSAGE]) {
      const href = readinessFixHref(message, form, { hasCalendarChoices: true, hasCrmChoices: true });
      assert.ok(href.startsWith("#") || href.startsWith("/admin/connections"), `${message} -> ${href}`);
    }
  });
});
