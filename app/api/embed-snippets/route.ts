import { NextRequest } from "next/server";
import { fail, ok } from "@/lib/api/responses";
import { buildIframeSnippet, buildPopupSnippet, buildSplitTestIframeSnippet } from "@/lib/embed/snippets";
import { getFunnelBySlug } from "@/lib/funnels/service";

export async function GET(request: NextRequest) {
  try {
    const slug = request.nextUrl.searchParams.get("slug");
    if (!slug) throw new Error("Missing slug.");

    const funnel = await getFunnelBySlug(slug);
    if (!funnel) throw new Error("Funnel not found.");

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
    return fail(error);
  }
}
