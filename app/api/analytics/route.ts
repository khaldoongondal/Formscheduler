import { NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/responses";
import { getRequestGeoMetadata } from "@/lib/analytics/country-filter";
import { trackEvent } from "@/lib/analytics/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import type { Json } from "@/lib/types/database";

const eventSchema = z.object({
  funnel_id: z.string().uuid(),
  lead_session_id: z.string().uuid().optional(),
  visitor_id: z.string().min(8).max(128).optional(),
  event_type: z.enum(["page_view", "step_view"]),
  source: z.string().optional(),
  source_url: z.string().url().optional(),
  user_agent: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
});

export async function POST(request: NextRequest) {
  const limited = enforceRateLimit(request, "analytics", 120);
  if (limited) return limited;

  try {
    const parsed = eventSchema.parse(await request.json());
    const supabase = createServiceClient();
    const { data: funnel, error } = await supabase
      .from("funnels")
      .select("id,tenant_id")
      .eq("id", parsed.funnel_id)
      .eq("is_published", true)
      .single();

    if (error) throw new Error("Funnel not found.");

    await trackEvent({
      tenantId: funnel.tenant_id,
      funnelId: funnel.id,
      leadSessionId: parsed.lead_session_id,
      visitorId: parsed.visitor_id,
      eventType: parsed.event_type,
      source: parsed.source,
      sourceUrl: parsed.source_url,
      userAgent: parsed.user_agent,
      metadata: {
        ...(parsed.metadata ?? {}),
        ...getRequestGeoMetadata(request)
      } as Json
    });
    return ok({ tracked: true }, 201);
  } catch (error) {
    return fail(error);
  }
}
