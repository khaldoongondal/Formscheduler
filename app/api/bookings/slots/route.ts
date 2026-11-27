import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { getAvailableSlots } from "@/lib/bookings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "booking-slots");
  if (limited) return limited;

  try {
    const body = await request.json();
    const result = await getAvailableSlots(body);
    // Only non-GoHighLevel calendars add `calendar`; GoHighLevel responses are unchanged.
    const calendar = "calendar" in result ? result.calendar : undefined;
    return ok({ slots: result.slots, ...(calendar ? { calendar } : {}) });
  } catch (error) {
    return failPublic(error);
  }
}
