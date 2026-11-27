/**
 * Sends a lead event to the form's CRM after the response (decisions C5,
 * C19, C20). Never throws and never slows the visitor's request: the event
 * is built and delivered inside after().
 *
 * P3 replaces the body with the durable queue; the signature and the
 * GoHighLevel early return stay.
 */
import { after } from "next/server";
import { resolveCrm } from "@/lib/connections/resolve";
import type { CalendarKind, CrmDeliveryOutcome, CrmLeadState } from "@/lib/connections/types";
import { buildFormBookEvent } from "@/lib/crm/event-payload";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel, LeadAnswer, LeadSession, Question } from "@/lib/types/database";

export type DispatchInput = {
  type: "lead.captured" | "lead.qualified" | "lead.disqualified" | "lead.booked";
  funnel: Funnel;
  sessionId: string;
  disqualifyingOptions?: Array<{ stable_key: string; label: string; value: string }>;
  booking?: {
    provider: CalendarKind;
    start: string;
    end: string;
    timezone: string;
    externalId: string | null;
    meetingUrl: string | null;
  };
};

function shortReason(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}

async function loadLead(sessionId: string, tenantId: string): Promise<LeadSession | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

async function loadAnswers(session: LeadSession): Promise<Array<LeadAnswer & { question?: Question }>> {
  const supabase = createServiceClient();
  const [answersResult, questionsResult] = await Promise.all([
    supabase.from("lead_answers").select("*").eq("lead_session_id", session.id).eq("tenant_id", session.tenant_id),
    supabase.from("questions").select("*").eq("funnel_id", session.funnel_id).eq("tenant_id", session.tenant_id)
  ]);
  if (answersResult.error) throw new Error(answersResult.error.message);
  if (questionsResult.error) throw new Error(questionsResult.error.message);
  const questions = questionsResult.data ?? [];
  return (answersResult.data ?? []).map((answer) => ({
    ...answer,
    question: questions.find((question) => question.id === answer.question_id)
  }));
}

export function leadStateOf(session: LeadSession): CrmLeadState {
  return {
    crmContactId: session.crm_contact_id ?? null,
    crmDealId: session.crm_deal_id ?? null,
    ghlContactId: session.ghl_contact_id,
    ghlOpportunityId: session.ghl_opportunity_id
  };
}

/** Writes only the given ids, filtered by lead and tenant. */
export async function applyCrmUpdates(
  sessionId: string,
  tenantId: string,
  updates: CrmDeliveryOutcome["updates"],
  ghlConnectionId?: string | null
): Promise<void> {
  if (!updates) return;
  const patch: Record<string, string> = {};
  if (updates.crmContactId) patch.crm_contact_id = updates.crmContactId.slice(0, 200);
  if (updates.crmDealId) patch.crm_deal_id = updates.crmDealId.slice(0, 200);
  if (updates.ghlContactId) patch.ghl_contact_id = updates.ghlContactId;
  if (updates.ghlOpportunityId) patch.ghl_opportunity_id = updates.ghlOpportunityId;
  if (!Object.keys(patch).length) return;
  if (ghlConnectionId && (updates.ghlContactId || updates.ghlOpportunityId)) patch.ghl_connection_id = ghlConnectionId;
  const supabase = createServiceClient();
  const { error } = await supabase.from("lead_sessions").update(patch).eq("id", sessionId).eq("tenant_id", tenantId);
  if (error) throw new Error(error.message);
}

async function deliverNow(input: DispatchInput) {
  const resolved = await resolveCrm(input.funnel);
  if (!resolved) return;
  const session = await loadLead(input.sessionId, input.funnel.tenant_id);
  if (!session) return;
  const answers = await loadAnswers(session);
  const event = buildFormBookEvent({
    type: input.type,
    nowIso: new Date().toISOString(),
    funnel: input.funnel,
    session,
    answers,
    booking: input.booking
      ? {
          provider: input.booking.provider,
          start: input.booking.start,
          end: input.booking.end,
          timezone: input.booking.timezone,
          booking_id: input.booking.externalId,
          meeting_url: input.booking.meetingUrl
        }
      : null,
    disqualifyingOptions: input.disqualifyingOptions
  });
  const outcome = await resolved.provider.deliver(resolved.ctx, event, leadStateOf(session));
  if (outcome.outcome !== "sent") {
    console.error("[crm] delivery not sent", resolved.kind, outcome.outcome, outcome.httpStatus ?? "no status");
  }
  await applyCrmUpdates(session.id, session.tenant_id, outcome.updates, resolved.ghlConnectionId);
}

/** Never throws, returns at once. A GoHighLevel calendar keeps its own inline path. */
export function dispatchCrmEvent(input: DispatchInput): void {
  try {
    if ((input.funnel.calendar_provider ?? "ghl") === "ghl") return;
    after(async () => {
      try {
        await deliverNow(input);
      } catch (error) {
        console.error("[crm] delivery failed", input.funnel.crm_provider ?? "ghl", shortReason(error));
      }
    });
  } catch (error) {
    console.error("[crm] could not schedule delivery", input.funnel.crm_provider ?? "ghl", shortReason(error));
  }
}
