import { isValidEventRef } from "@/lib/meta/events";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import type { LeadSession } from "@/lib/types/database";

/**
 * What the browser learns about queued Meta events, and the reference used in
 * lead event ids. Pure: no Next.js or Supabase imports (type imports only).
 */

export type ClientMetaEvent = { event_name: string; event_id: string };

/**
 * Only events that are on their way to Meta are told to the browser. Held
 * events are not: the browser pixel bridge would send them at once and
 * defeat hold mode (decision M11 allows pending or held; held is left out).
 */
export function toClientEvents(rows: Array<QueuedMetaEvent | null | undefined>): ClientMetaEvent[] {
  return rows
    .filter((row): row is QueuedMetaEvent => Boolean(row) && row!.status === "pending")
    .map((row) => ({ event_name: row.eventName, event_id: row.eventId }));
}

/**
 * The reference used in a lead's event ids. Event ids reach the embedding page
 * through postMessage with target "*", so this is the opaque meta_event_ref,
 * never the session id (which authorises the public lead APIs). Null when the
 * lead has no usable reference, in which case no lead event is queued.
 */
export function leadEventRef(session: Pick<LeadSession, "id" | "meta_event_ref">): string | null {
  const ref = typeof session.meta_event_ref === "string" ? session.meta_event_ref : null;
  if (!ref || ref === session.id || !isValidEventRef(ref)) return null;
  return ref;
}
