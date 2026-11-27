import { trackEvent } from "@/lib/analytics/service";
import { PublicError } from "@/lib/api/responses";
import { assertFunnelServesPublic } from "@/lib/funnels/public-gate";
import { createDemoGhlId, createDemoSlots, getDemoCalendarId, isDemoSlotModeEnabled } from "@/lib/demo/slots";
import { genericBookAppointment, genericGetAvailableSlots } from "@/lib/bookings/generic-path";
import { ghlBookAppointment, ghlGetAvailableSlots } from "@/lib/bookings/ghl-path";
import type { CalendarKind, EmbedSpec } from "@/lib/connections/types";
import { getLeadSession, updateLeadSessionStatus } from "@/lib/lead-sessions/service";
import { createServiceClient } from "@/lib/supabase/server";
import { onLeadStage } from "@/lib/meta/hooks";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import type { BookingAttempt, Json } from "@/lib/types/database";
import { bookAppointmentSchema, slotLookupSchema } from "@/lib/validation/bookings";

/** Optional calendar mode in the slots response. GoHighLevel responses leave it out. */
export type SlotsCalendarMode = { mode: "slots" } | EmbedSpec;

export async function getAvailableSlots(input: unknown) {
  const parsed = slotLookupSchema.parse(input);
  const supabase = createServiceClient();
  const session = await getLeadSession(parsed.lead_session_id);

  if (session.status === "disqualified") {
    throw new PublicError("This lead is not eligible to view calendar availability.");
  }

  const publicFunnel = await assertFunnelServesPublic(session.funnel_id);

  if (isDemoSlotModeEnabled()) {
    const funnel = publicFunnel;

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
      splitTestId: session.split_test_id ?? null,
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

  const kind = (publicFunnel.calendar_provider ?? "ghl") as CalendarKind;
  if (kind === "ghl") return ghlGetAvailableSlots(session, publicFunnel, parsed);
  return genericGetAvailableSlots(session, publicFunnel, parsed);
}

export async function bookAppointment(
  input: unknown
): Promise<{ attempt: BookingAttempt; metaEvents: Array<QueuedMetaEvent | null> }> {
  const parsed = bookAppointmentSchema.parse(input);
  const supabase = createServiceClient();
  const session = await getLeadSession(parsed.lead_session_id);

  if (session.status === "disqualified") {
    throw new PublicError("This lead is not eligible to book an appointment.");
  }

  const publicFunnel = await assertFunnelServesPublic(session.funnel_id);

  if (isDemoSlotModeEnabled()) {
    const funnel = publicFunnel;

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

    const bookedSession = await updateLeadSessionStatus(session.id, "booked");
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "appointment_booked",
      metadata: { mode: "demo_slot_preview", appointment_id: appointmentId, opportunity_id: ghlOpportunityId }
    });

    // Meta booked call. Never throws.
    const bookedEvent = await onLeadStage("booked_call", bookedSession, publicFunnel);
    return { attempt: updatedAttempt, metaEvents: [bookedEvent] };
  }

  const kind = (publicFunnel.calendar_provider ?? "ghl") as CalendarKind;
  if (kind === "ghl") return ghlBookAppointment(session, publicFunnel, parsed);
  return genericBookAppointment(session, publicFunnel, parsed);
}
