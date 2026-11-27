/**
 * GoHighLevel as a CalendarProvider (decision C4). It delegates to the
 * existing lib/ghl/service.ts functions, so requests, order and results stay
 * exactly as before.
 */
import type { GhlRuntimeConfig } from "@/lib/ghl/client";
import { bookGhlAppointment, lookupAvailability } from "@/lib/ghl/service";
import type { CalendarProvider } from "@/lib/connections/types";

export type GhlCalendarCtx = {
  config: GhlRuntimeConfig;
  calendarId: string;
  slotDurationMinutes: number;
  availabilityWindowDays: number;
};

export const ghlCalendarProvider: CalendarProvider<GhlCalendarCtx> = {
  kind: "ghl",
  mode: "slots",
  listSlots: (ctx, req) =>
    lookupAvailability(ctx.config, ctx.calendarId, req.timezone, ctx.slotDurationMinutes, ctx.availabilityWindowDays),
  // Not reachable in V1: a GoHighLevel calendar always runs the GoHighLevel path,
  // which books with the lead's contact through bookWithContact.
  book: async () => {
    throw new Error("GoHighLevel booking needs a contact.");
  }
};

export function bookWithContact(
  ctx: GhlCalendarCtx,
  contactId: string,
  req: { slotStart: string; slotEnd: string; timezone: string; title?: string }
) {
  return bookGhlAppointment({
    config: ctx.config,
    calendarId: ctx.calendarId,
    contactId,
    slotStart: req.slotStart,
    slotEnd: req.slotEnd,
    timezone: req.timezone,
    title: req.title
  });
}
