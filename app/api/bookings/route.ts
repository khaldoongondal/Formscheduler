import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { bookAppointment } from "@/lib/bookings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "bookings");
  if (limited) return limited;

  try {
    const body = await request.json();
    const attempt = await bookAppointment(body);
    return ok({ attempt }, 201);
  } catch (error) {
    return failPublic(error);
  }
}
