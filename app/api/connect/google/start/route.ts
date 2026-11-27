import { NextResponse, type NextRequest } from "next/server";
import { getAdminTenantContext } from "@/lib/auth/tenant";
import { GOOGLE_COPY } from "@/lib/google/copy";
import { getGoogleClientId, isGoogleOauthConfigured } from "@/lib/google/oauth";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_NONCE_COOKIE_PATH,
  GOOGLE_START_PATH,
  GOOGLE_STATE_TTL_MS,
  buildGoogleAuthorizeUrl,
  createGoogleState,
  parseExtraOrigins,
  resolveOauthOrigin
} from "@/lib/google/oauth-core";

export const dynamic = "force-dynamic";

function stateKey() {
  const rawKey = process.env.LEADDER_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) throw new Error("Missing LEADDER_TOKEN_ENCRYPTION_KEY.");
  return Buffer.from(rawKey, "base64");
}

export async function GET(request: NextRequest) {
  const requestOrigin = request.nextUrl.origin;

  if (!isGoogleOauthConfigured()) {
    const adminUrl = new URL("/admin/connections", requestOrigin);
    adminUrl.searchParams.set("error", GOOGLE_COPY.notConfigured);
    return NextResponse.redirect(adminUrl);
  }

  // Decision C24: the nonce cookie must be set on the origin Google returns to.
  const { origin, redirectFirst } = resolveOauthOrigin(
    requestOrigin,
    process.env.NEXT_PUBLIC_APP_URL ?? requestOrigin,
    parseExtraOrigins(process.env.FORMBOOK_EXTRA_APP_ORIGINS)
  );
  if (redirectFirst) {
    return NextResponse.redirect(new URL(GOOGLE_START_PATH, origin));
  }

  let tenantId: string;
  try {
    ({ tenantId } = await getAdminTenantContext(["owner", "admin"]));
  } catch {
    const loginUrl = new URL("/login", origin);
    loginUrl.searchParams.set("next", "/admin/connections");
    return NextResponse.redirect(loginUrl);
  }

  const { state, nonce } = createGoogleState(tenantId, stateKey(), Date.now());
  const response = NextResponse.redirect(
    buildGoogleAuthorizeUrl({ clientId: getGoogleClientId(), redirectUri: `${origin}${GOOGLE_CALLBACK_PATH}`, state })
  );
  response.cookies.set(GOOGLE_NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: GOOGLE_NONCE_COOKIE_PATH,
    maxAge: GOOGLE_STATE_TTL_MS / 1000
  });
  return response;
}
