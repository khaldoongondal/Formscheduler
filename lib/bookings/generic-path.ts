/**
 * Slot lookup and booking for every calendar other than GoHighLevel (P1.7).
 * It talks only to the CalendarProvider interface and records outcomes
 * through the shared recorder, so every provider feeds the same statuses,
 * analytics, split tests, Meta events and CRM events.
 */
import { PublicError } from "@/lib/api/responses";
import { buildBookingDescription } from "@/lib/bookings/outcome-plan";
import { createOutcomeRecorder } from "@/lib/bookings/outcomes";
import { SLOT_TAKEN_MESSAGE } from "@/lib/connections/copy";
import { calendarKindOf, resolveCalendar } from "@/lib/connections/resolve";
import { SlotTakenError, type EmbedSpec, type LeadIdentity, type Slot } from "@/lib/connections/types";
import { buildEventAnswers, buildEventTracking } from "@/lib/crm/event-payload";
import { getAnswersWithQuestions } from "@/lib/lead-sessions/service";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import { createServiceClient } from "@/lib/supabase/server";
import type { BookingAttempt, Funnel, Json, LeadSession } from "@/lib/types/database";
import type { bookAppointmentSchema, slotLookupSchema } from "@/lib/validation/bookings";
import type { z } from "zod";

type SlotLookupInput = z.infer<typeof slotLookupSchema>;
type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export const BOOKING_UNAVAILABLE_MESSAGE = "Booking is not available for this form right now. Please try again later.";
export const EMBED_BOOKING_MESSAGE = "Please choose a time in the calendar above.";
export const INVALID_SLOT_MESSAGE = "Please choose a time from the list.";
const MAX_BOOKING_MINUTES = 240;
const STALE_PENDING_MS = 300_000;

function errorText(error: unknown) {
  return (error instanceof Error ? error.message : "Unknown booking error").slice(0, 300);
}

export function leadIdentity(session: LeadSession): LeadIdentity {
  if (!session.external_ref) throw new Error("Lead has no external reference yet.");
  return {
    externalRef: session.external_ref,
    fullName: session.full_name,
    firstName: session.first_name,
    lastName: session.last_name,
    email: session.email,
    phone: session.phone
  };
}

/** Tracking values a provider may pass through (Calendly UTM parameters). */
export function trackingFrom(session: LeadSession): Record<string, string> {
  const { split_test: _splitTest, ...tracking } = buildEventTracking(session);
  void _splitTest;
  return Object.fromEntries(
    Object.entries(tracking).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
  );
}

async function recordSafely(run: () => Promise<unknown>) {
  try {
    await run();
  } catch (error) {
    console.error("[bookings] outcome record failed", error instanceof Error ? error.name : "unknown");
  }
}

export async function genericGetAvailableSlots(session: LeadSession, funnel: Funnel, parsed: SlotLookupInput) {
  const recorder = createOutcomeRecorder();
  const provider = calendarKindOf(funnel);
  const base = {
    calendarId: null,
    funnel,
    ghlContactId: session.ghl_contact_id,
    ghlOpportunityId: session.ghl_opportunity_id
  };

  const resolved = await resolveCalendar(funnel);
  if (!resolved) {
    await recordSafely(() =>
      recorder.record("booking_error", session, funnel, { provider, phase: "config", message: "calendar_unavailable" })
    );
    throw new PublicError(BOOKING_UNAVAILABLE_MESSAGE, 503);
  }

  if (resolved.provider.mode === "embed") {
    if (!resolved.provider.embed) throw new PublicError(BOOKING_UNAVAILABLE_MESSAGE, 503);
    let spec: EmbedSpec;
    try {
      spec = await resolved.provider.embed(resolved.ctx, leadIdentity(session), trackingFrom(session));
    } catch (error) {
      await recordSafely(() =>
        recorder.record("booking_error", session, funnel, { provider, phase: "slot_lookup", message: errorText(error) })
      );
      throw error;
    }
    await recorder.record("slots_shown", session, funnel, { provider, slotCount: null });
    return { ...base, slots: [] as Slot[], calendar: spec };
  }

  if (!resolved.provider.listSlots) throw new PublicError(BOOKING_UNAVAILABLE_MESSAGE, 503);
  let slots: Slot[];
  try {
    slots = await resolved.provider.listSlots(resolved.ctx, { timezone: parsed.timezone, nowMs: Date.now() });
  } catch (error) {
    await recordSafely(() =>
      recorder.record("booking_error", session, funnel, { provider, phase: "slot_lookup", message: errorText(error) })
    );
    throw error;
  }
  await recorder.record("slots_shown", session, funnel, { provider, slotCount: slots.length });
  return { ...base, slots, calendar: { mode: "slots" as const } };
}

export async function genericBookAppointment(
  session: LeadSession,
  funnel: Funnel,
  parsed: BookAppointmentInput
): Promise<{ attempt: BookingAttempt; metaEvents: Array<QueuedMetaEvent | null> }> {
  const recorder = createOutcomeRecorder();
  const provider = calendarKindOf(funnel);

  const resolved = await resolveCalendar(funnel);
  if (!resolved) {
    await recordSafely(() =>
      recorder.record("booking_error", session, funnel, { provider, phase: "config", message: "calendar_unavailable" })
    );
    throw new PublicError(BOOKING_UNAVAILABLE_MESSAGE, 503);
  }
  if (resolved.provider.mode === "embed" || !resolved.provider.book) {
    throw new PublicError(EMBED_BOOKING_MESSAGE, 400);
  }

  const startMs = new Date(parsed.slot_start).getTime();
  const endMs = new Date(parsed.slot_end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > MAX_BOOKING_MINUTES * 60_000) {
    throw new PublicError(INVALID_SLOT_MESSAGE, 400);
  }

  const supabase = createServiceClient();
  if (resolved.connectionId) {
    // Decision C13: a pending hold older than 5 minutes for this start no longer blocks it.
    const { error: staleError } = await supabase
      .from("booking_attempts")
      .update({ status: "error", error_code: "stale", error_message: "Abandoned pending booking." })
      .eq("tenant_id", session.tenant_id)
      .eq("calendar_connection_id", resolved.connectionId)
      .eq("slot_start", parsed.slot_start)
      .eq("status", "pending")
      .lt("created_at", new Date(Date.now() - STALE_PENDING_MS).toISOString());
    if (staleError) console.error("[bookings] stale hold cleanup failed", staleError.code ?? "unknown");
  }
  const { data: attempt, error: attemptError } = await supabase
    .from("booking_attempts")
    .insert({
      tenant_id: session.tenant_id,
      funnel_id: session.funnel_id,
      lead_session_id: session.id,
      provider,
      calendar_connection_id: resolved.connectionId,
      ghl_contact_id: session.ghl_contact_id,
      ghl_opportunity_id: session.ghl_opportunity_id,
      slot_start: parsed.slot_start,
      slot_end: parsed.slot_end,
      timezone: parsed.timezone,
      status: "pending",
      request_payload: parsed
    })
    .select("*")
    .single();

  if (attemptError) {
    if (attemptError.code === "23505") throw new PublicError(SLOT_TAKEN_MESSAGE, 409);
    throw new Error(attemptError.message);
  }

  const lead = leadIdentity(session);
  let result;
  try {
    const answers = buildEventAnswers(await getAnswersWithQuestions(session.id));
    result = await resolved.provider.book(resolved.ctx, {
      attemptId: attempt.id,
      slotStart: parsed.slot_start,
      slotEnd: parsed.slot_end,
      timezone: parsed.timezone,
      lead,
      title: funnel.appointment_title?.trim() || null,
      description: buildBookingDescription(lead, answers)
    });
  } catch (error) {
    const slotTaken = error instanceof SlotTakenError;
    await supabase
      .from("booking_attempts")
      .update({
        status: "error",
        ...(slotTaken ? { error_code: "slot_taken" } : {}),
        error_message: slotTaken ? "slot_taken" : errorText(error)
      })
      .eq("id", attempt.id)
      .eq("tenant_id", session.tenant_id);
    await recordSafely(() =>
      recorder.record("booking_error", session, funnel, {
        provider,
        phase: "appointment_create",
        message: slotTaken ? "slot_taken" : errorText(error)
      })
    );
    if (slotTaken) throw new PublicError(SLOT_TAKEN_MESSAGE, 409);
    throw error;
  }

  // The booking exists at the provider from here on: a later failure must not mark it as an error.
  const { data: updatedAttempt, error: updateAttemptError } = await supabase
    .from("booking_attempts")
    .update({
      status: "booked",
      external_booking_id: result.externalBookingId.slice(0, 500),
      meeting_url: result.meetingUrl && /^https:\/\//i.test(result.meetingUrl) ? result.meetingUrl.slice(0, 2048) : null,
      response_payload: result.raw as Json
    })
    .eq("id", attempt.id)
    .eq("tenant_id", session.tenant_id)
    .select("*")
    .single();
  if (updateAttemptError) console.error("[bookings] booked attempt update failed", updateAttemptError.code ?? "unknown");

  const { metaEvents } = await recorder.record("booked", session, funnel, {
    provider,
    externalBookingId: result.externalBookingId,
    confirmationRequired: result.confirmationRequired,
    booking: {
      provider,
      start: result.startTime,
      end: result.endTime,
      timezone: parsed.timezone,
      externalId: result.externalBookingId,
      meetingUrl: result.meetingUrl
    }
  });

  return { attempt: updatedAttempt ?? attempt, metaEvents };
}
