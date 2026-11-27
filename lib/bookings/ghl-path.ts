/**
 * The GoHighLevel slot lookup and booking, moved here unchanged from
 * lib/bookings/service.ts (decision C4). The only edits: slot lookup and
 * appointment creation go through the GoHighLevel calendar adapter, and the
 * booking attempt records `provider: "ghl"` once migration 0029 is applied.
 * Requests, order, statuses, analytics and error messages are as before.
 */
import { trackEvent } from "@/lib/analytics/service";
import { bookWithContact, ghlCalendarProvider, type GhlCalendarCtx } from "@/lib/connections/ghl-calendar";
import { getFunnelGhlConfig } from "@/lib/ghl/funnel-config";
import { ensureGhlOpportunity } from "@/lib/ghl/service";
import { updateLeadSessionStatus } from "@/lib/lead-sessions/service";
import { createServiceClient } from "@/lib/supabase/server";
import { onLeadStage } from "@/lib/meta/hooks";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import type { BookingAttempt, Funnel, Json, LeadSession } from "@/lib/types/database";
import type { bookAppointmentSchema, slotLookupSchema } from "@/lib/validation/bookings";
import type { z } from "zod";

type SlotLookupInput = z.infer<typeof slotLookupSchema>;
type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;

export async function ghlGetAvailableSlots(session: LeadSession, publicFunnel: Funnel, parsed: SlotLookupInput) {
  void publicFunnel;
  const supabase = createServiceClient();
  const { funnel, connection, config, calendarId, slotDurationMinutes, availabilityWindowDays } = await getFunnelGhlConfig(session.funnel_id);
  const ctx: GhlCalendarCtx = { config, calendarId, slotDurationMinutes, availabilityWindowDays };

  try {
    if (!session.ghl_contact_id) {
      throw new Error("Lead must be captured in GHL before calendar availability can load.");
    }

    let opportunityId = session.ghl_opportunity_id;
    if (!opportunityId) {
      opportunityId = await ensureGhlOpportunity({
        config,
        funnel,
        leadSession: session,
        contactId: session.ghl_contact_id,
        stage: "opt_in"
      });
    }

    if (session.ghl_connection_id !== connection.id || session.ghl_opportunity_id !== opportunityId) {
      const { error } = await supabase
        .from("lead_sessions")
        .update({
          ghl_connection_id: connection.id,
          ghl_opportunity_id: opportunityId
        })
        .eq("id", session.id);
      if (error) throw new Error(error.message);
    }

    const slots = await ghlCalendarProvider.listSlots!(ctx, { timezone: parsed.timezone, nowMs: Date.now() });
    await updateLeadSessionStatus(session.id, "slots_shown");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "slots_shown",
      metadata: { slot_count: slots.length }
    });

    return {
      calendarId,
      funnel,
      ghlContactId: session.ghl_contact_id,
      ghlOpportunityId: opportunityId,
      slots
    };
  } catch (error) {
    await updateLeadSessionStatus(session.id, "error");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "booking_error",
      metadata: { phase: "slot_lookup", message: error instanceof Error ? error.message : "Unknown booking error" }
    });
    throw error;
  }
}

export async function ghlBookAppointment(
  session: LeadSession,
  publicFunnel: Funnel,
  parsed: BookAppointmentInput
): Promise<{ attempt: BookingAttempt; metaEvents: Array<QueuedMetaEvent | null> }> {
  const supabase = createServiceClient();
  const { funnel, connection, config, calendarId, slotDurationMinutes, availabilityWindowDays } = await getFunnelGhlConfig(session.funnel_id);
  const ctx: GhlCalendarCtx = { config, calendarId, slotDurationMinutes, availabilityWindowDays };

  if (!session.ghl_contact_id) {
    throw new Error("Lead must be upserted to GHL before booking.");
  }

  const { data: attempt, error: attemptError } = await supabase
    .from("booking_attempts")
    .insert({
      tenant_id: session.tenant_id,
      funnel_id: session.funnel_id,
      lead_session_id: session.id,
      ghl_contact_id: session.ghl_contact_id,
      ghl_opportunity_id: session.ghl_opportunity_id,
      ghl_calendar_id: calendarId,
      slot_start: parsed.slot_start,
      slot_end: parsed.slot_end,
      timezone: parsed.timezone,
      status: "pending",
      request_payload: parsed,
      // Migration 0029 adds the column; a database without it keeps working.
      ...(publicFunnel.calendar_provider !== undefined ? { provider: "ghl" } : {})
    })
    .select("*")
    .single();

  if (attemptError) throw new Error(attemptError.message);

  try {
    const appointment = await bookWithContact(ctx, session.ghl_contact_id, {
      slotStart: parsed.slot_start,
      slotEnd: parsed.slot_end,
      timezone: parsed.timezone,
      title: funnel.appointment_title?.trim() || undefined
    });

    const appointmentId = appointment.appointment?.id ?? appointment.event?.id ?? appointment.id;
    if (!appointmentId) {
      throw new Error("GHL appointment response did not include an appointment id.");
    }

    const opportunityId = await ensureGhlOpportunity({
      config,
      funnel,
      leadSession: session,
      contactId: session.ghl_contact_id,
      stage: "booked"
    });

    const { data: updatedAttempt, error: updateAttemptError } = await supabase
      .from("booking_attempts")
      .update({
        status: "booked",
        ghl_appointment_id: appointmentId,
        ghl_opportunity_id: opportunityId,
        response_payload: appointment as unknown as Json
      })
      .eq("id", attempt.id)
      .select("*")
      .single();

    if (updateAttemptError) throw new Error(updateAttemptError.message);

    const { error: sessionUpdateError } = await supabase
      .from("lead_sessions")
      .update({
        ghl_connection_id: connection.id,
        ghl_opportunity_id: opportunityId
      })
      .eq("id", session.id);
    if (sessionUpdateError) throw new Error(sessionUpdateError.message);

    const bookedSession = await updateLeadSessionStatus(session.id, "booked");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "appointment_booked",
      metadata: { appointment_id: appointmentId, opportunity_id: opportunityId }
    });

    // Meta booked call. Never throws, so a Meta problem cannot mark the booking as failed.
    const bookedEvent = await onLeadStage("booked_call", bookedSession, publicFunnel);
    return { attempt: updatedAttempt, metaEvents: [bookedEvent] };
  } catch (error) {
    await supabase
      .from("booking_attempts")
      .update({
        status: "error",
        error_message: error instanceof Error ? error.message : "Unknown booking error"
      })
      .eq("id", attempt.id);
    await updateLeadSessionStatus(session.id, "error");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "booking_error",
      metadata: { phase: "appointment_create", message: error instanceof Error ? error.message : "Unknown booking error" }
    });
    throw error;
  }
}
