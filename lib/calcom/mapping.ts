/**
 * Cal.com request bodies and response parsing (P2.7). Tolerant parsers:
 * unknown shapes are dropped, never trusted.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { LeadIdentity, Slot } from "@/lib/connections/types";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** data[date] holds strings (default format) or { start, end? } objects (format=range). U11. */
export function parseCalcomSlots(body: unknown, displayTimezone: string, fallbackMinutes: number): Slot[] {
  const data = asRecord(asRecord(body)?.data);
  if (!data) return [];
  const minutes = Number.isFinite(fallbackMinutes) && fallbackMinutes > 0 ? fallbackMinutes : 30;
  const byStart = new Map<number, number>();
  for (const entries of Object.values(data)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const record = asRecord(entry);
      const startRaw = typeof entry === "string" ? entry : typeof record?.start === "string" ? record.start : null;
      if (!startRaw) continue;
      const startMs = Date.parse(startRaw);
      if (!Number.isFinite(startMs)) continue;
      const endRaw = typeof record?.end === "string" ? Date.parse(record.end) : NaN;
      const endMs = Number.isFinite(endRaw) && endRaw > startMs ? endRaw : startMs + minutes * 60_000;
      if (!byStart.has(startMs)) byStart.set(startMs, endMs);
    }
  }
  return Array.from(byStart.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([startMs, endMs]) => ({
      startTime: new Date(startMs).toISOString(),
      endTime: new Date(endMs).toISOString(),
      timezone: displayTimezone
    }));
}

const E164 = /^\+[1-9]\d{7,14}$/;

export function calcomAttendeeName(lead: LeadIdentity): string {
  const full = lead.fullName?.trim();
  if (full) return full.slice(0, 200);
  const joined = [lead.firstName, lead.lastName].map((part) => part?.trim()).filter(Boolean).join(" ");
  if (joined) return joined.slice(0, 200);
  if (lead.email?.trim()) return lead.email.trim();
  if (lead.phone?.trim()) return lead.phone.trim();
  return "Guest";
}

export function buildCalcomBookingBody(input: {
  eventTypeId: number;
  slotStartIso: string;
  lead: LeadIdentity;
  timezone: string;
}): Record<string, unknown> {
  const attendee: Record<string, unknown> = { name: calcomAttendeeName(input.lead), timeZone: input.timezone };
  const email = input.lead.email?.trim();
  if (email) attendee.email = email;
  const phone = input.lead.phone?.replace(/[\s().-]/g, "");
  if (phone && E164.test(phone)) attendee.phoneNumber = phone;
  return {
    start: new Date(input.slotStartIso).toISOString(),
    eventTypeId: input.eventTypeId,
    attendee,
    metadata: { formbook_ref: input.lead.externalRef }
  };
}

export type CalcomBooking = { uid: string; status: string; location: string | null; start: string; end: string };

export function parseCalcomBooking(body: unknown): CalcomBooking | null {
  let data: unknown = asRecord(body)?.data;
  if (Array.isArray(data)) data = data[0];
  const record = asRecord(data);
  if (!record || typeof record.uid !== "string" || !record.uid) return null;
  const startMs = typeof record.start === "string" ? Date.parse(record.start) : NaN;
  const endMs = typeof record.end === "string" ? Date.parse(record.end) : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return {
    uid: record.uid.slice(0, 500),
    status: typeof record.status === "string" ? record.status : "accepted",
    location: typeof record.location === "string" && record.location ? record.location : null,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString()
  };
}

export type CalcomEventType = {
  id: number;
  title: string;
  slug: string;
  lengthInMinutes: number;
  hidden: boolean;
  requiresConfirmation: boolean;
};

function requiresConfirmationOf(record: Record<string, unknown>): boolean {
  if (typeof record.requiresConfirmation === "boolean") return record.requiresConfirmation;
  const policy = asRecord(record.confirmationPolicy);
  if (policy) return policy.disabled !== true;
  return false;
}

export function parseCalcomEventTypes(body: unknown): CalcomEventType[] {
  const root = asRecord(body);
  let list: unknown = root?.data;
  const nested = asRecord(list);
  if (nested && Array.isArray(nested.eventTypes)) list = nested.eventTypes;
  if (!Array.isArray(list)) return [];
  const result: CalcomEventType[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const id = Number(record.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    const length = Number(record.lengthInMinutes ?? record.length);
    result.push({
      id,
      title: typeof record.title === "string" && record.title ? record.title.slice(0, 200) : `Event type ${id}`,
      slug: typeof record.slug === "string" ? record.slug.slice(0, 200) : "",
      lengthInMinutes: Number.isFinite(length) && length > 0 ? Math.round(length) : 30,
      hidden: record.hidden === true,
      requiresConfirmation: requiresConfirmationOf(record)
    });
  }
  return result;
}

export function parseCalcomMe(body: unknown): { id: number; username: string } | null {
  const data = asRecord(asRecord(body)?.data);
  if (!data) return null;
  const id = Number(data.id);
  const username = typeof data.username === "string" ? data.username.trim() : "";
  if (!Number.isInteger(id) || id <= 0 || !username) return null;
  return { id, username: username.slice(0, 200) };
}

export function isSlotUnavailableError(status: number, message: string): boolean {
  if (status !== 400 && status !== 409) return false;
  return /no.*available|already.*booked|not available/i.test(message);
}
