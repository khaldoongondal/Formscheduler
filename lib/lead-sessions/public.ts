import type { LeadSession } from "@/lib/types/database";

/**
 * What the public lead routes may return about a lead session.
 * Pure: no Next.js or Supabase imports.
 *
 * Server-only columns never leave the server: the visitor's IP address (sent
 * only to Meta), the consent answer, who released the lead's held Meta events
 * and when (a staff email), and the opaque Meta event reference.
 */
export const SERVER_ONLY_SESSION_FIELDS = [
  "ip_address",
  "meta_consent",
  "meta_released_at",
  "meta_released_by",
  "meta_event_ref"
] as const;

type ServerOnlyField = (typeof SERVER_ONLY_SESSION_FIELDS)[number];

export type PublicLeadSession = Omit<LeadSession, ServerOnlyField>;

export function toPublicSession(session: LeadSession): PublicLeadSession {
  const copy: Record<string, unknown> = { ...session };
  for (const field of SERVER_ONLY_SESSION_FIELDS) delete copy[field];
  return copy as PublicLeadSession;
}

/**
 * The abandon route is called with sendBeacon and its body is never read, so
 * it returns only the id and status, never contact details.
 */
export function toAbandonResponse(session: Pick<LeadSession, "id" | "status">): { id: string; status: string } {
  return { id: session.id, status: session.status };
}
