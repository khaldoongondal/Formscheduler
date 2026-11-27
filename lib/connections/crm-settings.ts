/**
 * Per-provider CRM settings posted by the form editor (P3.4, decision C23).
 * HubSpot pipeline and stage ids are re-validated against a fresh list.
 */
import { loadHubspotPipelines } from "@/lib/connections/hubspot";
import type { CrmKind } from "@/lib/connections/types";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import { hubspotFormSettingsSchema, parseHubspotSettings, validateHubspotSettings, type HubspotFormSettings } from "@/lib/hubspot/mapping";

export const HUBSPOT_PANEL_MARKER = "hubspot_panel";

function sameSettings(a: HubspotFormSettings, b: HubspotFormSettings) {
  return (
    a.deal_on_lead === b.deal_on_lead &&
    a.deal_on_booked === b.deal_on_booked &&
    a.pipeline_id === b.pipeline_id &&
    a.lead_stage_id === b.lead_stage_id &&
    a.booked_stage_id === b.booked_stage_id &&
    a.disqualified_stage_id === b.disqualified_stage_id
  );
}

/** Reads the HubSpot panel fields. Pure apart from FormData. */
export function hubspotSettingsFromForm(formData: FormData): HubspotFormSettings {
  const parsed = hubspotFormSettingsSchema.safeParse({
    deal_on_lead: formData.get("hubspot_deal_on_lead") === "on",
    deal_on_booked: formData.get("hubspot_deal_on_booked") === "on",
    pipeline_id: String(formData.get("hubspot_pipeline_id") ?? ""),
    lead_stage_id: String(formData.get("hubspot_lead_stage_id") ?? ""),
    booked_stage_id: String(formData.get("hubspot_booked_stage_id") ?? ""),
    disqualified_stage_id: String(formData.get("hubspot_disqualified_stage_id") ?? "")
  });
  if (!parsed.success) throw new Error(HUBSPOT_COPY.choosePipeline);
  return parsed.data;
}

/**
 * The crm_settings to save, or undefined to keep the stored value. A changed
 * CRM connection without its panel resets the settings.
 */
export async function crmSettingsFromForm(input: {
  formData: FormData;
  tenantId: string;
  crmProvider: CrmKind;
  crmConnectionId: string | null;
  saved: { crmProvider: CrmKind; crmConnectionId: string | null; crmSettings: unknown };
}): Promise<Record<string, unknown> | undefined> {
  const { formData, crmProvider, crmConnectionId, saved } = input;
  const connectionChanged = crmProvider !== saved.crmProvider || (crmConnectionId ?? null) !== (saved.crmConnectionId ?? null);

  if (crmProvider === "hubspot" && formData.has(HUBSPOT_PANEL_MARKER) && crmConnectionId && !connectionChanged) {
    const next = hubspotSettingsFromForm(formData);
    if (sameSettings(next, parseHubspotSettings(saved.crmSettings))) return undefined;
    if (next.pipeline_id || next.lead_stage_id || next.booked_stage_id || next.disqualified_stage_id) {
      const result = await loadHubspotPipelines(input.tenantId, crmConnectionId);
      if (!result.ok) throw new Error(HUBSPOT_COPY.pipelinesLoadFailed);
      if (!validateHubspotSettings(next, result.pipelines)) throw new Error(HUBSPOT_COPY.choosePipeline);
    }
    return { ...next };
  }

  if (connectionChanged) return {};
  return undefined;
}
