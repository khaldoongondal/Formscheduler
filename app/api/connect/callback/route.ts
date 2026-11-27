import { NextResponse, type NextRequest } from "next/server";
import { getAdminTenantContext } from "@/lib/auth/tenant";
import { upsertOauthGhlConnection } from "@/lib/ghl/connections";
import {
  OAUTH_NONCE_COOKIE,
  exchangeAuthCode,
  fetchLocationName,
  oauthCallbackMatchesSession,
  verifyOauthState
} from "@/lib/ghl/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminUrl = new URL("/admin/ghl-connections", request.nextUrl.origin);
  const finish = (response: NextResponse) => {
    // The nonce is single use.
    response.cookies.set(OAUTH_NONCE_COOKIE, "", { path: "/api/connect", maxAge: 0 });
    return response;
  };
  const failed = (message: string) => {
    adminUrl.searchParams.set("error", message);
    return finish(NextResponse.redirect(adminUrl));
  };

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");

  if (!code || !state) {
    return failed("GHL sign-in was cancelled or the response was incomplete.");
  }

  const verified = verifyOauthState(state);
  if (!verified) {
    return failed("GHL sign-in session expired. Please try connecting again.");
  }

  // The flow must finish in the browser that started it, signed in to the
  // same account, before the code is exchanged.
  let sessionTenantId: string | null = null;
  try {
    ({ tenantId: sessionTenantId } = await getAdminTenantContext(["owner", "admin"]));
  } catch {
    sessionTenantId = null;
  }
  if (!oauthCallbackMatchesSession(verified, request.cookies.get(OAUTH_NONCE_COOKIE)?.value, sessionTenantId)) {
    return failed("GHL sign-in could not be matched to your session. Sign in and start the connection again from this page.");
  }

  try {
    const tokens = await exchangeAuthCode(code);
    if (!tokens.locationId) {
      return failed("GHL did not return a sub-account. Choose a specific location when connecting.");
    }

    const locationName = await fetchLocationName(tokens.accessToken, tokens.locationId);
    const connection = await upsertOauthGhlConnection({
      tenantId: verified.tenantId,
      name: locationName ?? `GHL ${tokens.locationId.slice(0, 8)}`,
      tokens
    });

    adminUrl.searchParams.set("saved", "oauth");
    adminUrl.searchParams.set("connection", connection.id);
    return finish(NextResponse.redirect(adminUrl));
  } catch (error) {
    // Never echo GoHighLevel or Supabase error text into the URL.
    console.error("[connect-callback] GoHighLevel sign-in failed", error);
    return failed("GoHighLevel sign-in failed. Please try again.");
  }
}
