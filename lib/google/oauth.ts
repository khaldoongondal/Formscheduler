/**
 * Google token exchange, refresh and revocation (P2.5). Tokens are stored
 * only encrypted and never logged, returned or placed in a URL.
 */
import { markConnectionStatus, type ConnectionRow } from "@/lib/connections/service";
import { ProviderAuthError } from "@/lib/connections/types";
import { ProviderHttpError, providerRequest } from "@/lib/connections/http";
import { GOOGLE_COPY } from "@/lib/google/copy";
import {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  parseTokenResponse,
  type ParsedTokens
} from "@/lib/google/oauth-core";
import { decryptSecret, encryptSecret } from "@/lib/security/encryption";
import { createServiceClient } from "@/lib/supabase/server";

export type { ParsedTokens };

const REFRESH_MARGIN_MS = 5 * 60_000;

export function isGoogleOauthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

function getGoogleEnv() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Calendar sign-in is not configured.");
  return { clientId, clientSecret };
}

export function getGoogleClientId(): string {
  return getGoogleEnv().clientId;
}

async function tokenRequest(form: Record<string, string>): Promise<ParsedTokens> {
  const { clientId, clientSecret } = getGoogleEnv();
  let body: unknown;
  try {
    ({ body } = await providerRequest({
      provider: "google",
      url: GOOGLE_TOKEN_URL,
      method: "POST",
      form: { ...form, client_id: clientId, client_secret: clientSecret }
    }));
  } catch (error) {
    // Google answers 400 { error: "invalid_grant" } for a revoked or expired refresh token.
    if (error instanceof ProviderHttpError && error.status === 400 && error.message.includes("invalid_grant")) {
      throw new Error("invalid_grant");
    }
    throw error;
  }
  const parsed = parseTokenResponse(body, Date.now());
  if ("error" in parsed) throw new Error(`google_token_${parsed.error}`);
  return parsed;
}

export function exchangeGoogleCode(code: string, redirectUri: string): Promise<ParsedTokens> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

/** POST form body token=...; never in the URL. Errors are logged and swallowed. U5. */
export async function revokeGoogleToken(token: string): Promise<void> {
  try {
    await providerRequest({ provider: "google", url: GOOGLE_REVOKE_URL, method: "POST", form: { token } });
  } catch (error) {
    console.error("[google] token revoke failed", error instanceof ProviderHttpError ? error.status : "network");
  }
}

/** Best-effort revocation for a stored connection (refresh token first, it revokes the grant). */
export async function revokeConnectionTokens(row: ConnectionRow): Promise<void> {
  const ciphertext = row.refresh_token_ciphertext ?? row.secret_ciphertext;
  if (!ciphertext) return;
  try {
    await revokeGoogleToken(decryptSecret(ciphertext));
  } catch {
    console.error("[google] token revoke skipped", "decrypt");
  }
}

async function markNeedsAttention(row: ConnectionRow) {
  try {
    await markConnectionStatus(row.id, "needs_attention", GOOGLE_COPY.accessRemoved);
  } catch {
    console.error("[google] status update failed");
  }
}

/**
 * A valid access token for this connection, refreshed when under 5 minutes
 * remain (or always, with `force`). The row must have been loaded tenant-scoped.
 */
export async function getGoogleAccessToken(row: ConnectionRow, options: { force?: boolean } = {}): Promise<string> {
  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (!options.force && row.secret_ciphertext && expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return decryptSecret(row.secret_ciphertext);
  }
  if (!row.refresh_token_ciphertext) {
    await markNeedsAttention(row);
    throw new ProviderAuthError("google");
  }

  let tokens: ParsedTokens;
  try {
    tokens = await tokenRequest({ grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh_token_ciphertext) });
  } catch (error) {
    if (error instanceof Error && error.message === "invalid_grant") {
      await markNeedsAttention(row);
      throw new ProviderAuthError("google");
    }
    throw error;
  }

  const supabase = createServiceClient();
  const update: Record<string, string> = {
    secret_ciphertext: encryptSecret(tokens.accessToken),
    token_expires_at: new Date(tokens.expiresAt).toISOString()
  };
  if (tokens.refreshToken) update.refresh_token_ciphertext = encryptSecret(tokens.refreshToken);

  // Compare-and-set on the previous expiry, so two refreshes at once keep one result.
  let query = supabase.from("connections").update(update).eq("id", row.id).eq("tenant_id", row.tenant_id);
  query = row.token_expires_at ? query.eq("token_expires_at", row.token_expires_at) : query.is("token_expires_at", null);
  const { data, error } = await query.select("id");
  if (error) {
    console.error("[google] token store failed", error.code ?? "unknown");
    return tokens.accessToken;
  }
  if (!data?.length) {
    // Another request refreshed first: use what it stored when still fresh.
    const { data: fresh } = await supabase
      .from("connections")
      .select("secret_ciphertext,token_expires_at")
      .eq("id", row.id)
      .eq("tenant_id", row.tenant_id)
      .maybeSingle();
    const freshExpiry = fresh?.token_expires_at ? Date.parse(fresh.token_expires_at as string) : 0;
    if (fresh?.secret_ciphertext && freshExpiry - Date.now() > 60_000) {
      return decryptSecret(fresh.secret_ciphertext as string);
    }
  }
  return tokens.accessToken;
}
