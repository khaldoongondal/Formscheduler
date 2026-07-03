import { after, NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { submitLeadAnswers, syncLeadAnswersToGhl } from "@/lib/lead-sessions/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "lead-answers", 60);
  if (limited) return limited;

  try {
    const body = await request.json();
    const result = await submitLeadAnswers(body);
    after(async () => {
      await syncLeadAnswersToGhl(result.session.id);
    });
    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
