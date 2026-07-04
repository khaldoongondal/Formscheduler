import { NextResponse, type NextRequest } from "next/server";
import { getAdminTenantContext } from "@/lib/auth/tenant";
import { buildAuthorizeUrl, createOauthState, isGhlOauthConfigured } from "@/lib/ghl/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminUrl = new URL("/admin/ghl-connections", request.nextUrl.origin);

  if (!isGhlOauthConfigured()) {
    adminUrl.searchParams.set(
      "error",
      "GHL sign-in is not configured yet. Add the marketplace app credentials or use a Private Integration Token."
    );
    return NextResponse.redirect(adminUrl);
  }

  let tenantId: string;
  try {
    ({ tenantId } = await getAdminTenantContext(["owner", "admin"]));
  } catch {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("next", "/admin/ghl-connections");
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.redirect(buildAuthorizeUrl(createOauthState(tenantId)));
}
