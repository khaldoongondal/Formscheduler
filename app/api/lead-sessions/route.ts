import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { startLeadSession } from "@/lib/lead-sessions/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "lead-sessions", 10);
  if (limited) return limited;

  try {
    const body = await request.json();
    const session = await startLeadSession(body, request);
    return ok({ session }, 201);
  } catch (error) {
    return fail(error);
  }
}
