/**
 * Event log, hold and fire, and match quality helpers for Meta pixels.
 * Pure: no Next.js or Supabase imports.
 */

import { z } from "zod";
import { META_MAX_EVENT_AGE_MS } from "@/lib/meta/constants";
import { META_EVENT_DEFS, META_EVENT_KEYS, type MetaEventKey, type PixelSwitches } from "@/lib/meta/events";
import { describeMetaResult, summarizeMetaResponse } from "@/lib/meta/response";

export type DeliveryStatus =
  | "awaiting_consent"
  | "held"
  | "pending"
  | "sent"
  | "failed"
  | "skipped"
  | "expired"
  | "cancelled";

export const DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  "awaiting_consent",
  "held",
  "pending",
  "sent",
  "failed",
  "skipped",
  "expired",
  "cancelled"
];

export type StatusTone = "slate" | "amber" | "emerald" | "red" | "blue";

export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, { label: string; help: string; tone: StatusTone }> = {
  awaiting_consent: {
    label: "Waiting for consent",
    help: "Sent only if the visitor ticks the consent box. Cancelled after 24 hours.",
    tone: "slate"
  },
  held: {
    label: "Held",
    help: "Waiting for you to send it. Held events can be sent for 7 days.",
    tone: "amber"
  },
  pending: {
    label: "Queued",
    help: "On its way to Meta. Failed attempts are retried for about half an hour.",
    tone: "blue"
  },
  sent: { label: "Sent", help: "Meta received it.", tone: "emerald" },
  failed: { label: "Failed", help: "Meta did not accept it, or every retry failed. See the error.", tone: "red" },
  skipped: { label: "Skipped", help: "Not sent because of a setting at send time.", tone: "slate" },
  expired: { label: "Expired", help: "Older than Meta's 7-day limit, so it can no longer be sent.", tone: "slate" },
  cancelled: {
    label: "Cancelled",
    help: "Not sent because the visitor did not give consent, or the form stopped using this pixel.",
    tone: "slate"
  }
};

export const STATUS_REASON_LABELS: Record<string, string> = {
  event_off: "This event was switched off.",
  pixel_removed: "The pixel was removed.",
  pixel_detached: "The form no longer sends to this pixel, or the form or account is not active.",
  form_paused: "Waiting because the form is unpublished or the account is paused. It is sent once both are active again, within 7 days.",
  consent_declined: "The visitor declined consent.",
  no_consent: "The visitor never answered the consent box.",
  token_unreadable: "The saved token could not be read.",
  retry_budget: "Every retry failed.",
  older_than_7_days: "Older than 7 days.",
  no_payload: "No event data was kept."
};

export function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return typeof value === "string" && (DELIVERY_STATUSES as readonly string[]).includes(value);
}

export function statusLabel(status: string): string {
  return isDeliveryStatus(status) ? DELIVERY_STATUS_LABELS[status].label : status;
}

export function reasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null;
  return STATUS_REASON_LABELS[reason] ?? null;
}

export const TEST_EVENT_LABEL = "Test event";

/** Our label for an event key, including the test event. */
export function eventKeyLabel(key: string): string {
  if (key === "test_event") return TEST_EVENT_LABEL;
  return (META_EVENT_KEYS as readonly string[]).includes(key) ? META_EVENT_DEFS[key as MetaEventKey].label : key;
}

const MATCH_KEY_CHIPS: Record<string, string> = {
  em: "Email",
  ph: "Phone",
  fn: "First name",
  ln: "Last name",
  ct: "Location",
  st: "Location",
  country: "Location",
  client_ip_address: "IP",
  client_user_agent: "Browser",
  fbp: "fbp",
  fbc: "fbc",
  external_id: "External ID"
};

/** Readable chips for the match keys of one event; location appears once. Unknown keys are left out. */
export function matchKeyChips(keys: string[]): string[] {
  const chips: string[] = [];
  for (const key of keys) {
    const chip = MATCH_KEY_CHIPS[key];
    if (chip && !chips.includes(chip)) chips.push(chip);
  }
  return chips;
}

export type CoverageRow = {
  event_key: string;
  events: number;
  with_em: number;
  with_ph: number;
  with_fn: number;
  with_ln: number;
  with_ip: number;
  with_ua: number;
  with_fbp: number;
  with_fbc: number;
  with_external_id: number;
  with_location: number;
};

export type CoverageKey =
  | "email"
  | "phone"
  | "firstName"
  | "lastName"
  | "ip"
  | "userAgent"
  | "fbp"
  | "fbc"
  | "externalId"
  | "location";

/** Columns of the match quality table, in order. */
export const COVERAGE_COLUMNS: ReadonlyArray<{ key: CoverageKey; label: string }> = [
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "ip", label: "IP" },
  { key: "userAgent", label: "Browser" },
  { key: "fbp", label: "fbp" },
  { key: "fbc", label: "fbc" },
  { key: "externalId", label: "External ID" },
  { key: "location", label: "Location" }
];

function toCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/** RPC rows can come back with numeric strings; this makes every count a safe integer. */
export function normalizeCoverageRow(row: Partial<CoverageRow> & { event_key?: unknown }): CoverageRow {
  return {
    event_key: typeof row.event_key === "string" ? row.event_key : "unknown",
    events: toCount(row.events),
    with_em: toCount(row.with_em),
    with_ph: toCount(row.with_ph),
    with_fn: toCount(row.with_fn),
    with_ln: toCount(row.with_ln),
    with_ip: toCount(row.with_ip),
    with_ua: toCount(row.with_ua),
    with_fbp: toCount(row.with_fbp),
    with_fbc: toCount(row.with_fbc),
    with_external_id: toCount(row.with_external_id),
    with_location: toCount(row.with_location)
  };
}

/** Share (0 to 1) of events carrying each key; 0 when there are no events. */
export function coverageShares(row: CoverageRow): Record<CoverageKey, number> {
  const share = (count: number) => (row.events > 0 ? Math.min(count, row.events) / row.events : 0);
  return {
    email: share(row.with_em),
    phone: share(row.with_ph),
    firstName: share(row.with_fn),
    lastName: share(row.with_ln),
    ip: share(row.with_ip),
    userAgent: share(row.with_ua),
    fbp: share(row.with_fbp),
    fbc: share(row.with_fbc),
    externalId: share(row.with_external_id),
    location: share(row.with_location)
  };
}

/** Sum of every row, with event_key "all". */
export function totalCoverage(rows: CoverageRow[]): CoverageRow {
  const total: CoverageRow = {
    event_key: "all",
    events: 0,
    with_em: 0,
    with_ph: 0,
    with_fn: 0,
    with_ln: 0,
    with_ip: 0,
    with_ua: 0,
    with_fbp: 0,
    with_fbc: 0,
    with_external_id: 0,
    with_location: 0
  };
  for (const row of rows) {
    total.events += row.events;
    total.with_em += row.with_em;
    total.with_ph += row.with_ph;
    total.with_fn += row.with_fn;
    total.with_ln += row.with_ln;
    total.with_ip += row.with_ip;
    total.with_ua += row.with_ua;
    total.with_fbp += row.with_fbp;
    total.with_fbc += row.with_fbc;
    total.with_external_id += row.with_external_id;
    total.with_location += row.with_location;
  }
  return total;
}

/** Coverage rows in the order of the six events, unknown keys last. */
export function sortCoverageRows(rows: CoverageRow[]): CoverageRow[] {
  const order = (key: string) => {
    const index = (META_EVENT_KEYS as readonly string[]).indexOf(key);
    return index === -1 ? META_EVENT_KEYS.length : index;
  };
  return [...rows].sort((left, right) => order(left.event_key) - order(right.event_key));
}

/** Whole percentage for a 0..1 share, like "83%". */
export function formatShare(share: number): string {
  return `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
}

/** Cells below this share are highlighted on the match quality page. */
export const LOW_COVERAGE_SHARE = 0.5;

export const MATCH_GUIDANCE: ReadonlyArray<{ key: string; text: string }> = [
  { key: "contact", text: "Email and phone are the strongest details. Ask for both on the contact step." },
  { key: "name", text: "Name: ask for first and last name, or full name." },
  {
    key: "browser_ids",
    text: "fbp and fbc come from the Meta pixel on the page that shows your form. Install the Meta pixel on that page and use the FormBook embed snippet, which passes them on. When a visitor arrives from a Meta ad, we also turn the click ID into fbc."
  },
  { key: "ip_browser", text: "IP address and browser are sent with every event automatically." },
  { key: "location", text: "Location is worked out from the visitor's IP address." },
  { key: "external_id", text: "External ID is a random visitor ID that links one visitor's events together." }
];

export const LOG_RANGE_PRESETS = ["today", "last_7_days", "last_30_days"] as const;
export type LogRangePreset = (typeof LOG_RANGE_PRESETS)[number];

export const LOG_RANGE_LABELS: Record<LogRangePreset, string> = {
  today: "Today",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days"
};

const LOG_EVENT_KEYS = [...META_EVENT_KEYS, "test_event"] as const;
export type LogEventKey = (typeof LOG_EVENT_KEYS)[number];
export const LOG_EVENT_OPTIONS: ReadonlyArray<{ value: LogEventKey; label: string }> = LOG_EVENT_KEYS.map((key) => ({
  value: key,
  label: eventKeyLabel(key)
}));

function allOr(values: readonly string[]) {
  return z
    .unknown()
    .transform((value) => (typeof value === "string" && values.includes(value.trim()) ? value.trim() : "all"));
}

/**
 * Event log filters from the query string. Junk values fall back to the
 * defaults instead of failing the page.
 */
export const logFilterSchema = z.object({
  status: allOr(DELIVERY_STATUSES),
  event: allOr(LOG_EVENT_KEYS),
  preset: z
    .preprocess((value) => (typeof value === "string" ? value : undefined), z.enum(LOG_RANGE_PRESETS).optional())
    .transform((value) => value ?? "last_7_days")
    .catch("last_7_days"),
  before: z
    .preprocess(
      (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined),
      z
        .string()
        .max(40)
        .refine((value) => !Number.isNaN(Date.parse(value)), "Invalid cursor.")
        .optional()
    )
    .catch(undefined)
});

export type LogFilter = {
  status: DeliveryStatus | "all";
  event: LogEventKey | "all";
  preset: LogRangePreset;
  before?: string;
};

export function parseLogFilter(input: unknown): LogFilter {
  const parsed = logFilterSchema.parse(input ?? {}) as LogFilter;
  return { status: parsed.status, event: parsed.event, preset: parsed.preset, before: parsed.before };
}

/** Start of the log range for a preset (server local time, like the analytics ranges). */
export function logRangeStart(preset: LogRangePreset, now: Date): Date {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "last_7_days") start.setDate(start.getDate() - 6);
  if (preset === "last_30_days") start.setDate(start.getDate() - 29);
  return start;
}

/** Whether a held event can still be released (mirrors meta_release_held). */
export function isReleasable(eventTimeMs: number, nowMs: number): boolean {
  return nowMs - eventTimeMs < META_MAX_EVENT_AGE_MS;
}

export type SimulatedRow = {
  id: string;
  pixelId: string;
  leadSessionId: string | null;
  status: DeliveryStatus;
  eventTimeMs: number;
};

/**
 * The ids meta_release_held would release: held rows of the pixel, or of the
 * lead, that are still young enough for Meta. Pure mirror of the SQL, used by
 * tests and the log's per-row "Send" decision.
 */
export function planRelease(
  rows: SimulatedRow[],
  target: { pixelId?: string | null; leadSessionId?: string | null },
  nowMs: number
): string[] {
  if (!target.pixelId && !target.leadSessionId) return [];
  return rows
    .filter(
      (row) =>
        row.status === "held" &&
        isReleasable(row.eventTimeMs, nowMs) &&
        (!target.pixelId || row.pixelId === target.pixelId) &&
        (!target.leadSessionId || row.leadSessionId === target.leadSessionId)
    )
    .map((row) => row.id);
}

/** Sending settings from the pixel page form (radio plus six checkboxes). */
export function parseSendingInput(formValues: Record<string, unknown>): {
  sending_mode: "automatic" | "hold";
  switches: PixelSwitches;
} {
  const on = (key: keyof PixelSwitches) => {
    const value = formValues[key];
    return value === "on" || value === "true" || value === true;
  };
  return {
    sending_mode: formValues.sending_mode === "hold" ? "hold" : "automatic",
    switches: {
      send_form_view: on("send_form_view"),
      send_form_start: on("send_form_start"),
      send_lead: on("send_lead"),
      send_qualified_lead: on("send_qualified_lead"),
      send_disqualified_lead: on("send_disqualified_lead"),
      send_booked_call: on("send_booked_call")
    }
  };
}

/** Lead name for the log: full name, else first and last, else email, else "Visitor". */
export function leadLabel(
  lead: { full_name?: string | null; first_name?: string | null; last_name?: string | null; email?: string | null } | null
): string {
  if (!lead) return "Visitor";
  const full = lead.full_name?.trim();
  if (full) return full;
  const parts = [lead.first_name?.trim(), lead.last_name?.trim()].filter(Boolean).join(" ");
  if (parts) return parts;
  const email = lead.email?.trim();
  return email || "Visitor";
}

/**
 * The Meta response column of the log. Sent rows show what Meta said;
 * failed rows show the stored error (it already holds the HTTP status);
 * waiting rows have not been sent yet; the rest were never sent.
 */
export function metaResponseText(status: string, metaResponse: unknown, lastError: string | null): string {
  if (status === "sent") return describeMetaResult(true, 200, summarizeMetaResponse(metaResponse));
  if (status === "failed") {
    if (lastError) return lastError;
    const message = summarizeMetaResponse(metaResponse).error?.message;
    return message ?? "Not accepted";
  }
  if (status === "pending" || status === "held" || status === "awaiting_consent") {
    return lastError ? `Not sent yet (last try: ${lastError})` : "Not sent yet";
  }
  return "Not sent";
}

/** Copy for the hold, fire, test and log controls. */
export const META_CONTROLS_COPY = {
  sendingTitle: "Sending",
  automaticLabel: "Automatic",
  automaticHelp: "Events go to Meta as they happen.",
  holdLabel: "Hold for review",
  holdHelp:
    "Events wait until you send them from the event log or a lead's page. Held events can be sent for up to 7 days.",
  holdSwitchNote: "Switching back to Automatic does not send events that are already held. Send them below.",
  saveSending: "Save sending settings",
  sendingSaved: "Sending settings saved.",
  customEvent: "(custom event)",
  heldCount: (n: number) => `${n} ${n === 1 ? "event is" : "events are"} held.`,
  sendAllHeld: "Send all held events",
  sendAllConfirm: (n: number) =>
    `Send ${n} held ${n === 1 ? "event" : "events"} to Meta now? Meta counts them as real events and they cannot be taken back.`,
  sendAllSaved: (n: number) =>
    `${n} held ${n === 1 ? "event is" : "events are"} on their way to Meta. Refresh in a minute to see the result.`,
  nothingHeld: "There are no held events to send.",
  queuedCount: (n: number) =>
    `${n} ${n === 1 ? "event is" : "events are"} waiting to go to Meta. They are sent oldest first, a few hundred every 5 minutes.`,
  testCodeActive:
    "A test event code is saved. Every event from this pixel is sent with it, so Meta shows the events only in the Test events tab and does not use them for your ads. Remove the code when you finish testing.",
  testCodeListBadge: "Test code on: events do not count in Ads Manager",
  sentWithTestCode: "Sent with a test event code",
  testTitle: "Test",
  sendTest: "Send test event",
  testNeedsCode: "Add a test event code above to send a test event.",
  lastTest: (date: string, summary: string) => `Last test ${date}: ${summary}`,
  testNoCode:
    "Add a test event code from the Test events tab in Events Manager first, so the test does not mix with real events.",
  testRateLimited: "You can send 10 test events an hour. Please try again later.",
  testOk: "Meta received the test event. Check the Test events tab in Events Manager.",
  testFailed: (detail: string) => `Meta did not accept the test event: ${detail}`,
  latestFailureTitle: "Latest failure",
  seeFailed: "See failed events",
  eventLog: "Event log",
  matchQuality: "Match quality",
  bridgeTitle: "Browser pixel bridge (optional)",
  bridgeHelp:
    "If the page that shows your form also runs the Meta pixel, add this script to that page. It sends the same events from the browser with the same event IDs, so Meta counts each one once. Events held for review are not passed to the browser, so hold mode still controls what Meta receives.",
  logHeading: "Event log",
  logSubheading: "Every event FormBook queued for this pixel, newest first.",
  logEmpty: "No events yet. Events appear here once a form that uses this pixel gets visits.",
  logNoMatch: "No events match these filters.",
  notSentYet: "Not sent yet",
  olderEvents: "Older events",
  sendRow: "Send",
  qualityHeading: "Match quality",
  qualitySubheading:
    "How often your events carry each detail Meta uses to match an event to a person. This is worked out from the events FormBook queued for this pixel. It is not Meta's Event Match Quality score, which you can see in Events Manager.",
  qualityPreLeadNote:
    "Form view and form start happen before the visitor gives contact details, so they never carry email, phone or name.",
  qualityHowTo: "How to raise it",
  qualityEmpty: "No events in this date range yet.",
  qualityAllEvents: "All events",
  leadConsentGiven: "Consent to share with Meta: given on the form.",
  leadConsentDeclined: "Consent to share with Meta: declined. Nothing was sent to Meta for this lead.",
  leadConsentCovered: "Consent to share with Meta: covered by your confirmation on the form.",
  leadReleased: (by: string, date: string) =>
    `Sent to Meta by ${by} on ${date}. New events for this lead go out automatically.`,
  leadSendHeld: "Send held events to Meta",
  leadSendConfirm:
    "Send this lead's held events to Meta now? Meta counts them as real events and they cannot be taken back.",
  leadSendSaved: (n: number) => `${n} ${n === 1 ? "event is" : "events are"} on their way to Meta.`,
  leadNoEvents: "No Meta events for this lead.",
  sampleData: "Sample data. These numbers are made up for the demo and are not real results."
} as const;
