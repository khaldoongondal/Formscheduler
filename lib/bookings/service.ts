import { trackEvent } from "@/lib/analytics/service";
import { createDemoGhlId, createDemoSlots, getDemoCalendarId, isDemoSlotModeEnabled } from "@/lib/demo/slots";
import { getFunnelGhlConfig } from "@/lib/ghl/funnel-config";
import {
  bookGhlAppointment,
  ensureGhlOpportunity,
  lookupAvailability
} from "@/lib/ghl/service";
import { getLeadSession, updateLeadSessionStatus } from "@/lib/lead-sessions/service";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";
import { bookAppointmentSchema, slotLookupSchema } from "@/lib/validation/bookings";

export async function getAvailableSlots(input: unknown) {
  const parsed = slotLookupSchema.parse(input);
  const supabase = createServiceClient();
  const session = await getLeadSession(parsed.lead_session_id);

  if (session.status === "disqualified") {
    throw new Error("This lead is not eligible to view calendar availability.");
  }

  if (isDemoSlotModeEnabled()) {
    const { data: funnel, error: funnelError } = await supabase
      .from("funnels")
      .select("*")
      .eq("id", session.funnel_id)
      .single();

    if (funnelError) throw new Error(funnelError.message);

    const ghlContactId = session.ghl_contact_id ?? createDemoGhlId("contact", session.id);
    const ghlOpportunityId = session.ghl_opportunity_id ?? createDemoGhlId("opportunity", session.id);
    const calendarId = getDemoCalendarId(funnel);
    const slots = createDemoSlots(parsed.timezone, funnel.slot_duration_minutes, funnel.availability_window_days ?? 14);

    const { error: updateError } = await supabase
      .from("lead_sessions")
      .update({
        ghl_connection_id: funnel.ghl_connection_id,
        ghl_contact_id: ghlContactId,
        ghl_opportunity_id: ghlOpportunityId
      })
      .eq("id", session.id);
    if (updateError) throw new Error(updateError.message);

    await updateLeadSessionStatus(session.id, "slots_shown");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      eventType: "slots_shown",
      metadata: { mode: "demo_slot_preview", slot_count: slots.length }
    });

    return {
      calendarId,
      funnel,
      ghlContactId,
      ghlOpportunityId,
      slots
    };
  }

  const { funnel, connection, config, calendarId, slotDurationMinutes, availabilityWindowDays } = await getFunnelGhlConfig(session.funnel_id);

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

    const slots = await lookupAvailability(config, calendarId, parsed.timezone, slotDurationMinutes, availabilityWindowDays);
    await updateLeadSessionStatus(session.id, "slots_shown");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
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
      eventType: "booking_error",
      metadata: { phase: "slot_lookup", message: error instanceof Error ? error.message : "Unknown booking error" }
    });
    throw error;
  }
}

export async function bookAppointment(input: unknown) {
  const parsed = bookAppointmentSchema.parse(input);
  const supabase = createServiceClient();
  const session = await getLeadSession(parsed.lead_session_id);

  if (session.status === "disqualified") {
    throw new Error("This lead is not eligible to book an appointment.");
  }

  if (isDemoSlotModeEnabled()) {
    const { data: funnel, error: funnelError } = await supabase
      .from("funnels")
      .select("*")
      .eq("id", session.funnel_id)
      .single();

    if (funnelError) throw new Error(funnelError.message);

    const ghlContactId = session.ghl_contact_id ?? createDemoGhlId("contact", session.id);
    const ghlOpportunityId = session.ghl_opportunity_id ?? createDemoGhlId("opportunity", session.id);
    const calendarId = getDemoCalendarId(funnel);

    const { data: attempt, error: attemptError } = await supabase
      .from("booking_attempts")
      .insert({
        tenant_id: session.tenant_id,
        funnel_id: session.funnel_id,
        lead_session_id: session.id,
        ghl_contact_id: ghlContactId,
        ghl_opportunity_id: ghlOpportunityId,
        ghl_calendar_id: calendarId,
        slot_start: parsed.slot_start,
        slot_end: parsed.slot_end,
        timezone: parsed.timezone,
        status: "pending",
        request_payload: { ...parsed, mode: "demo_slot_preview" }
      })
      .select("*")
      .single();

    if (attemptError) throw new Error(attemptError.message);

    const appointmentId = createDemoGhlId("appointment", attempt.id);
    const { data: updatedAttempt, error: updateAttemptError } = await supabase
      .from("booking_attempts")
      .update({
        status: "booked",
        ghl_appointment_id: appointmentId,
        response_payload: {
          mode: "demo_slot_preview",
          appointment: {
            id: appointmentId,
            calendarId,
            contactId: ghlContactId,
            startTime: parsed.slot_start,
            endTime: parsed.slot_end,
            timezone: parsed.timezone
          }
        } satisfies Json
      })
      .eq("id", attempt.id)
      .select("*")
      .single();

    if (updateAttemptError) throw new Error(updateAttemptError.message);

    const { error: sessionUpdateError } = await supabase
      .from("lead_sessions")
      .update({
        ghl_connection_id: funnel.ghl_connection_id,
        ghl_contact_id: ghlContactId,
        ghl_opportunity_id: ghlOpportunityId
      })
      .eq("id", session.id);
    if (sessionUpdateError) throw new Error(sessionUpdateError.message);

    await updateLeadSessionStatus(session.id, "booked");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      eventType: "appointment_booked",
      metadata: { mode: "demo_slot_preview", appointment_id: appointmentId, opportunity_id: ghlOpportunityId }
    });

    return updatedAttempt;
  }

  const { funnel, connection, config, calendarId } = await getFunnelGhlConfig(session.funnel_id);

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
      request_payload: parsed
    })
    .select("*")
    .single();

  if (attemptError) throw new Error(attemptError.message);

  try {
    const appointment = await bookGhlAppointment({
      config,
      calendarId,
      contactId: session.ghl_contact_id,
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

    await updateLeadSessionStatus(session.id, "booked");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      eventType: "appointment_booked",
      metadata: { appointment_id: appointmentId, opportunity_id: opportunityId }
    });

    return updatedAttempt;
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
      eventType: "booking_error",
      metadata: { phase: "appointment_create", message: error instanceof Error ? error.message : "Unknown booking error" }
    });
    throw error;
  }
}
