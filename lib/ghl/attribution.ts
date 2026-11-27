import type { Json, LeadSession } from "@/lib/types/database";

/**
 * Attribution custom fields (UTM, click IDs, device fingerprint).
 *
 * These field IDs exist only in the Gondal Tech GoHighLevel account. They are
 * sent only for connections flagged use_gondal_attribution_fields (migration
 * 0024), so another account never receives custom-field IDs it does not have.
 * Pure module.
 */
export const GHL_ATTRIBUTION_FIELD_IDS = {
  device_fingerprint: "mD0nl9Bol76ktldcLQh9",
  fbclid: "NYqxiIU8Cw5MuKvZuxqU",
  fbc: "uxxBgB61uS01OOPXS6c6",
  fbp: "zelneybTWDq3nVVvi27t",
  utm_source: "LwNlb6SU9bcF5oM3umBC",
  utm_medium: "Wx41yHI1dyO4r2YN9R9B",
  utm_campaign: "N5EydZ1pHC6Mnsq7LIic",
  utm_content: "f5eU5TgjtvGyRgvQ7ygP",
  utm_term: "O6LkXOXEBmTvMAyQCfh3",
  utm_adset: "48D31CoLhFH8u6iSCnqL",
  utm_adid: "TCeKglZheFpbe06LTD95",
  utm_adsetid: "xT7tCx1XJkgGTIGXhmXI",
  utm_campaignid: "FD0XrXhntAvPrFPZPEq6"
} as const;

function isJsonRecord(value: Json): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getMetadataString(metadata: Json, key: string) {
  if (!isJsonRecord(metadata)) return undefined;

  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function buildGhlTrackingCustomFields(leadSession: LeadSession, enabled: boolean) {
  if (!enabled) return [];
  return [
    [GHL_ATTRIBUTION_FIELD_IDS.fbclid, getMetadataString(leadSession.metadata, "fbclid")],
    [
      GHL_ATTRIBUTION_FIELD_IDS.device_fingerprint,
      getMetadataString(leadSession.metadata, "device_fingerprint") ?? getMetadataString(leadSession.metadata, "fingerprint")
    ],
    [GHL_ATTRIBUTION_FIELD_IDS.fbc, getMetadataString(leadSession.metadata, "fbc")],
    [GHL_ATTRIBUTION_FIELD_IDS.fbp, getMetadataString(leadSession.metadata, "fbp")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_source, leadSession.utm_source?.trim() ?? getMetadataString(leadSession.metadata, "utm_source")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_medium, leadSession.utm_medium?.trim() ?? getMetadataString(leadSession.metadata, "utm_medium")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_campaign, leadSession.utm_campaign?.trim() ?? getMetadataString(leadSession.metadata, "utm_campaign")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_content, leadSession.utm_content?.trim() ?? getMetadataString(leadSession.metadata, "utm_content")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_term, leadSession.utm_term?.trim() ?? getMetadataString(leadSession.metadata, "utm_term")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_adset, getMetadataString(leadSession.metadata, "utm_adset")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_adid, getMetadataString(leadSession.metadata, "utm_adid")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_adsetid, getMetadataString(leadSession.metadata, "utm_adsetid")],
    [
      GHL_ATTRIBUTION_FIELD_IDS.utm_campaignid,
      getMetadataString(leadSession.metadata, "utm_campaignid") ?? getMetadataString(leadSession.metadata, "utm_id")
    ]
  ]
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([id, fieldValue]) => ({
      id,
      fieldValue
    }));
}
