import { FBCLID_SEEN_STORAGE_KEY, META_EVENT_MESSAGE_TYPE } from "@/lib/meta/constants";

/**
 * Browser side of the Meta bridge (decision M17). Tells the embedding page the
 * event name and id our server queued, so a customer who also runs the Meta
 * browser pixel can send the same event id and Meta counts it once.
 * Client-safe: no Node imports.
 */

export type BrowserMetaEvent = { event_name: string; event_id: string };

export function postMetaEvents(events: BrowserMetaEvent[] | undefined | null): void {
  if (!events?.length || typeof window === "undefined") return;
  for (const event of events) {
    if (!event || typeof event.event_name !== "string" || typeof event.event_id !== "string") continue;
    const message = { type: META_EVENT_MESSAGE_TYPE, event_name: event.event_name, event_id: event.event_id };
    try {
      if (window.parent && window.parent !== window.self) window.parent.postMessage(message, "*");
    } catch {
      // Some embed contexts restrict parent access.
    }
    try {
      window.opener?.postMessage(message, "*");
    } catch {
      // Popups may have no opener or a restricted one.
    }
  }
}

/**
 * Decision M13: remembers the first time this browser saw the current fbclid
 * and returns that time (ms) when it matches, else undefined.
 */
export function rememberFbclidSeenAt(fbclid: string | null | undefined): number | undefined {
  if (!fbclid) return undefined;
  try {
    const raw = window.localStorage.getItem(FBCLID_SEEN_STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as { fbclid?: unknown; ts?: unknown }) : null;
    if (stored && stored.fbclid === fbclid && typeof stored.ts === "number" && Number.isFinite(stored.ts)) {
      return stored.ts;
    }
    const ts = Date.now();
    window.localStorage.setItem(FBCLID_SEEN_STORAGE_KEY, JSON.stringify({ fbclid, ts }));
    return ts;
  } catch {
    return undefined;
  }
}
