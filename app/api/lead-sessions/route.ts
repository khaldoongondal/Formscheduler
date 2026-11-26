import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { startLeadSession } from "@/lib/lead-sessions/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "lead-sessions");
  if (limited) return limited;

  try {
    const body = await request.json();
    const session = await startLeadSession(body, request);
    return ok({ session }, 201);
  } catch (error) {
    return failPublic(error);
  }
}
