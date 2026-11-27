/**
 * What every non-GoHighLevel calendar records at slots shown, booked and
 * booking error (decision C22), as an ordered list of steps.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { CalendarKind, LeadIdentity } from "@/lib/connections/types";
import { answerLinesText, type FormBookEventAnswer } from "@/lib/crm/event-payload";
import type { Json } from "@/lib/types/database";

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
