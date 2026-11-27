/**
 * Account lifecycle events sent to the owner's CRM (Sprint 4, decisions D20 to D22).
 * Pure: node:crypto (through lib/webhooks/signing) and plan constants only.
 */
import { isPlanState, PLANS, type PlanState } from "@/lib/billing/plans";
import { signPayload, SIGNATURE_HEADER, TIMESTAMP_HEADER, WEBHOOK_SECRET_PATTERN } from "@/lib/webhooks/signing";

export const LIFECYCLE_SCHEMA = "formbook.lifecycle.v1";

export const LIFECYCLE_EVENTS = [
  "signup_verified",
  "first_connection_added",
  "first_form_activated",
  "first_lead",
  "first_booking",
  "plan_changed",
  "account_suspended",
  "account_restored",
  "test_ping"
] as const;

export type LifecycleEvent = (typeof LIFECYCLE_EVENTS)[number];

const PLAN_EVENTS: ReadonlySet<string> = new Set(["plan_changed", "account_suspended", "account_restored"]);

export function isLifecycleEvent(value: unknown): value is LifecycleEvent {
  return typeof value === "string" && (LIFECYCLE_EVENTS as readonly string[]).includes(value);
}

/** Mirror of lifecycle_on_plan_change (migration 0034). */
export function lifecycleEventForPlanChange(
  from: PlanState | null,
  to: PlanState
): Extract<LifecycleEvent, "plan_changed" | "account_suspended" | "account_restored"> | null {
  if (from === null || from === to) return null;
  if (to === "suspended") return "account_suspended";
  if (from === "suspended") return "account_restored";
  return "plan_changed";
}

export type LifecycleSnapshot = {
  account_ref: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  business_name: string | null;
  website: string | null;
  plan: string;
  signed_up_at: string;
  active_forms: number;
  draft_forms: number;
  frozen_forms: number;
  meta_pixels: number;
  connections: number;
  leads_total: number;
  bookings_total: number;
};

export type LifecycleRow = { id: string; event: string; occurred_at: string; details: Record<string, unknown> };

export type LifecyclePayload = {
  schema: typeof LIFECYCLE_SCHEMA;
  event: LifecycleEvent;
  event_id: string;
  occurred_at: string;
  sent_at: string;
  account_ref: string;
  contact_name: string;
  email: string;
  phone: string;
  business_name: string;
  website: string;
  plan: string;
  plan_name: string;
  previous_plan: string;
  previous_plan_name: string;
  frozen_forms_by_change: number;
  frozen_pixels_by_change: number;
  active_forms: number;
  draft_forms: number;
  frozen_forms: number;
  meta_pixels: number;
  connections: number;
  leads_total: number;
  bookings_total: number;
  signed_up_at: string;
};

/** The payload's keys, in order. Tests compare against this list. */
export const LIFECYCLE_PAYLOAD_KEYS: ReadonlyArray<keyof LifecyclePayload> = [
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

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function count(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Bootstrapping, Scaling, Suspended; "" when absent or unknown. */
export function lifecyclePlanName(plan: unknown): string {
  if (!isPlanState(plan)) return "";
  return plan === "suspended" ? "Suspended" : PLANS[plan].name;
}

/** Null when the event is unknown or the snapshot has no account_ref. Strings default to "", counts to 0. */
export function buildLifecyclePayload(row: LifecycleRow, snapshot: LifecycleSnapshot, nowIso: string): LifecyclePayload | null {
  if (!isLifecycleEvent(row.event)) return null;
  const accountRef = text(snapshot?.account_ref);
  if (!accountRef) return null;
  const details = row.details && typeof row.details === "object" ? row.details : {};
  const isPlanEvent = PLAN_EVENTS.has(row.event);
  const previousPlan = isPlanEvent ? text(details.from_plan) : "";
  return {
    schema: LIFECYCLE_SCHEMA,
    event: row.event,
    event_id: row.id,
    occurred_at: text(row.occurred_at),
    sent_at: nowIso,
    account_ref: accountRef,
    contact_name: text(snapshot.contact_name),
    email: text(snapshot.email),
    phone: text(snapshot.phone),
    business_name: text(snapshot.business_name),
    website: text(snapshot.website),
    plan: text(snapshot.plan),
    plan_name: lifecyclePlanName(snapshot.plan),
    previous_plan: previousPlan,
    previous_plan_name: lifecyclePlanName(previousPlan),
    frozen_forms_by_change: isPlanEvent ? count(details.frozen_forms) : 0,
    frozen_pixels_by_change: isPlanEvent ? count(details.frozen_pixels) : 0,
    active_forms: count(snapshot.active_forms),
    draft_forms: count(snapshot.draft_forms),
    frozen_forms: count(snapshot.frozen_forms),
    meta_pixels: count(snapshot.meta_pixels),
    connections: count(snapshot.connections),
    leads_total: count(snapshot.leads_total),
    bookings_total: count(snapshot.bookings_total),
    signed_up_at: text(snapshot.signed_up_at)
  };
}

export type LifecycleConfig = { url: URL; secret: string };

/** https only, no credentials, at most 2048 characters; secret matches WEBHOOK_SECRET_PATTERN. Null otherwise. */
export function lifecycleConfig(env: {
  FORMBOOK_LIFECYCLE_WEBHOOK_URL?: string;
  FORMBOOK_LIFECYCLE_WEBHOOK_SECRET?: string;
  [key: string]: string | undefined;
}): LifecycleConfig | null {
  const rawUrl = (env.FORMBOOK_LIFECYCLE_WEBHOOK_URL ?? "").trim();
  const secret = (env.FORMBOOK_LIFECYCLE_WEBHOOK_SECRET ?? "").trim();
  if (!rawUrl || rawUrl.length > 2048) return null;
  if (!WEBHOOK_SECRET_PATTERN.test(secret)) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  return { url, secret };
}

export const LIFECYCLE_USER_AGENT = "FormBook-Lifecycle/1.0";

export function lifecycleHeaders(input: {
  secret: string;
  timestampSec: number;
  rawBody: string;
  event: LifecycleEvent;
  eventId: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": LIFECYCLE_USER_AGENT,
    "X-FormBook-Event": input.event,
    "X-FormBook-Event-Id": input.eventId,
    [TIMESTAMP_HEADER]: String(input.timestampSec),
    [SIGNATURE_HEADER]: signPayload(input.secret, input.timestampSec, input.rawBody)
  };
}

/** Normalises the jsonb snapshot from lifecycle_tenant_snapshot; null when it is missing or has no account_ref. */
export function parseLifecycleSnapshot(value: unknown): LifecycleSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const accountRef = text(v.account_ref);
  if (!accountRef) return null;
  const nullable = (key: string) => (typeof v[key] === "string" && v[key] ? (v[key] as string) : null);
  return {
    account_ref: accountRef,
    contact_name: nullable("contact_name"),
    email: nullable("email"),
    phone: nullable("phone"),
    business_name: nullable("business_name"),
    website: nullable("website"),
    plan: text(v.plan),
    signed_up_at: text(v.signed_up_at),
    active_forms: count(v.active_forms),
    draft_forms: count(v.draft_forms),
    frozen_forms: count(v.frozen_forms),
    meta_pixels: count(v.meta_pixels),
    connections: count(v.connections),
    leads_total: count(v.leads_total),
    bookings_total: count(v.bookings_total)
  };
}

export const LIFECYCLE_COPY = {
  title: "Account sync to your CRM",
  on: "On. Account events are sent to your CRM webhook.",
  off: "Off. Set FORMBOOK_LIFECYCLE_WEBHOOK_URL and FORMBOOK_LIFECYCLE_WEBHOOK_SECRET to send account events to your CRM. Events wait up to 7 days.",
  pending: (n: number) => `Waiting to send: ${n}`,
  failed: (n: number) => `Failed in the last 7 days: ${n}`,
  lastSent: (when: string) => `Last sent: ${when}`,
  neverSent: "Nothing sent yet.",
  test: "Send test event",
  testSent: "Test event sent.",
  testFailed: "The test event was not accepted. Check the webhook URL and try again.",
  testOff: "Set the webhook URL and secret first.",
  testLimit: "You have sent 10 test events in the last hour. Please try again later."
} as const;
