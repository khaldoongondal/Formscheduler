import { NextResponse, type NextRequest } from "next/server";
import { getAdminTenantContext } from "@/lib/auth/tenant";
import { connectionMessageFromError } from "@/lib/connections/service";
import { MissingRefreshTokenError, saveGoogleConnection } from "@/lib/google/connect";
import { GOOGLE_COPY } from "@/lib/google/copy";
import { exchangeGoogleCode, isGoogleOauthConfigured, revokeGoogleToken } from "@/lib/google/oauth";
import {
  GOOGLE_CALLBACK_PATH,
  GOOGLE_NONCE_COOKIE,
  GOOGLE_NONCE_COOKIE_PATH,
  callbackMatchesSession,
  emailAndSubFromIdToken,
  hasRequiredCalendarScopes,
  verifyGoogleState
} from "@/lib/google/oauth-core";

export const dynamic = "force-dynamic";

function stateKey() {
  const rawKey = process.env.LEADDER_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) throw new Error("Missing LEADDER_TOKEN_ENCRYPTION_KEY.");
  return Buffer.from(rawKey, "base64");
}

export async function GET(request: NextRequest) {
  const origin = request.nextUrl.origin;
  const finish = (response: NextResponse) => {
    // The nonce is single use: cleared in every outcome.
    response.cookies.set(GOOGLE_NONCE_COOKIE, "", { path: GOOGLE_NONCE_COOKIE_PATH, maxAge: 0 });
    return response;
  };
  const failed = (message: string) => {
    const adminUrl = new URL("/admin/connections", origin);
    adminUrl.searchParams.set("error", message);
    return finish(NextResponse.redirect(adminUrl));
  };

  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const state = params.get("state");
  if (params.get("error") || !code || !state) return failed(GOOGLE_COPY.cancelled);
  if (!isGoogleOauthConfigured()) return failed(GOOGLE_COPY.notConfigured);

  const verified = verifyGoogleState(state, stateKey(), Date.now());
  if (!verified) return failed(GOOGLE_COPY.expired);

  let sessionTenantId: string | null = null;
  try {
    ({ tenantId: sessionTenantId } = await getAdminTenantContext(["owner", "admin"]));
  } catch {
    sessionTenantId = null;
  }
  if (!callbackMatchesSession(verified, request.cookies.get(GOOGLE_NONCE_COOKIE)?.value, sessionTenantId)) {
    return failed(GOOGLE_COPY.sessionMismatch);
  }

  try {
    const tokens = await exchangeGoogleCode(code, `${origin}${GOOGLE_CALLBACK_PATH}`);
    if (!hasRequiredCalendarScopes(tokens.scopes)) {
      await revokeGoogleToken(tokens.refreshToken ?? tokens.accessToken);
      return failed(GOOGLE_COPY.scopesMissing);
    }
    const { email, sub } = tokens.idToken ? emailAndSubFromIdToken(tokens.idToken) : { email: null, sub: null };
    if (!sub) return failed(GOOGLE_COPY.failed);

    const connection = await saveGoogleConnection({ tenantId: verified.tenantId, sub, email, tokens });
    const detailUrl = new URL(`/admin/connections/${connection.id}`, origin);
    detailUrl.searchParams.set("saved", "google");
    return finish(NextResponse.redirect(detailUrl));
  } catch (error) {
    if (error instanceof MissingRefreshTokenError) return failed(GOOGLE_COPY.failed);
    const known = error instanceof Error ? connectionMessageFromError(error.message) : null;
    if (known) return failed(known);
    // Never echo Google or Supabase error text into the URL or the log line.
    console.error("[google-callback] sign-in failed", error instanceof Error ? error.name : "unknown");
    return failed(GOOGLE_COPY.failed);
  }
}
