import { NextRequest } from "next/server";
import { z } from "zod";
import { failPublic, ok } from "@/lib/api/responses";
import { toAbandonResponse } from "@/lib/lead-sessions/public";
import { abandonLeadSession } from "@/lib/lead-sessions/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const abandonSchema = z.object({
  lead_session_id: z.string().uuid()
});

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "lead-abandon");
  if (limited) return limited;

  try {
    const parsed = abandonSchema.parse(await request.json());
    const session = await abandonLeadSession(parsed.lead_session_id);
    return ok({ session: toAbandonResponse(session) });
  } catch (error) {
    return failPublic(error);
  }
}
