import { NextRequest } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { normalizeSlug } from "@/lib/funnels/slugs";
import { enforceDailyCap, enforceRateLimit, getHashedClientIp } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { formReportSchema } from "@/lib/validation/form-reports";

/** "Report this form": records a report for the platform owner to review. */
export async function POST(request: NextRequest) {
  const limited = await enforceRateLimit(request, "form-reports");
  if (limited) return limited;

  try {
    const parsed = formReportSchema.parse(await request.json());
    const slug = normalizeSlug(parsed.slug);
    const supabase = createServiceClient();

    // Any state: a taken-down or draft form can still be reported.
    const { data: funnel, error: funnelError } = await supabase
      .from("funnels")
      .select("id,tenant_id")
      .eq("slug", slug)
      .maybeSingle();
    if (funnelError) throw new Error(funnelError.message);

    if (funnel && !(await enforceDailyCap("report", { funnelId: funnel.id, headers: request.headers }))) {
      // Enough reports for this form today; answer the same way without storing.
      return ok({ received: true }, 201);
    }

    const { error: insertError } = await supabase.from("form_reports").insert({
      funnel_id: funnel?.id ?? null,
      tenant_id: funnel?.tenant_id ?? null,
      funnel_slug: slug,
      reason: parsed.reason,
      details: parsed.details ? parsed.details : null,
      reporter_email: parsed.email ? parsed.email.toLowerCase() : null,
      reporter_ip_hash: getHashedClientIp(request.headers)
    });
    if (insertError) throw new Error(insertError.message);

    return ok({ received: true }, 201);
  } catch (error) {
    return failPublic(error);
  }
}
