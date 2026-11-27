import Link from "next/link";
import { HUBSPOT_PANEL_MARKER } from "@/lib/connections/crm-settings";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import type { HubspotFormSettings, HubspotPipeline } from "@/lib/hubspot/mapping";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const inputClass = selectClass;

function StageSelect({
  id,
  label,
  value,
  pipelines,
  optional
}: {
  id: string;
  label: string;
  value: string | null;
  pipelines: HubspotPipeline[];
  optional?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-slate-950">
        {label}
      </label>
      <select id={id} name={id} className={selectClass} defaultValue={value ?? ""}>
        <option value="">{optional ? HUBSPOT_COPY.noStage : HUBSPOT_COPY.stagePlaceholder}</option>
        {/* Stages of every pipeline, grouped; the save checks they belong to the chosen pipeline. */}
        {pipelines.map((pipeline) => (
          <optgroup key={pipeline.id} label={pipeline.label}>
            {pipeline.stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** HubSpot fields in the form editor (P3.4). Pipelines were loaded server-side for the saved connection. */
export function HubspotPanel({
  pipelines,
  settings,
  dealNameTemplate
}: {
  pipelines: HubspotPipeline[] | null;
  settings: HubspotFormSettings;
  dealNameTemplate: string;
}) {
  return (
    <div className="space-y-4">
      <input type="hidden" name={HUBSPOT_PANEL_MARKER} value="1" />
      <p className="text-sm leading-6 text-slate-600">{HUBSPOT_COPY.panelIntro}</p>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" name="hubspot_deal_on_lead" defaultChecked={settings.deal_on_lead} />
        {HUBSPOT_COPY.dealOnLead}
      </label>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" name="hubspot_deal_on_booked" defaultChecked={settings.deal_on_booked} />
        {HUBSPOT_COPY.dealOnBooked}
      </label>
      {pipelines === null ? (
        <>
          {/* Keeps the saved choice when the list cannot load. */}
          <input type="hidden" name="hubspot_pipeline_id" value={settings.pipeline_id ?? ""} />
          <input type="hidden" name="hubspot_lead_stage_id" value={settings.lead_stage_id ?? ""} />
          <input type="hidden" name="hubspot_booked_stage_id" value={settings.booked_stage_id ?? ""} />
          <input type="hidden" name="hubspot_disqualified_stage_id" value={settings.disqualified_stage_id ?? ""} />
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">{HUBSPOT_COPY.pipelinesLoadFailed}</p>
        </>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="hubspot_pipeline_id" className="text-sm font-medium text-slate-950">
              {HUBSPOT_COPY.pipelineLabel}
            </label>
            <select id="hubspot_pipeline_id" name="hubspot_pipeline_id" className={selectClass} defaultValue={settings.pipeline_id ?? ""}>
              <option value="">{HUBSPOT_COPY.pipelinePlaceholder}</option>
              {pipelines.map((pipeline) => (
                <option key={pipeline.id} value={pipeline.id}>
                  {pipeline.label}
                </option>
              ))}
            </select>
          </div>
          <StageSelect id="hubspot_lead_stage_id" label={HUBSPOT_COPY.leadStageLabel} value={settings.lead_stage_id} pipelines={pipelines} />
          <StageSelect id="hubspot_booked_stage_id" label={HUBSPOT_COPY.bookedStageLabel} value={settings.booked_stage_id} pipelines={pipelines} />
          <StageSelect
            id="hubspot_disqualified_stage_id"
            label={HUBSPOT_COPY.disqualifiedStageLabel}
            value={settings.disqualified_stage_id}
            pipelines={pipelines}
            optional
          />
        </div>
      )}
      <div className="space-y-2">
        <label htmlFor="hubspot_deal_name_template" className="text-sm font-medium text-slate-950">
          {HUBSPOT_COPY.dealNameLabel}
        </label>
        <input
          id="hubspot_deal_name_template"
          name="hubspot_deal_name_template"
          defaultValue={dealNameTemplate}
          maxLength={200}
          className={inputClass}
        />
        <p className="text-xs leading-5 text-slate-500">{HUBSPOT_COPY.dealNameHelp}</p>
      </div>
    </div>
  );
}

/** Webhook note in the form editor (P3.5): nothing to set per form. */
export function WebhookPanel({ connectionId }: { connectionId: string | null }) {
  return (
    <p className="text-xs leading-5 text-slate-500">
      {WEBHOOK_COPY.intro}{" "}
      {connectionId ? (
        <Link href={`/admin/connections/${connectionId}/deliveries`} className="font-medium underline underline-offset-2">
          {WEBHOOK_COPY.deliveryLog}
        </Link>
      ) : null}
    </p>
  );
}
