/**
 * Builds the Meta server event and request body. Pure: no Next.js or Supabase imports.
 *
 * The access token goes in the JSON body, never in the URL.
 */

import { META_GRAPH_API_VERSION, META_GRAPH_BASE } from "@/lib/meta/constants";
import { metaEventName, type MetaEventKey } from "@/lib/meta/events";
import { resolveFbc } from "@/lib/meta/fbc";
import { buildUserData, type MetaUserData, type UserDataInput } from "@/lib/meta/hash";

export const META_EVENT_SOURCE_URL_MAX = 2048;

export type MetaServerEvent = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: MetaUserData;
};

export type PayloadInput = {
  key: MetaEventKey | "test_event";
  eventId: string;
  eventTimeMs: number;
  sourceUrl?: string | null;
  landingPageUrl?: string | null;
  user: UserDataInput;
  fbclid?: string | null;
  fbclidSeenAtMs?: number | null;
  nowMs: number;
};

function httpUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().slice(0, META_EVENT_SOURCE_URL_MAX);
  } catch {
    return null;
  }
}

/** Decision M16: the embedding page when known, else the form address. */
export function pickEventSourceUrl(landing?: string | null, source?: string | null): string | undefined {
  return httpUrl(landing) ?? httpUrl(source) ?? undefined;
}

export function buildMetaServerEvent(input: PayloadInput): { event: MetaServerEvent; matchKeys: string[] } {
  const fbc = resolveFbc({
    fbc: input.user.fbc,
    fbclid: input.fbclid,
    fbclidSeenAtMs: input.fbclidSeenAtMs,
    nowMs: input.nowMs
  });
  const { userData, matchKeys } = buildUserData({ ...input.user, fbc });
  const event: MetaServerEvent = {
    event_name: metaEventName(input.key),
    event_time: Math.floor(input.eventTimeMs / 1000),
    event_id: input.eventId,
    action_source: "website",
    user_data: userData
  };
  const sourceUrl = pickEventSourceUrl(input.landingPageUrl, input.sourceUrl);
  if (sourceUrl) event.event_source_url = sourceUrl;
  return { event, matchKeys };
}

export function buildMetaRequestBody(
  events: MetaServerEvent[],
  accessToken: string,
  testEventCode?: string | null
): { data: MetaServerEvent[]; access_token: string; test_event_code?: string } {
  const body: { data: MetaServerEvent[]; access_token: string; test_event_code?: string } = {
    data: events,
    access_token: accessToken
  };
  const code = typeof testEventCode === "string" ? testEventCode.trim() : "";
  if (code) body.test_event_code = code;
  return body;
}

export const DATASET_ID_PATTERN = /^[0-9]{5,20}$/;

export function metaEventsUrl(datasetId: string): string {
  if (!DATASET_ID_PATTERN.test(datasetId)) {
    throw new Error("Invalid Meta dataset id.");
  }
  return `${META_GRAPH_BASE}/${META_GRAPH_API_VERSION}/${datasetId}/events`;
}
