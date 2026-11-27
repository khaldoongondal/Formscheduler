import { NextRequest, NextResponse } from "next/server";
import { failPublic, ok } from "@/lib/api/responses";
import { getRequestGeoMetadata } from "@/lib/analytics/country-filter";
import { trackEvent } from "@/lib/analytics/service";
import { assertFunnelServesPublic } from "@/lib/funnels/public-gate";
import { resolveRecordedSplitTestId } from "@/lib/split-tests/public";
import { ANALYTICS_MAX_BODY_BYTES } from "@/lib/security/limits";
import { enforceDailyCap, enforceRateLimit } from "@/lib/security/rate-limit";
import type { Json } from "@/lib/types/database";
import { analyticsEventSchema } from "@/lib/validation/analytics";

function tooLarge() {
  return NextResponse.json({ error: "Request too large." }, { status: 413 });
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > ANALYTICS_MAX_BODY_BYTES) {
    return tooLarge();
  }

  const limited = await enforceRateLimit(request, "analytics");
  if (limited) return limited;

  try {
    // Content-Length can be missing (chunked), so check the real size too.
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > ANALYTICS_MAX_BODY_BYTES) {
      return tooLarge();
    }

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: "Please check your answers and try again." }, { status: 422 });
    }

    const parsed = analyticsEventSchema.parse(body);
    const funnel = await assertFunnelServesPublic(parsed.funnel_id);

    // Daily caps per form and tenant. The client ignores the response.
    if (!(await enforceDailyCap("analytics", { funnelId: funnel.id, tenantId: funnel.tenant_id, headers: request.headers }))) {
      return ok({ tracked: false }, 202);
    }

    // Never throws: a bad or forged test id is stored as null.
    const splitTestId = await resolveRecordedSplitTestId(parsed.test_id, funnel.id, funnel.tenant_id);

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
      } as Json,
      splitTestId
    });
    return ok({ tracked: true }, 201);
  } catch (error) {
    return failPublic(error);
  }
}
