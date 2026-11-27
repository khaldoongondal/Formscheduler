/**
 * What every non-GoHighLevel calendar records at slots shown, booked and
 * booking error (decision C22), as an ordered list of steps.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { CalendarKind, CrmEventType, LeadIdentity } from "@/lib/connections/types";
import { answerLinesText, type FormBookEventAnswer } from "@/lib/crm/event-payload";
import type { AnalyticsEventType, Json, LeadSessionStatus } from "@/lib/types/database";

/**
 * What one lead moment records, per calendar kind (decision C22, P4.5).
 * The code paths are checked against this table in tests/consistency.test.ts.
 */
export type LifecycleStage = "lead" | "qualified" | "disqualified" | "slots_shown" | "booked" | "booking_error";
export type StageRecord = {
  /** Lead status set at this moment; null when the status does not change. */
  status: LeadSessionStatus | null;
  analytics: AnalyticsEventType;
  meta: "lead" | "qualified_lead" | "disqualified_lead" | "booked_call" | null;
  /** CRM event queued after the response; null on the GoHighLevel path (inline handoff). */
  crm: Exclude<CrmEventType, "test.ping"> | null;
  /** Analytics metadata carries `provider`. */
  providerMetadata: boolean;
};

export const LIFECYCLE_STAGES: readonly LifecycleStage[] = [
  "lead",
  "qualified",
  "disqualified",
  "slots_shown",
  "booked",
  "booking_error"
];

const GENERIC_ROW: Record<LifecycleStage, StageRecord> = {
  lead: { status: "potential", analytics: "lead_captured", meta: "lead", crm: "lead.captured", providerMetadata: true },
  qualified: { status: "qualified", analytics: "qualified_lead", meta: "qualified_lead", crm: "lead.qualified", providerMetadata: true },
  disqualified: {
    status: "disqualified",
    analytics: "disqualified_lead",
    meta: "disqualified_lead",
    crm: "lead.disqualified",
    providerMetadata: true
  },
  slots_shown: { status: "slots_shown", analytics: "slots_shown", meta: null, crm: null, providerMetadata: true },
  booked: { status: "booked", analytics: "appointment_booked", meta: "booked_call", crm: "lead.booked", providerMetadata: true },
  // Decision C5: the generic path never sets the `error` status.
  booking_error: { status: null, analytics: "booking_error", meta: null, crm: null, providerMetadata: true }
};

/**
 * The GoHighLevel path differs from every other calendar only by these
 * documented items: contact and opportunity are handled inline (no queued CRM
 * event), a failed handoff or booking sets the `error` status, and analytics
 * rows carry no `metadata.provider` (unchanged from before Sprint 3).
 */
const GHL_ROW: Record<LifecycleStage, StageRecord> = {
  lead: { ...GENERIC_ROW.lead, crm: null, providerMetadata: false },
  qualified: { ...GENERIC_ROW.qualified, crm: null, providerMetadata: false },
  disqualified: { ...GENERIC_ROW.disqualified, crm: null, providerMetadata: false },
  slots_shown: { ...GENERIC_ROW.slots_shown, crm: null, providerMetadata: false },
  booked: { ...GENERIC_ROW.booked, crm: null, providerMetadata: false },
  booking_error: { ...GENERIC_ROW.booking_error, status: "error", crm: null, providerMetadata: false }
};

export const PROVIDER_EVENT_MATRIX: Record<CalendarKind, Record<LifecycleStage, StageRecord>> = {
  ghl: GHL_ROW,
  google_calendar: GENERIC_ROW,
  calcom: GENERIC_ROW,
  calendly: GENERIC_ROW
};

/** The fields of a GoHighLevel row that may differ from the Google row. */
export const GHL_DOCUMENTED_DIFFERENCES: ReadonlyArray<keyof StageRecord> = ["crm", "providerMetadata", "status"];

/**
 * Analytics metadata added at lead, qualified and disqualified for a form on
 * a non-GoHighLevel calendar (decision C22). Undefined for GoHighLevel, whose
 * rows stay exactly as before.
 */
export function leadStageMetadata(kind: CalendarKind | null | undefined): { provider: CalendarKind } | undefined {
  const resolved = kind ?? "ghl";
  return PROVIDER_EVENT_MATRIX[resolved]?.lead.providerMetadata ? { provider: resolved } : undefined;
}

export type OutcomeKind = "slots_shown" | "booked" | "booking_error";

export type OutcomeStep =
  | { do: "status"; status: "slots_shown" | "booked" }
  | { do: "track"; eventType: "slots_shown" | "appointment_booked" | "booking_error"; metadata: Record<string, Json> }
  | { do: "meta"; key: "booked_call" }
  | { do: "crm"; type: "lead.booked" };

export type OutcomeInput = {
  provider: CalendarKind;
  slotCount?: number | null;
  externalBookingId?: string;
  phase?: string;
  message?: string;
  confirmationRequired?: boolean;
};

export const OUTCOME_MESSAGE_CAP = 300;

export function planOutcome(kind: OutcomeKind, input: OutcomeInput): OutcomeStep[] {
  if (kind === "slots_shown") {
    const metadata: Record<string, Json> = { provider: input.provider };
    if (input.slotCount !== null && input.slotCount !== undefined) metadata.slot_count = input.slotCount;
    return [
      { do: "status", status: "slots_shown" },
      { do: "track", eventType: "slots_shown", metadata }
    ];
  }

  if (kind === "booked") {
    const metadata: Record<string, Json> = { provider: input.provider, booking_id: input.externalBookingId ?? null };
    if (input.confirmationRequired) metadata.confirmation_required = true;
    return [
      { do: "status", status: "booked" },
      { do: "track", eventType: "appointment_booked", metadata },
      { do: "meta", key: "booked_call" },
      { do: "crm", type: "lead.booked" }
    ];
  }

  // booking_error: analytics only. The generic path never sets the `error` status (decision C5).
  return [
    {
      do: "track",
      eventType: "booking_error",
      metadata: {
        provider: input.provider,
        phase: input.phase ?? "unknown",
        message: (input.message ?? "Unknown booking error").slice(0, OUTCOME_MESSAGE_CAP)
      }
    }
  ];
}

export const BOOKING_DESCRIPTION_CAP = 4000;

/**
 * The calendar event description. No tracking values: the attendee can see
 * the event.
 */
export function buildBookingDescription(lead: LeadIdentity, answers: FormBookEventAnswer[]): string {
  const name = lead.fullName?.trim() || [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim();
  const header = [
    "Booked through FormBook.",
    name ? `Name: ${name}` : null,
    lead.email ? `Email: ${lead.email}` : null,
    lead.phone ? `Phone: ${lead.phone}` : null
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
  const remaining = BOOKING_DESCRIPTION_CAP - header.length - 2;
  const answerText = remaining > 0 ? answerLinesText(answers, remaining) : "";
  const text = answerText ? `${header}\n\n${answerText}` : header;
  return text.slice(0, BOOKING_DESCRIPTION_CAP);
}
