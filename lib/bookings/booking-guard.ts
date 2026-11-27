/**
 * Booking guards for the slots path (Google Calendar, Cal.com) and the
 * public booking response. Pure: no Next.js, Supabase or I/O imports.
 */
import type { BookingAttempt } from "@/lib/types/database";

export const ALREADY_BOOKED_MESSAGE = "You already have a time booked. There is nothing more to do here.";
export const BOOKING_IN_PROGRESS_MESSAGE = "Your booking is already being saved. Please wait a moment.";

/** The only booking fields a visitor's browser receives. Provider ids and the connection id stay on the server. */
export type PublicAttempt = Pick<BookingAttempt, "id" | "status" | "slot_start" | "slot_end" | "timezone">;

export function publicAttempt(attempt: BookingAttempt | null | undefined): PublicAttempt | null {
  if (!attempt) return null;
  return {
    id: attempt.id,
    status: attempt.status,
    slot_start: attempt.slot_start,
    slot_end: attempt.slot_end,
    timezone: attempt.timezone
  };
}

export type HoldRow = Pick<BookingAttempt, "id" | "lead_session_id" | "calendar_connection_id" | "slot_start" | "slot_end" | "status">;

export type HoldConflict = "already_booked" | "in_progress" | "slot_taken" | null;

function timeOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Insert-then-check: every request inserts its pending hold first, then
 * yields when any other live hold conflicts with it. Under read committed
 * at least one of two racing requests sees the other, so two conflicting
 * bookings never both proceed (both may yield, which is the safe side).
 *
 * A conflict is another pending or booked hold for the same lead, or one on
 * the same calendar connection whose time overlaps this one widened by the
 * calendar's buffers.
 */
export function holdConflict(
  self: HoldRow,
  others: HoldRow[],
  padding: { beforeMs: number; afterMs: number } = { beforeMs: 0, afterMs: 0 }
): HoldConflict {
  const start = timeOf(self.slot_start);
  const end = timeOf(self.slot_end);
  let result: HoldConflict = null;
  for (const other of others) {
    if (other.id === self.id || (other.status !== "pending" && other.status !== "booked")) continue;
    if (self.lead_session_id && other.lead_session_id === self.lead_session_id) {
      if (other.status === "booked") return "already_booked";
      result = "in_progress";
      continue;
    }
    if (!self.calendar_connection_id || other.calendar_connection_id !== self.calendar_connection_id) continue;
    const otherStart = timeOf(other.slot_start);
    const otherEnd = timeOf(other.slot_end);
    if (start === null || end === null || otherStart === null || otherEnd === null) continue;
    if (otherStart < end + padding.afterMs && otherEnd > start - padding.beforeMs) {
      result = result ?? "slot_taken";
    }
  }
  return result;
}
