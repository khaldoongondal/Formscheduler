/**
 * Google Calendar API calls (P2.6). Base URL is a constant; tokens travel
 * only in the Authorization header.
 */
import { ProviderHttpError, providerRequest } from "@/lib/connections/http";
import { SlotTakenError, type BookingResult } from "@/lib/connections/types";
import type { BusyInterval } from "@/lib/google/availability";
import {
  GOOGLE_CALENDAR_API_BASE,
  eventFormbookRef,
  googleEventPath,
  parseFreeBusy,
  parseGoogleEvent
} from "@/lib/google/event-mapping";

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function queryFreeBusy(
  token: string,
  input: { timeMinIso: string; timeMaxIso: string; calendarId: string }
): Promise<BusyInterval[]> {
  const { body } = await providerRequest({
    provider: "google",
    url: `${GOOGLE_CALENDAR_API_BASE}/freeBusy`,
    method: "POST",
    headers: auth(token),
    json: { timeMin: input.timeMinIso, timeMax: input.timeMaxIso, items: [{ id: input.calendarId }] }
  });
  return parseFreeBusy(body, input.calendarId);
}

export async function getEvent(token: string, calendarId: string, eventId: string): Promise<unknown> {
  const { body } = await providerRequest({
    provider: "google",
    url: `${GOOGLE_CALENDAR_API_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    headers: auth(token)
  });
  return body;
}

/**
 * Creates the event. The event id derives from the booking attempt, so a
 * retried insert returns 409; the existing event is used when it is ours,
 * otherwise the time counts as taken (U4).
 */
export async function insertEvent(
  token: string,
  calendarId: string,
  body: Record<string, unknown> & { id: string },
  meet: boolean,
  expectedRef: string,
  fallback: { slotStart: string; slotEnd: string }
): Promise<BookingResult> {
  let response: unknown;
  try {
    ({ body: response } = await providerRequest({
      provider: "google",
      url: `${GOOGLE_CALENDAR_API_BASE}${googleEventPath(calendarId, meet)}`,
      method: "POST",
      headers: auth(token),
      json: body
    }));
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 409) {
      const existing = await getEvent(token, calendarId, body.id);
      if (eventFormbookRef(existing) === expectedRef) {
        const parsed = parseGoogleEvent(existing, fallback);
        if (parsed) return parsed;
      }
      throw new SlotTakenError();
    }
    throw error;
  }
  const parsed = parseGoogleEvent(response, fallback);
  if (!parsed) throw new Error("google_event_invalid_response");
  return parsed;
}
