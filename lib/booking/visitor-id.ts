/**
 * Browser visitor id helpers. Client-safe: no Node, Next.js or Supabase
 * imports. The localStorage key `leadder_visitor_id` is part of the public
 * contract and must not change.
 */

export const VISITOR_ID_KEY = "leadder_visitor_id";
/** First-party cookie that keeps split test assignment sticky (decision S3). */
export const VISITOR_COOKIE = "formbook_vid";
export const VISITOR_COOKIE_MAX_AGE_SECONDS = 34560000;

const VISITOR_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidVisitorId(value: unknown): value is string {
  return typeof value === "string" && VISITOR_ID_PATTERN.test(value);
}

/** Reads the stored visitor id, creating it on first use (unchanged behaviour). */
export function getVisitorId() {
  const generated =
    window.crypto?.randomUUID?.() ?? `visitor_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  try {
    const existing = window.localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    window.localStorage.setItem(VISITOR_ID_KEY, generated);
  } catch {
    return generated;
  }
  return generated;
}

/**
 * The id to keep in the visitor cookie: only the id the server used to pick
 * the split test form. Null when the server used its own IP and user agent
 * key, so that key stays the single source of truth for this visitor.
 */
export function visitorCookieToWrite(initialVisitorId: string | null | undefined): string | null {
  return isValidVisitorId(initialVisitorId) ? initialVisitorId : null;
}

/**
 * Writes the visitor cookie. Partitioned and SameSite=None so it also works
 * inside third-party iframes in browsers that support partitioned cookies.
 */
export function writeVisitorCookie(id: string) {
  if (!isValidVisitorId(id)) return;
  try {
    document.cookie = `${VISITOR_COOKIE}=${id}; Path=/; Max-Age=${VISITOR_COOKIE_MAX_AGE_SECONDS}; Secure; SameSite=None; Partitioned`;
  } catch {
    // Cookies can be blocked; assignment then falls back to storage or the server key.
  }
}

/** Stores the server-chosen visitor id so analytics and assignment use the same id. */
export function adoptVisitorId(id: string) {
  if (!isValidVisitorId(id)) return;
  try {
    if (window.localStorage.getItem(VISITOR_ID_KEY) !== id) {
      window.localStorage.setItem(VISITOR_ID_KEY, id);
    }
  } catch {
    // Storage can be blocked inside third-party iframes.
  }
}

/** A uuid for one page load (used to tie browser events together). */
export function createPageLoadId() {
  return (
    window.crypto?.randomUUID?.() ?? `load_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
  );
}
