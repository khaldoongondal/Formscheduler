/**
 * Calendar and CRM provider interfaces (Sprint 3, decision C4).
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { FormBookEvent } from "@/lib/crm/event-payload";

export type { FormBookEvent };

export type CalendarKind = "ghl" | "google_calendar" | "calcom" | "calendly";
export type CrmKind = "ghl" | "hubspot" | "webhook";
export type GenericProvider = "google_calendar" | "calcom" | "calendly" | "hubspot" | "webhook";
export type ConnectionStatus = "connected" | "needs_attention" | "disabled";

export const CALENDAR_KINDS: readonly CalendarKind[] = ["ghl", "google_calendar", "calcom", "calendly"];
export const CRM_KINDS: readonly CrmKind[] = ["ghl", "hubspot", "webhook"];
export const GENERIC_PROVIDERS: readonly GenericProvider[] = ["google_calendar", "calcom", "calendly", "hubspot", "webhook"];

export function isCalendarKind(value: unknown): value is CalendarKind {
  return typeof value === "string" && (CALENDAR_KINDS as readonly string[]).includes(value);
}

export function isCrmKind(value: unknown): value is CrmKind {
  return typeof value === "string" && (CRM_KINDS as readonly string[]).includes(value);
}

/** ISO UTC times; the same shape the slots API returns today. */
export type Slot = { startTime: string; endTime: string; timezone: string };

export type LeadIdentity = {
  /** lead_sessions.external_ref, never the session id (decision C21). */
  externalRef: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
};

export type SlotRequest = { timezone: string; nowMs: number };

export type BookRequest = {
  attemptId: string;
  slotStart: string;
  slotEnd: string;
  timezone: string;
  lead: LeadIdentity;
  title: string | null;
  description: string;
};

export type BookingResult = {
  externalBookingId: string;
  meetingUrl: string | null;
  startTime: string;
  endTime: string;
  /** Trimmed provider response for booking_attempts.response_payload (never a token). */
  raw: Record<string, unknown>;
  confirmationRequired?: boolean;
};

export type EmbedSpec = {
  mode: "embed";
  provider: "calendly";
  url: string;
  prefill: { name?: string; email?: string; firstName?: string; lastName?: string };
};

export class SlotTakenError extends Error {
  constructor() {
    super("slot_taken");
    this.name = "SlotTakenError";
  }
}

export class ProviderAuthError extends Error {
  constructor(public provider: string) {
    super(`${provider}_auth`);
    this.name = "ProviderAuthError";
  }
}

export interface CalendarProvider<Ctx = unknown> {
  kind: CalendarKind;
  mode: "slots" | "embed";
  listSlots?(ctx: Ctx, request: SlotRequest): Promise<Slot[]>;
  book?(ctx: Ctx, request: BookRequest): Promise<BookingResult>;
  /** Gaps the calendar keeps around each booking; overlapping FormBook holds count within them. */
  bookingPadding?(ctx: Ctx): { beforeMs: number; afterMs: number };
  embed?(ctx: Ctx, lead: LeadIdentity, tracking: Record<string, string>): Promise<EmbedSpec>;
}

export type CrmEventType = "lead.captured" | "lead.qualified" | "lead.disqualified" | "lead.booked" | "test.ping";

export type CrmLeadState = {
  crmContactId: string | null;
  crmDealId: string | null;
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
};

export type CrmDeliveryOutcome = {
  outcome: "sent" | "retry" | "failed";
  httpStatus: number | null;
  /** At most 500 characters, never a token; shown in the delivery log. */
  summary: string;
  updates?: { crmContactId?: string; crmDealId?: string; ghlContactId?: string; ghlOpportunityId?: string };
};

export interface CrmProvider<Ctx = unknown> {
  kind: CrmKind;
  /** Idempotent per event id. `delivery.id` is the queue row (sent as a header by the webhook). */
  deliver(ctx: Ctx, event: FormBookEvent, lead: CrmLeadState, delivery?: { id: string }): Promise<CrmDeliveryOutcome>;
  check?(ctx: Ctx): Promise<{ ok: boolean; summary: string }>;
}
