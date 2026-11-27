/**
 * Google Calendar sign-in helpers (P2.5). Keys and env values are arguments.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
/** U1, U2: scope classes and free/busy coverage are checked in the release test. */
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.events.owned"
] as const;
export const GOOGLE_CALENDAR_SCOPES = GOOGLE_SCOPES.slice(2);
export const GOOGLE_NONCE_COOKIE = "formbook_google_oauth_nonce";
export const GOOGLE_NONCE_COOKIE_PATH = "/api/connect/google";
export const GOOGLE_STATE_TTL_MS = 600_000;
export const GOOGLE_CALLBACK_PATH = "/api/connect/google/callback";
export const GOOGLE_START_PATH = "/api/connect/google/start";

const STATE_PURPOSE = "google_calendar";

function sign(payload: string, key: Buffer) {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createGoogleState(tenantId: string, key: Buffer, nowMs: number): { state: string; nonce: string } {
  const nonce = randomBytes(16).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ purpose: STATE_PURPOSE, tenant_id: tenantId, expires_at: nowMs + GOOGLE_STATE_TTL_MS, nonce })
  ).toString("base64url");
  return { state: `${payload}.${sign(payload, key)}`, nonce };
}

/** Refuses expired, tampered, other-purpose and GoHighLevel states (they carry no purpose). */
export function verifyGoogleState(state: string, key: Buffer, nowMs: number): { tenantId: string; nonce: string } | null {
  if (typeof state !== "string" || state.length > 2048) return null;
  const parts = state.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  if (!safeEqual(sign(payload, key), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (parsed.purpose !== STATE_PURPOSE) return null;
    if (typeof parsed.tenant_id !== "string" || !parsed.tenant_id) return null;
    if (typeof parsed.expires_at !== "number" || parsed.expires_at < nowMs) return null;
    if (typeof parsed.nonce !== "string" || !parsed.nonce) return null;
    return { tenantId: parsed.tenant_id, nonce: parsed.nonce };
  } catch {
    return null;
  }
}

/** The callback must reach the browser that started the flow, signed in to the same tenant. */
export function callbackMatchesSession(
  verified: { tenantId: string; nonce: string },
  cookieNonce: string | null | undefined,
  sessionTenantId: string | null | undefined
): boolean {
  if (!cookieNonce || !sessionTenantId) return false;
  if (sessionTenantId !== verified.tenantId) return false;
  return safeEqual(verified.nonce, cookieNonce);
}

export function buildGoogleAuthorizeUrl(input: { clientId: string; redirectUri: string; state: string }): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "false");
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type ParsedTokens = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
  idToken: string | null;
};

/** Never returns token text inside `error`. */
export function parseTokenResponse(body: unknown, nowMs: number): ParsedTokens | { error: string } {
  if (!body || typeof body !== "object") return { error: "invalid_response" };
  const data = body as Record<string, unknown>;
  if (typeof data.error === "string" && data.error) {
    return { error: data.error.replace(/[^a-z_]/gi, "").slice(0, 60) || "error" };
  }
  if (typeof data.access_token !== "string" || !data.access_token) return { error: "invalid_response" };
  const expiresIn = typeof data.expires_in === "number" && data.expires_in > 0 ? data.expires_in : 3600;
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === "string" && data.refresh_token ? data.refresh_token : null,
    expiresAt: nowMs + expiresIn * 1000,
    scopes: typeof data.scope === "string" ? data.scope.split(/\s+/).filter(Boolean) : [],
    idToken: typeof data.id_token === "string" && data.id_token ? data.id_token : null
  };
}

export function hasRequiredCalendarScopes(scopes: string[]): boolean {
  return GOOGLE_CALENDAR_SCOPES.every((scope) => scopes.includes(scope));
}

/** Payload decode only: the token came straight from Google's token endpoint over TLS. */
export function emailAndSubFromIdToken(idToken: string): { email: string | null; sub: string | null } {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return { email: null, sub: null };
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    const email = typeof parsed.email === "string" && parsed.email.length <= 254 ? parsed.email : null;
    const sub = typeof parsed.sub === "string" && parsed.sub.length <= 255 ? parsed.sub : null;
    return { email, sub };
  } catch {
    return { email: null, sub: null };
  }
}

function originOf(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The sign-in returns to the origin it started on when that origin is the
 * app address or an allowed extra address; otherwise the browser is first
 * sent to the app address (the nonce cookie must live on the callback's origin).
 */
export function resolveOauthOrigin(
  requestOrigin: string,
  appUrl: string,
  extraOrigins: string[]
): { origin: string; redirectFirst: boolean } {
  const appOrigin = originOf(appUrl) ?? originOf(requestOrigin) ?? requestOrigin;
  const request = originOf(requestOrigin);
  const allowed = new Set([appOrigin, ...extraOrigins.map(originOf).filter((value): value is string => Boolean(value))]);
  if (request && allowed.has(request)) return { origin: request, redirectFirst: false };
  return { origin: appOrigin, redirectFirst: true };
}

export function parseExtraOrigins(value: string | undefined | null): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** Google event ids use base32hex characters (a-v, 0-9), 5 to 1024 long. A uuid's hex fits. */
export function googleEventIdFor(attemptId: string): string {
  return `fb${attemptId.toLowerCase().replace(/[^0-9a-f]/g, "")}`;
}
