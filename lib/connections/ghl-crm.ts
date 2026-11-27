/**
 * GoHighLevel as a CrmProvider, for forms that book into another calendar
 * (decision C3). It uses the same lib/ghl/service.ts helpers as the
 * GoHighLevel path, so contacts, attribution fields, opportunities and notes
 * look the same.
 */
import { createContactNote, type GhlRuntimeConfig } from "@/lib/ghl/client";
import {
  createLeadAnswersContactNote,
  ensureGhlOpportunity,
  updateLeadContactAnswers,
  upsertLeadContact
} from "@/lib/ghl/service";
import { answersFromEvent, capSummary, classifyGhlError, sessionLikeFromEvent } from "@/lib/connections/crm-outcome";
import { providerLabel } from "@/lib/connections/registry";
import type { CrmDeliveryOutcome, CrmLeadState, CrmProvider, FormBookEvent } from "@/lib/connections/types";
import type { Funnel, LeadSession, Question } from "@/lib/types/database";

export type GhlCrmCtx = { config: GhlRuntimeConfig; funnel: Funnel; connectionId: string; questions: Question[] };

type Stage = "opt_in" | "booked" | "disqualified";

function hasPipeline(funnel: Funnel, stage: Stage) {
  const ids = {
    opt_in: [funnel.opt_in_pipeline_id, funnel.opt_in_pipeline_stage_id],
    booked: [funnel.booked_pipeline_id, funnel.booked_pipeline_stage_id],
    disqualified: [funnel.disqualified_pipeline_id, funnel.disqualified_pipeline_stage_id]
  }[stage];
  return Boolean(ids[0]?.trim() && ids[1]?.trim());
}

function formatInZone(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function ensureContact(ctx: GhlCrmCtx, session: LeadSession, updates: NonNullable<CrmDeliveryOutcome["updates"]>) {
  if (session.ghl_contact_id) return session.ghl_contact_id;
  const contact = await upsertLeadContact(ctx.config, session, []);
  const contactId = contact.contact.id;
  updates.ghlContactId = contactId;
  session.ghl_contact_id = contactId;
  return contactId;
}

async function moveOpportunity(
  ctx: GhlCrmCtx,
  session: LeadSession,
  contactId: string,
  stage: Stage,
  updates: NonNullable<CrmDeliveryOutcome["updates"]>
) {
  if (!hasPipeline(ctx.funnel, stage)) return false;
  const opportunityId = await ensureGhlOpportunity({
    config: ctx.config,
    funnel: ctx.funnel,
    leadSession: session,
    contactId,
    stage
  });
  updates.ghlOpportunityId = opportunityId;
  session.ghl_opportunity_id = opportunityId;
  return true;
}

async function deliverEvent(ctx: GhlCrmCtx, event: FormBookEvent, lead: CrmLeadState): Promise<CrmDeliveryOutcome> {
  const session = sessionLikeFromEvent(event, lead, ctx.funnel.tenant_id);
  const updates: NonNullable<CrmDeliveryOutcome["updates"]> = {};

  if (event.type === "test.ping") {
    return { outcome: "sent", httpStatus: null, summary: "Test events are not sent to GoHighLevel." };
  }

  if (event.type === "lead.captured") {
    // Always a fresh upsert at capture, like the GoHighLevel path.
    const contact = await upsertLeadContact(ctx.config, session, []);
    const contactId = contact.contact.id;
    updates.ghlContactId = contactId;
    session.ghl_contact_id = contactId;
    const moved = await moveOpportunity(ctx, session, contactId, "opt_in", updates);
    return {
      outcome: "sent",
      httpStatus: 200,
      summary: moved ? "Contact and opportunity saved." : "Contact saved. No pipeline is set for new leads.",
      updates
    };
  }

  const contactId = await ensureContact(ctx, session, updates);

  if (event.type === "lead.qualified") {
    const answers = answersFromEvent(event, ctx.questions, ctx.funnel.tenant_id);
    await updateLeadContactAnswers(ctx.config, session, contactId, answers);
    await createLeadAnswersContactNote(ctx.config, session, contactId, answers);
    return { outcome: "sent", httpStatus: 200, summary: "Contact answers and note saved.", updates };
  }

  if (event.type === "lead.disqualified") {
    const moved = await moveOpportunity(ctx, session, contactId, "disqualified", updates);
    return {
      outcome: "sent",
      httpStatus: 200,
      summary: moved ? "Opportunity moved to the disqualified stage." : "Contact saved. No disqualified pipeline is set.",
      updates
    };
  }

  // lead.booked
  const moved = await moveOpportunity(ctx, session, contactId, "booked", updates);
  const booking = event.booking;
  if (booking) {
    const body = [
      "FormBook booking",
      `Calendar: ${providerLabel(booking.provider)}`,
      `Start: ${booking.start}`,
      `Start (${booking.timezone}): ${formatInZone(booking.start, booking.timezone)}`,
      booking.meeting_url ? `Meeting link: ${booking.meeting_url}` : null
    ]
      .filter((line): line is string => line !== null)
      .join("\n");
    await createContactNote(ctx.config, {
      contactId,
      title: "FormBook booking",
      body,
      color: "#4f9a78",
      pinned: false
    });
  }
  return {
    outcome: "sent",
    httpStatus: 200,
    summary: moved ? "Opportunity moved to the booked stage and a booking note added." : "Booking note added. No booked pipeline is set.",
    updates
  };
}

export const ghlCrmProvider: CrmProvider<GhlCrmCtx> = {
  kind: "ghl",
  async deliver(ctx, event, lead) {
    try {
      return await deliverEvent(ctx, event, lead);
    } catch (error) {
      const outcome = classifyGhlError(error);
      return { ...outcome, summary: capSummary(outcome.summary) };
    }
  }
};
