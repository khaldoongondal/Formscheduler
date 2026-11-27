/**
 * Meta Conversions API constants. Pure: no Next.js or Supabase imports.
 *
 * The Graph API version lives here and nowhere else. Change this one constant
 * when Meta retires the version.
 */

export const META_GRAPH_API_VERSION = "v21.0";
export const META_GRAPH_BASE = "https://graph.facebook.com";
export const META_SEND_TIMEOUT_MS = 8000;
/** Meta refuses website events older than 7 days; keep one hour of margin. */
export const META_MAX_EVENT_AGE_MS = (7 * 24 - 1) * 60 * 60 * 1000;
export const META_MAX_ATTEMPTS = 6;
export const FBCLID_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
export const FBCLID_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
/** postMessage type sent to the embedding page so a browser pixel can reuse the event id. */
export const META_EVENT_MESSAGE_TYPE = "formbook:meta-event";
/** localStorage key for the first time this browser saw an fbclid. */
export const FBCLID_SEEN_STORAGE_KEY = "formbook_fbclid_seen";
