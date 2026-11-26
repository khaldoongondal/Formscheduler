import { NextRequest } from "next/server";
import { PublicError, failPublic, ok } from "@/lib/api/responses";
import { buildIframeSnippet, buildPopupSnippet, buildSplitTestIframeSnippet } from "@/lib/embed/snippets";
import { getFunnelBySlug } from "@/lib/funnels/service";
import { enforceRateLimit } from "@/lib/security/rate-limit";

export async function GET(request: NextRequest) {
  const limited = await enforceRateLimit(request, "embed-snippets");
  if (limited) return limited;

  try {
    const slug = request.nextUrl.searchParams.get("slug");
    if (!slug) throw new PublicError("Missing form address.");

    const funnel = await getFunnelBySlug(slug);
    if (!funnel) throw new PublicError("Form not found.", 404);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
    const embedUrl = `${baseUrl}/embed/${funnel.slug}`;
    const splitTestId = `ghl-${funnel.slug}`;
    return ok({
      iframe: buildIframeSnippet(embedUrl),
      popup: buildPopupSnippet(embedUrl),
      splitTestId,
      splitControlIframe: buildSplitTestIframeSnippet(embedUrl, {
        splitTestId,
        splitVariant: "control"
      }),
      splitVariationIframe: buildSplitTestIframeSnippet(embedUrl, {
        splitTestId,
        splitVariant: "variation"
      }),
      fullPage: `${baseUrl}/book/${funnel.slug}`
    });
  } catch (error) {
    return failPublic(error);
  }
}
