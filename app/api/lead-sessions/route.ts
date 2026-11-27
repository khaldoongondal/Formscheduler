import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { startLeadSession } from "@/lib/lead-sessions/service";
import { scheduleMetaDrain, toClientEvents } from "@/lib/meta/hooks";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "lead-sessions");
  if (limited) return limited;

  try {
    const body = await request.json();
    const { session, metaEvents } = await startLeadSession(body, request);
    scheduleMetaDrain(metaEvents);
    // The visitor's IP address stays on the server.
    const { ip_address: _ip, ...publicSession } = session;
    void _ip;
    return ok({ session: publicSession, meta_events: toClientEvents(metaEvents) }, 201);
  } catch (error) {
    return failPublic(error);
  }
}
