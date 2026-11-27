/**
 * Sends a lead event to the form's CRM after the response (decisions C5,
 * C19, C20). Never throws and never slows the visitor's request: inside
 * after() the event is built, queued in crm_event_deliveries (the durable
 * queue and the tenant's delivery log), then delivered at once when it can
 * go now. The CRM cron delivers anything left.
 */
import { after } from "next/server";
import { crmKindOf } from "@/lib/connections/resolve";
import type { CalendarKind } from "@/lib/connections/types";
import { drainCrmDeliveriesByIds } from "@/lib/crm/drain";
import { buildFormBookEvent } from "@/lib/crm/event-payload";
import { enqueueCrmEvent } from "@/lib/crm/queue";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel, LeadAnswer, LeadSession, Question } from "@/lib/types/database";

export { applyCrmUpdates, leadStateOf } from "@/lib/crm/drain";

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

/** The form's CRM target from its row alone (no decryption). Null: nothing to queue. */
export function crmTargetOf(
  funnel: Pick<Funnel, "crm_provider" | "crm_connection_id" | "ghl_connection_id">
): { provider: "ghl" | "hubspot" | "webhook"; connectionId: string | null; ghlConnectionId: string | null } | null {
  const provider = crmKindOf(funnel);
  if (provider === "ghl") return funnel.ghl_connection_id ? { provider, connectionId: null, ghlConnectionId: funnel.ghl_connection_id } : null;
  return funnel.crm_connection_id ? { provider, connectionId: funnel.crm_connection_id, ghlConnectionId: null } : null;
}

async function queueAndDeliver(input: DispatchInput) {
  const target = crmTargetOf(input.funnel);
  if (!target) return;
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
  const id = await enqueueCrmEvent({
    tenantId: session.tenant_id,
    provider: target.provider,
    connectionId: target.connectionId,
    ghlConnectionId: target.ghlConnectionId,
    funnelId: input.funnel.id,
    leadSessionId: session.id,
    event
  });
  if (id) await drainCrmDeliveriesByIds([id]);
}

/** Never throws, returns at once. A GoHighLevel calendar keeps its own inline path. */
export function dispatchCrmEvent(input: DispatchInput): void {
  try {
    if ((input.funnel.calendar_provider ?? "ghl") === "ghl") return;
    after(async () => {
      try {
        await queueAndDeliver(input);
      } catch (error) {
        console.error("[crm] queue failed", input.funnel.crm_provider ?? "ghl", shortReason(error));
      }
    });
  } catch (error) {
    console.error("[crm] could not schedule delivery", input.funnel.crm_provider ?? "ghl", shortReason(error));
  }
}
