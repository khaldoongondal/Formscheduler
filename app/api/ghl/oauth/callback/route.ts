import { NextResponse, type NextRequest } from "next/server";
import { upsertOauthGhlConnection } from "@/lib/ghl/connections";
import { exchangeAuthCode, fetchLocationName, verifyOauthState } from "@/lib/ghl/oauth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminUrl = new URL("/admin/ghl-connections", request.nextUrl.origin);
  const failed = (message: string) => {
    adminUrl.searchParams.set("error", message);
    return NextResponse.redirect(adminUrl);
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
    return NextResponse.redirect(adminUrl);
  } catch (error) {
    return failed(error instanceof Error ? error.message : "GHL sign-in failed. Please try again.");
  }
}
