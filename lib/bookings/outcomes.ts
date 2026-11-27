/**
 * The shared outcome recorder for every non-GoHighLevel calendar (P1.7).
 * It runs planOutcome's steps in order, so each provider records the same
 * statuses, analytics events (with the split test), Meta booked call and CRM
 * event as the others.
 *
 * Dependencies are injectable for tests; the defaults are loaded lazily so
 * this module can be imported without a database.
 */
import { planOutcome, type OutcomeInput, type OutcomeKind } from "@/lib/bookings/outcome-plan";
import type { DispatchInput } from "@/lib/crm/dispatch";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import type { Funnel, Json, LeadSession } from "@/lib/types/database";

type TrackInput = {
  tenantId: string;
  funnelId?: string;
  leadSessionId?: string;
  visitorId?: string;
  eventType: "slots_shown" | "appointment_booked" | "booking_error";
  metadata?: Json;
  splitTestId?: string | null;
};

export type OutcomeDeps = {
  updateStatus: (id: string, status: LeadSession["status"]) => Promise<LeadSession>;
  trackEvent: (input: TrackInput) => Promise<unknown>;
  onLeadStage: (key: "booked_call", session: LeadSession, funnel: Funnel) => Promise<QueuedMetaEvent | null>;
  dispatchCrmEvent: (input: DispatchInput) => void;
};

export type RecordInput = OutcomeInput & { booking?: DispatchInput["booking"] };

async function loadDefaultDeps(): Promise<OutcomeDeps> {
  const [{ updateLeadSessionStatus }, { trackEvent }, { onLeadStage }, { dispatchCrmEvent }] = await Promise.all([
    import("@/lib/lead-sessions/service"),
    import("@/lib/analytics/service"),
    import("@/lib/meta/hooks"),
    import("@/lib/crm/dispatch")
  ]);
  return {
    updateStatus: updateLeadSessionStatus,
    trackEvent,
    onLeadStage: (key, session, funnel) => onLeadStage(key, session, funnel),
    dispatchCrmEvent
  };
}

export function createOutcomeRecorder(deps?: OutcomeDeps) {
  let resolved: OutcomeDeps | null = deps ?? null;

  async function getDeps() {
    if (!resolved) resolved = await loadDefaultDeps();
    return resolved;
  }

  return {
    async record(
      kind: OutcomeKind,
      session: LeadSession,
      funnel: Funnel,
      input: RecordInput
    ): Promise<{ session: LeadSession; metaEvents: Array<QueuedMetaEvent | null> }> {
      // Booked is recorded once per lead, whichever source arrives first.
      if (kind === "booked" && session.status === "booked") {
        return { session, metaEvents: [] };
      }

      const d = await getDeps();
      let current = session;
      const metaEvents: Array<QueuedMetaEvent | null> = [];

      for (const step of planOutcome(kind, input)) {
        if (step.do === "status") {
          current = await d.updateStatus(session.id, step.status);
        } else if (step.do === "track") {
          await d.trackEvent({
            tenantId: session.tenant_id,
            funnelId: session.funnel_id,
            leadSessionId: session.id,
            visitorId: session.visitor_id ?? undefined,
            splitTestId: session.split_test_id ?? null,
            eventType: step.eventType,
            metadata: step.metadata
          });
        } else if (step.do === "meta") {
          metaEvents.push(await d.onLeadStage(step.key, current, funnel));
        } else {
          d.dispatchCrmEvent({ type: step.type, funnel, sessionId: session.id, booking: input.booking });
        }
      }

      return { session: current, metaEvents };
    }
  };
}
