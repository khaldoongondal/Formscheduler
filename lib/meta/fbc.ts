/**
 * Meta click id (fbc) rules, ported from the proven Mission Control logic.
 * Pure: no Next.js or Supabase imports.
 *
 * fbc is `fb.{subdomain_index}.{click_time_ms}.{fbclid}`. The click time must
 * be the time the click was first seen; a made-up time is worse than no fbc,
 * so without a real time we send none.
 */

import { FBCLID_FUTURE_TOLERANCE_MS, FBCLID_MAX_AGE_MS } from "@/lib/meta/constants";

export function buildFbc(fbclid: string | null | undefined, creationTimeMs?: number | null): string | null {
  const clickId = typeof fbclid === "string" ? fbclid.trim() : "";
  if (!clickId) return null;
  if (typeof creationTimeMs !== "number") return null;
  if (!Number.isFinite(creationTimeMs) || creationTimeMs <= 0) return null;
  return `fb.1.${Math.floor(creationTimeMs)}.${clickId}`;
}

/** The click id inside an fbc value (it may contain dots), or null for other shapes. */
export function fbclidFromFbc(fbc: string | null | undefined): string | null {
  if (!fbc) return null;
  const parts = fbc.trim().split(".");
  if (parts.length < 4 || parts[0] !== "fb") return null;
  const clickId = parts.slice(3).join(".");
  return clickId || null;
}

/** A click time we accept: within the last 90 days and at most 5 minutes in the future. */
export function isUsableClickTime(ms: unknown, nowMs: number): ms is number {
  return (
    typeof ms === "number" &&
    Number.isFinite(ms) &&
    ms > 0 &&
    ms >= nowMs - FBCLID_MAX_AGE_MS &&
    ms <= nowMs + FBCLID_FUTURE_TOLERANCE_MS
  );
}

/**
 * The fbc to send. A cookie value is kept while it describes the click we
 * know about; it is rebuilt from the fbclid when missing or stale (a returning
 * visitor who clicked a newer ad); without a usable click time nothing is
 * invented.
 */
export function resolveFbc(input: {
  fbc?: string | null;
  fbclid?: string | null;
  fbclidSeenAtMs?: number | null;
  nowMs: number;
}): string | null {
  const cookie = typeof input.fbc === "string" && input.fbc.trim() ? input.fbc.trim() : null;
  const fbclid = typeof input.fbclid === "string" && input.fbclid.trim() ? input.fbclid.trim() : null;

  if (!fbclid) return cookie;

  const cookieClickId = fbclidFromFbc(cookie);
  if (cookie && cookieClickId === fbclid) return cookie;

  const clickTime = isUsableClickTime(input.fbclidSeenAtMs, input.nowMs) ? input.fbclidSeenAtMs : null;
  // Missing cookie or a cookie for a different click: rebuild, or send nothing.
  return buildFbc(fbclid, clickTime);
}
