import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/responses";
import { abandonLeadSession } from "@/lib/lead-sessions/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

const abandonSchema = z.object({
  lead_session_id: z.string().uuid()
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "lead-abandon", 20);
  if (limited) return limited;

  try {
    const parsed = abandonSchema.parse(await request.json());
    const session = await abandonLeadSession(parsed.lead_session_id);
    return ok({ session });
  } catch (error) {
    return fail(error);
  }
}
