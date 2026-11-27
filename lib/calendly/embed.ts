/**
 * Builds the Calendly inline widget spec (P3.7). Pure.
 * The URL carries the lead's UTM values and FormBook's opaque reference in
 * `salesforce_uuid` (never the session id, C21). Name and email go only in
 * `prefill`, which the widget hands to its own frame; FormBook never puts
 * them in a URL.
 */
import { SCHEDULING_URL_PATTERN } from "@/lib/calendly/constants";
import type { EmbedSpec, LeadIdentity } from "@/lib/connections/types";

const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"] as const;
const UTM_CAP = 255;

export function buildCalendlyEmbed(input: {
  schedulingUrl: string;
  lead: LeadIdentity;
  tracking: Record<string, string>;
}): EmbedSpec {
  if (!SCHEDULING_URL_PATTERN.test(input.schedulingUrl)) throw new Error("calendly_invalid_scheduling_url");
  const url = new URL(input.schedulingUrl);
  // Only our own parameters are kept on the URL.
  url.search = "";
  url.hash = "";
  for (const key of UTM_KEYS) {
    const value = typeof input.tracking[key] === "string" ? input.tracking[key].trim().slice(0, UTM_CAP) : "";
    if (value) url.searchParams.set(key, value);
  }
  url.searchParams.set("salesforce_uuid", input.lead.externalRef);
  url.searchParams.set("hide_gdpr_banner", "1");

  const prefill: EmbedSpec["prefill"] = {};
  const first = input.lead.firstName?.trim();
  const last = input.lead.lastName?.trim();
  const name = input.lead.fullName?.trim() || [first, last].filter(Boolean).join(" ");
  if (name) prefill.name = name.slice(0, 200);
  if (input.lead.email?.trim()) prefill.email = input.lead.email.trim().slice(0, 254);
  if (first && last) {
    prefill.firstName = first.slice(0, 100);
    prefill.lastName = last.slice(0, 100);
  }
  return { mode: "embed", provider: "calendly", url: url.toString(), prefill };
}
