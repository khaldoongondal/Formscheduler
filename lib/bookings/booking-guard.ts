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

export type HoldRow = Pick<BookingAttempt, "id" | "lead_session_id" | "calendar_connection_id" | "slot_start" | "slot_end" | "status"> & {
  updated_at?: string | null;
};

/**
 * How long another lead's booked row still holds its time on the connection.
 * Cancellations on Google and Cal.com are not tracked (decision C27), so a
 * booked row is never a permanent hold: after this window the provider's own
 * check (Google free/busy before the insert, Cal.com's slot error) decides.
 * The window only covers the short lag before a new event shows as busy.
 */
export const BOOKED_HOLD_MS = 180_000;

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
 * calendar's buffers. On the connection, another lead's booked row counts
 * only while it was booked within BOOKED_HOLD_MS.
 */
export function holdConflict(
  self: HoldRow,
  others: HoldRow[],
  padding: { beforeMs: number; afterMs: number } = { beforeMs: 0, afterMs: 0 },
  nowMs: number = Date.now()
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
    if (other.status === "booked" && !isRecentBooking(other, nowMs)) continue;
    const otherStart = timeOf(other.slot_start);
    const otherEnd = timeOf(other.slot_end);
    if (start === null || end === null || otherStart === null || otherEnd === null) continue;
    if (otherStart < end + padding.afterMs && otherEnd > start - padding.beforeMs) {
      result = result ?? "slot_taken";
    }
  }
  return result;
}

/** True while a booked row is young enough to still hold its time (see BOOKED_HOLD_MS). */
export function isRecentBooking(row: Pick<HoldRow, "updated_at">, nowMs: number): boolean {
  const at = timeOf(row.updated_at);
  return at !== null && at >= nowMs - BOOKED_HOLD_MS;
}

/** The updated_at cut-off for booked rows that still hold their time. */
export function bookedHoldSince(nowMs: number): string {
  return new Date(nowMs - BOOKED_HOLD_MS).toISOString();
}
