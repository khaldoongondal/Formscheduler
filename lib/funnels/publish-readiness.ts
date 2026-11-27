/** Pure checks that a form can take bookings before it goes Active. */

export const PUBLISH_NEEDS_CONNECTION_MESSAGE =
  "Connect this form to GoHighLevel before activating it. Pick a connection under Settings, or add one in GoHighLevel connections first.";
export const PUBLISH_NEEDS_CALENDAR_MESSAGE =
  "Choose a GoHighLevel calendar for this form (or set a default calendar on its connection) before activating it.";

export type PublishReadinessInput = {
  ghlConnectionId: string | null | undefined;
  /** The form's own calendar. */
  calendarId: string | null | undefined;
  /** The connection's default calendar, used when the form has none (see lib/ghl/funnel-config). */
  connectionCalendarId: string | null | undefined;
};

/** Returns the message to show when the form cannot take bookings, or null when it can. */
export function publishReadinessError(input: PublishReadinessInput): string | null {
  if (!input.ghlConnectionId?.trim()) return PUBLISH_NEEDS_CONNECTION_MESSAGE;
  if (!input.calendarId?.trim() && !input.connectionCalendarId?.trim()) return PUBLISH_NEEDS_CALENDAR_MESSAGE;
  return null;
}
