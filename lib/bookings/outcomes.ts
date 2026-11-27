/**
 * The shared outcome recorder for every non-GoHighLevel calendar (P1.7).
 * It runs planOutcome's steps in order, so each provider records the same
 * statuses, analytics events (with the split test), Meta booked call and CRM
 * event as the others.
 *
 * Booked is recorded once per lead: the status change is an atomic
 * conditional update, and only the request that changed it runs the
 * follow-up steps. After a booking exists at the provider, no step may turn
 * it into an error for the visitor, so each follow-up step is isolated.
 *
 * Dependencies are injectable for tests; the defaults are loaded lazily so
 * this module can be imported without a database.
 */
import { planOutcome, type OutcomeInput, type OutcomeKind } from "@/lib/bookings/outcome-plan";
import type { DispatchInput } from "@/lib/crm/dispatch";
import { isLeadStatusKept, type StatusUpdateOptions } from "@/lib/lead-sessions/status-guard";
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
  /**
   * Sets the lead status. With unlessStatusIn the update is atomic and throws
   * LeadStatusKeptError when the lead already has one of those statuses.
   */
  updateStatus: (id: string, status: LeadSession["status"], options?: StatusUpdateOptions) => Promise<LeadSession>;
  trackEvent: (input: TrackInput) => Promise<unknown>;
  onLeadStage: (key: "booked_call", session: LeadSession, funnel: Funnel) => Promise<QueuedMetaEvent | null>;
  dispatchCrmEvent: (input: DispatchInput) => void;
};

/** Statuses a later outcome must never overwrite. */
export const KEEP_STATUSES: Record<"slots_shown" | "booked", LeadSession["status"][]> = {
  slots_shown: ["booked", "disqualified"],
  booked: ["booked"]
};

export type RecordInput = OutcomeInput & { booking?: DispatchInput["booking"] };

export type RecordResult = {
  session: LeadSession;
  metaEvents: Array<QueuedMetaEvent | null>;
  /** True when the booked status could not be saved, so the caller may retry (Calendly webhook). */
  incomplete?: boolean;
};

function errorName(error: unknown) {
  return error instanceof Error ? error.name : "unknown";
}

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
    async record(kind: OutcomeKind, session: LeadSession, funnel: Funnel, input: RecordInput): Promise<RecordResult> {
      // Booked is recorded once per lead, whichever source arrives first.
      if (kind === "booked" && session.status === "booked") {
        return { session, metaEvents: [] };
      }

      const d = await getDeps();
      const booked = kind === "booked";
      let current = session;
      let statusSaved = true;
      const metaEvents: Array<QueuedMetaEvent | null> = [];

      for (const step of planOutcome(kind, input)) {
        if (step.do === "status") {
          try {
            current = await d.updateStatus(session.id, step.status, { unlessStatusIn: KEEP_STATUSES[step.status] });
          } catch (error) {
            // Another request already recorded this (booked), or the lead is past this point (slots shown).
            if (isLeadStatusKept(error)) return { session, metaEvents: [] };
            // Slot lookup keeps failing loudly; a booking that exists must still reach Meta and the CRM.
            if (!booked) throw error;
            console.error("[bookings] booked status update failed", errorName(error));
            statusSaved = false;
            current = { ...session, status: "booked" };
            continue;
          }
        } else if (step.do === "track") {
          // Without the saved status a retry records the booking again; skip analytics so it counts once.
          if (booked && !statusSaved) continue;
          const track = () =>
            d.trackEvent({
              tenantId: session.tenant_id,
              funnelId: session.funnel_id,
              leadSessionId: session.id,
              visitorId: session.visitor_id ?? undefined,
              splitTestId: session.split_test_id ?? null,
              eventType: step.eventType,
              metadata: step.metadata
            });
          if (!booked) {
            await track();
          } else {
            try {
              await track();
            } catch (error) {
              console.error("[bookings] booked analytics failed", errorName(error));
            }
          }
        } else if (step.do === "meta") {
          // Meta rows are unique per pixel and event id, so a repeat is harmless.
          try {
            metaEvents.push(await d.onLeadStage(step.key, current, funnel));
          } catch (error) {
            console.error("[bookings] booked Meta step failed", errorName(error));
          }
        } else {
          // CRM deliveries are unique per target and event id, so a repeat is harmless.
          try {
            d.dispatchCrmEvent({ type: step.type, funnel, sessionId: session.id, booking: input.booking });
          } catch (error) {
            console.error("[bookings] booked CRM step failed", errorName(error));
          }
        }
      }

      return statusSaved ? { session: current, metaEvents } : { session: current, metaEvents, incomplete: true };
    }
  };
}
