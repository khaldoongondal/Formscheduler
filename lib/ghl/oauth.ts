import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const GHL_AUTHORIZE_URL = "https://marketplace.gohighlevel.com/oauth/chooselocation";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GHL_LOCATION_URL = "https://services.leadconnectorhq.com/locations";

const OAUTH_SCOPES = [
  "contacts.readonly",
  "contacts.write",
  "calendars.readonly",
  "calendars/events.readonly",
  "calendars/events.write",
  "opportunities.readonly",
  "opportunities.write",
  "locations.readonly"
].join(" ");

const STATE_TTL_MS = 10 * 60 * 1000;

export type GhlOauthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  locationId: string;
  companyId: string | null;
};

export function isGhlOauthConfigured() {
  return Boolean(process.env.GHL_OAUTH_CLIENT_ID && process.env.GHL_OAUTH_CLIENT_SECRET);
}

function getOauthEnv() {
  const clientId = process.env.GHL_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GHL_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("GHL OAuth is not configured. Set GHL_OAUTH_CLIENT_ID and GHL_OAUTH_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

function getRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  return `${appUrl.replace(/\/$/, "")}/api/ghl/oauth/callback`;
}

function getStateKey() {
  const rawKey = process.env.LEADDER_TOKEN_ENCRYPTION_KEY;
  if (!rawKey) throw new Error("Missing LEADDER_TOKEN_ENCRYPTION_KEY.");
  return Buffer.from(rawKey, "base64");
}

function signState(payload: string) {
  return createHmac("sha256", getStateKey()).update(payload).digest("base64url");
}

export function createOauthState(tenantId: string) {
  const payload = Buffer.from(
    JSON.stringify({
      tenant_id: tenantId,
      expires_at: Date.now() + STATE_TTL_MS,
      nonce: randomBytes(8).toString("base64url")
    })
  ).toString("base64url");

  return `${payload}.${signState(payload)}`;
}

export function verifyOauthState(state: string): { tenantId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;

  const expected = signState(payload);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== signatureBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, signatureBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof parsed.tenant_id !== "string" || typeof parsed.expires_at !== "number") return null;
    if (parsed.expires_at < Date.now()) return null;
    return { tenantId: parsed.tenant_id };
  } catch {
    return null;
  }
}

export function buildAuthorizeUrl(state: string) {
  const { clientId } = getOauthEnv();
  const url = new URL(GHL_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", getRedirectUri());
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", state);
  return url.toString();
}

type GhlTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  locationId?: string;
  companyId?: string;
  error?: string;
  error_description?: string;
};

async function requestTokens(body: Record<string, string>): Promise<GhlOauthTokens> {
  const { clientId, clientSecret } = getOauthEnv();
  const response = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      user_type: "Location",
      ...body
    }),
    cache: "no-store"
  });

  const data = (await response.json().catch(() => ({}))) as GhlTokenResponse;

  if (!response.ok || !data.access_token || !data.refresh_token) {
    const detail = data.error_description ?? data.error ?? `HTTP ${response.status}`;
    throw new Error(`GHL OAuth token request failed: ${detail}`);
  }

  const expiresInSeconds = data.expires_in ?? 86_400;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + Math.max(60, expiresInSeconds - 60) * 1000),
    locationId: data.locationId ?? "",
    companyId: data.companyId ?? null
  };
}

export function exchangeAuthCode(code: string) {
  return requestTokens({
    grant_type: "authorization_code",
    code,
    redirect_uri: getRedirectUri()
  });
}

export function refreshOauthTokens(refreshToken: string) {
  return requestTokens({
    grant_type: "refresh_token",
    refresh_token: refreshToken
  });
}

export async function fetchLocationName(accessToken: string, locationId: string) {
  try {
    const response = await fetch(`${GHL_LOCATION_URL}/${encodeURIComponent(locationId)}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Version: "2021-07-28",
        Accept: "application/json"
      },
      cache: "no-store"
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { location?: { name?: string }; name?: string };
    return data.location?.name ?? data.name ?? null;
  } catch {
    return null;
  }
}
