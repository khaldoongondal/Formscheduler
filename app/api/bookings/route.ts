import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { publicAttempt } from "@/lib/bookings/booking-guard";
import { bookAppointment } from "@/lib/bookings/service";
import { scheduleMetaDrain, toClientEvents } from "@/lib/meta/hooks";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "bookings");
  if (limited) return limited;

  try {
    const body = await request.json();
    const { attempt, metaEvents } = await bookAppointment(body);
    scheduleMetaDrain(metaEvents);
    // Only an allow-list of booking fields: provider ids and the connection id stay on the server.
    return ok({ attempt: publicAttempt(attempt), meta_events: toClientEvents(metaEvents) }, 201);
  } catch (error) {
    return failPublic(error);
  }
}
