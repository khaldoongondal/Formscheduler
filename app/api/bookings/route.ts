import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { bookAppointment } from "@/lib/bookings/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "bookings", 5);
  if (limited) return limited;

  try {
    const body = await request.json();
    const attempt = await bookAppointment(body);
    return ok({ attempt }, 201);
  } catch (error) {
    return fail(error);
  }
}
