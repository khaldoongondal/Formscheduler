import { NextResponse, type NextRequest } from "next/server";
import { getAdminTenantContext } from "@/lib/auth/tenant";
import {
  OAUTH_NONCE_COOKIE,
  OAUTH_NONCE_COOKIE_MAX_AGE_SECONDS,
  buildAuthorizeUrl,
  createOauthState,
  isGhlOauthConfigured
} from "@/lib/ghl/oauth";

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

  const { state, nonce } = createOauthState(tenantId);
  const response = NextResponse.redirect(buildAuthorizeUrl(state));
  // Binds the state to this browser; the callback requires the same nonce.
  // SameSite=Lax is sent on the top-level redirect back from GoHighLevel.
  response.cookies.set(OAUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/connect",
    maxAge: OAUTH_NONCE_COOKIE_MAX_AGE_SECONDS
  });
  return response;
}
