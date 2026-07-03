import type { Json } from "@/lib/types/database";

export const analyticsCountryOptions = [
  { code: "US", label: "United States" },
  { code: "CA", label: "Canada" },
  { code: "GB", label: "United Kingdom" },
  { code: "AU", label: "Australia" },
  { code: "NZ", label: "New Zealand" },
  { code: "IN", label: "India" },
  { code: "PK", label: "Pakistan" }
] as const;

export const defaultAnalyticsTargetCountryCodes = ["US"] as const;

export const analyticsTrafficSourceOptions = [
  {
    value: "meta",
    label: "Facebook / Instagram",
    description: "Uses Meta UTMs or fbclid/fbc/fbp."
  },
  {
    value: "facebook",
    label: "Facebook only",
    description: "Requires utm_source=facebook or fb."
  },
  {
    value: "instagram",
    label: "Instagram only",
    description: "Requires utm_source=instagram or ig."
  },
  {
    value: "google",
    label: "Google",
    description: "Uses Google UTMs or gclid."
  },
  {
    value: "tiktok",
    label: "TikTok",
    description: "Uses TikTok UTMs or ttclid."
  }
] as const;

export const defaultAnalyticsTrafficSources = ["meta"] as const;

type AnalyticsTrafficSource = (typeof analyticsTrafficSourceOptions)[number]["value"];

interface TrafficSourceCarrier {
  referrer?: string | null;
  source_url?: string | null;
  utm_campaign?: string | null;
  utm_content?: string | null;
  utm_medium?: string | null;
  utm_source?: string | null;
  utm_term?: string | null;
}

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeCountryCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : null;
}

export function normalizeAnalyticsTargetCountryCodes(value: unknown) {
  const values =
    typeof value === "string"
      ? value.split(/[\s,]+/)
      : Array.isArray(value)
        ? value
        : [];

  const normalized = values
    .map(normalizeCountryCode)
    .filter((code): code is string => Boolean(code));

  return normalized.filter((code, index) => normalized.indexOf(code) === index);
}

export function resolveAnalyticsTargetCountryCodes(rule: Json | undefined) {
  if (!isJsonObject(rule) || !Array.isArray(rule.analytics_target_country_codes)) {
    return [...defaultAnalyticsTargetCountryCodes];
  }

  return normalizeAnalyticsTargetCountryCodes(rule.analytics_target_country_codes);
}

export function mergeAnalyticsTargetCountryCodes(rule: Json | undefined, countryCodes: string[]): Json {
  const base = isJsonObject(rule) ? rule : { mode: "all_required_answered" };
  return {
    ...base,
    analytics_target_country_codes: normalizeAnalyticsTargetCountryCodes(countryCodes)
  };
}

function normalizeTrafficSource(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return analyticsTrafficSourceOptions.some((source) => source.value === normalized)
    ? (normalized as AnalyticsTrafficSource)
    : null;
}

export function normalizeAnalyticsTrafficSources(value: unknown) {
  const values =
    typeof value === "string"
      ? value.split(/[\s,]+/)
      : Array.isArray(value)
        ? value
        : [];

  const normalized = values
    .map(normalizeTrafficSource)
    .filter((source): source is AnalyticsTrafficSource => Boolean(source));

  return normalized.filter((source, index) => normalized.indexOf(source) === index);
}

export function resolveAnalyticsTrafficSources(rule: Json | undefined) {
  if (!isJsonObject(rule) || !Array.isArray(rule.analytics_traffic_sources)) {
    return [...defaultAnalyticsTrafficSources];
  }

  return normalizeAnalyticsTrafficSources(rule.analytics_traffic_sources);
}

export function mergeAnalyticsTrafficSources(rule: Json | undefined, trafficSources: string[]): Json {
  const base = isJsonObject(rule) ? rule : { mode: "all_required_answered" };
  return {
    ...base,
    analytics_traffic_sources: normalizeAnalyticsTrafficSources(trafficSources)
  };
}

export function getAnalyticsCountryCode(metadata: Json) {
  if (!isJsonObject(metadata)) return null;
  return (
    normalizeCountryCode(metadata.country_code) ??
    normalizeCountryCode(metadata.country) ??
    normalizeCountryCode(metadata.geo_country)
  );
}

export function matchesAnalyticsTargetCountries(metadata: Json, targetCountryCodes: string[]) {
  if (!targetCountryCodes.length) return true;
  const countryCode = getAnalyticsCountryCode(metadata);
  return Boolean(countryCode && targetCountryCodes.includes(countryCode));
}

function getStringValue(metadata: Json, key: string, carrier?: TrafficSourceCarrier) {
  if (isJsonObject(metadata)) {
    const metadataValue = metadata[key];
    if (typeof metadataValue === "string" && metadataValue.trim()) {
      return metadataValue.trim();
    }
  }

  const carrierValue = carrier?.[key as keyof TrafficSourceCarrier];
  return typeof carrierValue === "string" && carrierValue.trim() ? carrierValue.trim() : null;
}

function getTrafficSourceText(metadata: Json, carrier?: TrafficSourceCarrier) {
  return [
    getStringValue(metadata, "utm_source", carrier),
    getStringValue(metadata, "utm_medium", carrier),
    getStringValue(metadata, "utm_campaign", carrier),
    getStringValue(metadata, "utm_content", carrier),
    getStringValue(metadata, "utm_term", carrier),
    getStringValue(metadata, "source_url", carrier),
    getStringValue(metadata, "referrer", carrier),
    getStringValue(metadata, "landing_page_url", carrier)
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function hasAnyMetadataValue(metadata: Json, keys: string[]) {
  return keys.some((key) => Boolean(getStringValue(metadata, key)));
}

export function matchesAnalyticsTrafficSources(
  metadata: Json,
  targetTrafficSources: string[],
  carrier?: TrafficSourceCarrier
) {
  if (!targetTrafficSources.length) return true;

  const normalizedSources = normalizeAnalyticsTrafficSources(targetTrafficSources);
  if (!normalizedSources.length) return true;

  const sourceText = getTrafficSourceText(metadata, carrier);
  const hasMetaIdentifier = hasAnyMetadataValue(metadata, ["fbclid", "fbc", "fbp"]) || sourceText.includes("fbclid=");
  const hasGoogleIdentifier = hasAnyMetadataValue(metadata, ["gclid"]) || sourceText.includes("gclid=");
  const hasTikTokIdentifier = hasAnyMetadataValue(metadata, ["ttclid"]) || sourceText.includes("ttclid=");
  const facebookSource = /(^|[^a-z])(facebook|fb)([^a-z]|$)/.test(sourceText);
  const instagramSource = /(^|[^a-z])(instagram|ig)([^a-z]|$)/.test(sourceText);
  const metaSource = /(^|[^a-z])(meta)([^a-z]|$)/.test(sourceText) || facebookSource || instagramSource;
  const googleSource = /(^|[^a-z])(google|adwords)([^a-z]|$)/.test(sourceText);
  const tiktokSource = /(^|[^a-z])(tiktok|tt)([^a-z]|$)/.test(sourceText);

  return normalizedSources.some((source) => {
    if (source === "meta") return hasMetaIdentifier || metaSource;
    if (source === "facebook") return facebookSource;
    if (source === "instagram") return instagramSource;
    if (source === "google") return hasGoogleIdentifier || googleSource;
    if (source === "tiktok") return hasTikTokIdentifier || tiktokSource;
    return false;
  });
}

export function getRequestGeoMetadata(request?: Request) {
  if (!request) return {};

  const countryCode =
    normalizeCountryCode(request.headers.get("x-vercel-ip-country")) ??
    normalizeCountryCode(request.headers.get("cf-ipcountry"));
  const region = request.headers.get("x-vercel-ip-country-region")?.trim();
  const city = request.headers.get("x-vercel-ip-city")?.trim();

  return Object.fromEntries(
    [
      ["country_code", countryCode],
      ["country", countryCode],
      ["region", region || undefined],
      ["city", city ? safeDecodeURIComponent(city) : undefined]
    ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  ) as Record<string, string>;
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
