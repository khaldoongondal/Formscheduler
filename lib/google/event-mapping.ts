/**
 * Google Calendar request bodies and response parsing (P2.6).
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { BookingResult, LeadIdentity } from "@/lib/connections/types";
import type { BusyInterval } from "@/lib/google/availability";
import { googleEventIdFor } from "@/lib/google/oauth-core";

export const GOOGLE_CALENDAR_API_BASE = "https://www.googleapis.com/calendar/v3";

/** calendars[id].busy -> BusyInterval[]; a calendar error throws (the slots would be wrong). */
export function parseFreeBusy(body: unknown, calendarId: string): BusyInterval[] {
  const calendars = (body as { calendars?: Record<string, unknown> } | null)?.calendars;
  const entry = calendars && typeof calendars === "object" ? (calendars[calendarId] as Record<string, unknown> | undefined) : undefined;
  if (!entry || typeof entry !== "object") throw new Error("google_freebusy_missing_calendar");
  if (Array.isArray(entry.errors) && entry.errors.length) {
    const reason = (entry.errors[0] as { reason?: unknown })?.reason;
    throw new Error(`google_freebusy_${typeof reason === "string" ? reason.replace(/[^a-zA-Z_]/g, "").slice(0, 40) : "error"}`);
  }
  const busy = Array.isArray(entry.busy) ? entry.busy : [];
  const intervals: BusyInterval[] = [];
  for (const item of busy) {
    const start = Date.parse(String((item as { start?: unknown })?.start ?? ""));
    const end = Date.parse(String((item as { end?: unknown })?.end ?? ""));
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) intervals.push({ startMs: start, endMs: end });
  }
  return intervals;
}

function leadDisplayName(lead: LeadIdentity): string | null {
  const full = lead.fullName?.trim() || [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  return full || null;
}

export function buildGoogleEventBody(input: {
  attemptId: string;
  slotStart: string;
  slotEnd: string;
  timezone: string;
  lead: LeadIdentity;
  title: string | null;
  description: string;
  meet: boolean;
}): Record<string, unknown> {
  const name = leadDisplayName(input.lead);
  const who = name ?? input.lead.email ?? input.lead.phone ?? "a new lead";
  const summary = (input.title?.trim() || `Call with ${who}`).slice(0, 300);
  const body: Record<string, unknown> = {
    id: googleEventIdFor(input.attemptId),
    summary,
    description: input.description,
    start: { dateTime: input.slotStart, timeZone: input.timezone },
    end: { dateTime: input.slotEnd, timeZone: input.timezone },
    attendees: input.lead.email ? [{ email: input.lead.email, ...(name ? { displayName: name } : {}) }] : [],
    extendedProperties: { private: { formbook_ref: input.lead.externalRef } }
  };
  if (input.meet) {
    body.conferenceData = { createRequest: { requestId: input.attemptId, conferenceSolutionKey: { type: "hangoutsMeet" } } };
  }
  return body;
}

export function googleEventPath(calendarId: string, meet: boolean): string {
  return `/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=all${meet ? "&conferenceDataVersion=1" : ""}`;
}

function httpsOrNull(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\//i.test(value) && value.length <= 2048 ? value : null;
}

/** The FormBook reference stored on an event, used to recognise our own event after a 409. */
export function eventFormbookRef(body: unknown): string | null {
  const ref = (body as { extendedProperties?: { private?: { formbook_ref?: unknown } } } | null)?.extendedProperties?.private
    ?.formbook_ref;
  return typeof ref === "string" ? ref : null;
}

export function parseGoogleEvent(body: unknown, fallback: { slotStart: string; slotEnd: string }): BookingResult | null {
  if (!body || typeof body !== "object") return null;
  const event = body as Record<string, unknown>;
  if (typeof event.id !== "string" || !event.id) return null;
  const entryPoints = (event.conferenceData as { entryPoints?: Array<{ entryPointType?: unknown; uri?: unknown }> } | undefined)
    ?.entryPoints;
  const video = Array.isArray(entryPoints) ? entryPoints.find((entry) => entry?.entryPointType === "video") : undefined;
  const meetingUrl = httpsOrNull(event.hangoutLink) ?? httpsOrNull(video?.uri) ?? null;
  const start = (event.start as { dateTime?: unknown } | undefined)?.dateTime;
  const end = (event.end as { dateTime?: unknown } | undefined)?.dateTime;
  const startMs = typeof start === "string" ? Date.parse(start) : NaN;
  const endMs = typeof end === "string" ? Date.parse(end) : NaN;
  return {
    externalBookingId: event.id,
    meetingUrl,
    startTime: Number.isFinite(startMs) ? new Date(startMs).toISOString() : fallback.slotStart,
    endTime: Number.isFinite(endMs) ? new Date(endMs).toISOString() : fallback.slotEnd,
    raw: {
      id: event.id,
      htmlLink: httpsOrNull(event.htmlLink),
      status: typeof event.status === "string" ? event.status : null,
      hangoutLink: httpsOrNull(event.hangoutLink)
    }
  };
}
