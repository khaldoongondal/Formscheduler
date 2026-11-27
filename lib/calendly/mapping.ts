/**
 * Calendly API and webhook parsers (P3.7). Tolerant of missing fields (U15).
 * Pure: no imports beyond constants.
 */
import {
  EVENT_TYPE_URI_PATTERN,
  EVENT_URI_PATTERN,
  INVITEE_URI_PATTERN,
  ORGANIZATION_URI_PATTERN,
  SCHEDULING_URL_PATTERN,
  USER_URI_PATTERN,
  WEBHOOK_SUBSCRIPTION_URI_PATTERN
} from "@/lib/calendly/constants";

export type CalendlyTracking = {
  salesforce_uuid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

export type CalendlyInvitee = {
  uri: string;
  email: string | null;
  name: string | null;
  timezone: string | null;
  status: string | null;
  eventUri: string | null;
  eventTypeUri: string | null;
  start: string | null;
  end: string | null;
  tracking: CalendlyTracking;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, max = 500): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function parseTracking(value: unknown): CalendlyTracking {
  const record = asRecord(value);
  return {
    salesforce_uuid: str(record.salesforce_uuid, 100),
    utm_source: str(record.utm_source, 255),
    utm_medium: str(record.utm_medium, 255),
    utm_campaign: str(record.utm_campaign, 255),
    utm_content: str(record.utm_content, 255),
    utm_term: str(record.utm_term, 255)
  };
}

function inviteeFrom(record: Record<string, unknown>): CalendlyInvitee | null {
  const uri = matching(record.uri, INVITEE_URI_PATTERN);
  if (!uri) return null;
  const scheduled = asRecord(record.scheduled_event);
  // The invitee resource names its event as a plain uri; the webhook payload nests scheduled_event.
  const eventUri = matching(scheduled.uri, EVENT_URI_PATTERN) ?? matching(record.event, EVENT_URI_PATTERN);
  return {
    uri,
    email: str(record.email, 254)?.toLowerCase() ?? null,
    name: str(record.name, 200),
    timezone: str(record.timezone, 100),
    status: str(record.status, 40),
    eventUri,
    eventTypeUri: matching(scheduled.event_type, EVENT_TYPE_URI_PATTERN),
    start: isoOrNull(scheduled.start_time),
    end: isoOrNull(scheduled.end_time),
    tracking: parseTracking(record.tracking)
  };
}

/** Webhook body `{ event, payload }`. */
export function parseCalendlyInviteePayload(body: unknown): { event: string; invitee: CalendlyInvitee | null } {
  const record = asRecord(body);
  const event = str(record.event, 60) ?? "";
  return { event, invitee: inviteeFrom(asRecord(record.payload)) };
}

/** GET invitee `{ resource }`. */
export function parseInviteeResource(body: unknown): CalendlyInvitee | null {
  return inviteeFrom(asRecord(asRecord(body).resource));
}

export type CalendlyEvent = { uri: string; eventTypeUri: string | null; start: string | null; end: string | null; status: string | null };

/** GET scheduled event `{ resource }`. */
export function parseEventResource(body: unknown): CalendlyEvent | null {
  const resource = asRecord(asRecord(body).resource);
  const uri = matching(resource.uri, EVENT_URI_PATTERN);
  if (!uri) return null;
  return {
    uri,
    eventTypeUri: matching(resource.event_type, EVENT_TYPE_URI_PATTERN),
    start: isoOrNull(resource.start_time),
    end: isoOrNull(resource.end_time),
    status: str(resource.status, 40)
  };
}

/** The opaque reference passed through the widget wins over an email match. */
export function matchesLead(invitee: CalendlyInvitee, lead: { externalRef: string; email: string | null }): "ref" | "email" | null {
  if (invitee.tracking.salesforce_uuid && lead.externalRef && invitee.tracking.salesforce_uuid.toLowerCase() === lead.externalRef.toLowerCase()) {
    return "ref";
  }
  const leadEmail = lead.email?.trim().toLowerCase();
  if (leadEmail && invitee.email && invitee.email === leadEmail) return "email";
  return null;
}

export type CalendlyEventType = { uri: string; name: string; schedulingUrl: string; duration: number | null; active: boolean };

/** GET /event_types `{ collection }`; entries without a valid uri or scheduling url are dropped. */
export function parseEventTypes(body: unknown): CalendlyEventType[] {
  const collection = asRecord(body).collection;
  if (!Array.isArray(collection)) return [];
  const types: CalendlyEventType[] = [];
  for (const item of collection) {
    const record = asRecord(item);
    const uri = matching(record.uri, EVENT_TYPE_URI_PATTERN);
    const schedulingUrl = matching(record.scheduling_url, SCHEDULING_URL_PATTERN);
    if (!uri || !schedulingUrl) continue;
    const duration = Number(record.duration);
    types.push({
      uri,
      name: str(record.name, 200) ?? "Event",
      schedulingUrl,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      active: record.active !== false
    });
  }
  return types;
}

export type CalendlyUser = { uri: string; name: string | null; organization: string | null };

/** GET /users/me `{ resource }`. */
export function parseCurrentUser(body: unknown): CalendlyUser | null {
  const resource = asRecord(asRecord(body).resource);
  const uri = matching(resource.uri, USER_URI_PATTERN);
  if (!uri) return null;
  return { uri, name: str(resource.name, 200), organization: matching(resource.current_organization, ORGANIZATION_URI_PATTERN) };
}

export type CalendlySubscription = { uri: string; callbackUrl: string | null };

export function parseSubscription(body: unknown): CalendlySubscription | null {
  const record = asRecord(body);
  const resource = Object.keys(asRecord(record.resource)).length ? asRecord(record.resource) : record;
  const uri = matching(resource.uri, WEBHOOK_SUBSCRIPTION_URI_PATTERN);
  if (!uri) return null;
  return { uri, callbackUrl: str(resource.callback_url, 2048) };
}

export function parseSubscriptions(body: unknown): CalendlySubscription[] {
  const collection = asRecord(body).collection;
  if (!Array.isArray(collection)) return [];
  return collection.map((item) => parseSubscription(item)).filter((item): item is CalendlySubscription => item !== null);
}

/** The text of Calendly's error body, for the paid plan refusal (C16). */
export function isUpgradeRefusal(message: string): boolean {
  return /upgrade to a paid calendly account/i.test(message);
}
