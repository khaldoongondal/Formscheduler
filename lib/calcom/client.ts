/**
 * Cal.com v2 API calls (P2.7). The key travels only in the Authorization header.
 */
import { CALCOM_API_BASE, CALCOM_API_VERSIONS } from "@/lib/calcom/constants";
import {
  parseCalcomBooking,
  parseCalcomEventTypes,
  parseCalcomMe,
  type CalcomBooking,
  type CalcomEventType
} from "@/lib/calcom/mapping";
import { providerRequest } from "@/lib/connections/http";

function headers(key: string, version?: string) {
  return { Authorization: `Bearer ${key}`, ...(version ? { "cal-api-version": version } : {}) };
}

/** U9: GET /v2/me returns the key owner's id and username. */
export async function getMe(key: string): Promise<{ id: number; username: string }> {
  const { body } = await providerRequest({ provider: "calcom", url: `${CALCOM_API_BASE}/v2/me`, headers: headers(key) });
  const me = parseCalcomMe(body);
  if (!me) throw new Error("calcom_me_invalid_response");
  return me;
}

export async function listEventTypes(key: string, username: string): Promise<CalcomEventType[]> {
  const url = new URL(`${CALCOM_API_BASE}/v2/event-types`);
  url.searchParams.set("username", username);
  const { body } = await providerRequest({
    provider: "calcom",
    url: url.toString(),
    headers: headers(key, CALCOM_API_VERSIONS.eventTypes)
  });
  return parseCalcomEventTypes(body);
}

export async function getSlots(
  key: string,
  input: { eventTypeId: number; startIso: string; endIso: string; timeZone: string }
): Promise<unknown> {
  const url = new URL(`${CALCOM_API_BASE}/v2/slots`);
  url.searchParams.set("eventTypeId", String(input.eventTypeId));
  url.searchParams.set("start", input.startIso);
  url.searchParams.set("end", input.endIso);
  url.searchParams.set("timeZone", input.timeZone);
  url.searchParams.set("format", "range");
  const { body } = await providerRequest({ provider: "calcom", url: url.toString(), headers: headers(key, CALCOM_API_VERSIONS.slots) });
  return body;
}

export async function createBooking(key: string, body: Record<string, unknown>): Promise<CalcomBooking> {
  const { body: response } = await providerRequest({
    provider: "calcom",
    url: `${CALCOM_API_BASE}/v2/bookings`,
    method: "POST",
    headers: headers(key, CALCOM_API_VERSIONS.bookings),
    json: body
  });
  const booking = parseCalcomBooking(response);
  if (!booking) throw new Error("calcom_booking_invalid_response");
  return booking;
}
