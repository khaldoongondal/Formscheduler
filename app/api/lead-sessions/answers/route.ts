import { after, NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { toPublicSession } from "@/lib/lead-sessions/public";
import { submitLeadAnswers, syncLeadAnswersToGhl } from "@/lib/lead-sessions/service";
import { scheduleMetaDrain, toClientEvents } from "@/lib/meta/hooks";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "lead-answers");
  if (limited) return limited;

  try {
    const body = await request.json();
    const { metaEvents, ...result } = await submitLeadAnswers(body);
    after(async () => {
      await syncLeadAnswersToGhl(result.session.id);
    });
    scheduleMetaDrain(metaEvents);
    return ok({ ...result, session: toPublicSession(result.session), meta_events: toClientEvents(metaEvents) });
  } catch (error) {
    return failPublic(error);
  }
}
