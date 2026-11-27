import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { confirmCalendlyFromClient } from "@/lib/bookings/calendly-confirm";
import { scheduleMetaDrain, toClientEvents } from "@/lib/meta/hooks";
import { enforceRateLimit } from "@/lib/security/rate-limit";

/** Fast path: the Calendly widget reported a booking; FormBook checks it with Calendly before recording it. */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "booking-confirm");
  if (limited) return limited;

  try {
    const body = await request.json();
    const { metaEvents } = await confirmCalendlyFromClient(body);
    scheduleMetaDrain(metaEvents);
    return ok({ ok: true, meta_events: toClientEvents(metaEvents) });
  } catch (error) {
    return failPublic(error);
  }
}
