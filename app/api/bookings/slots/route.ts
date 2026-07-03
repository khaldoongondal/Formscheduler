import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { getAvailableSlots } from "@/lib/bookings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "booking-slots", 30);
  if (limited) return limited;

  try {
    const body = await request.json();
    const result = await getAvailableSlots(body);
    return ok({ slots: result.slots });
  } catch (error) {
    return fail(error);
  }
}
