/**
 * HubSpot payload builders and parsers (P3.4). Pure: zod only.
 */
import { z } from "zod";
import type { CrmEventType, FormBookEvent } from "@/lib/connections/types";
import { classifyHttpOutcome } from "@/lib/crm/retry";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";

export type HubspotFormSettings = {
  deal_on_lead: boolean;
  deal_on_booked: boolean;
  pipeline_id: string | null;
  lead_stage_id: string | null;
  booked_stage_id: string | null;
  disqualified_stage_id: string | null;
};

const idSchema = z
  .string()
  .trim()
  .max(100)
  .regex(/^[A-Za-z0-9_-]*$/)
  .transform((value) => (value ? value : null))
  .nullable()
  .optional()
  .transform((value) => value ?? null);

export const hubspotFormSettingsSchema: z.ZodType<HubspotFormSettings> = z.object({
  deal_on_lead: z.boolean().optional().default(false),
  deal_on_booked: z.boolean().optional().default(false),
  pipeline_id: idSchema,
  lead_stage_id: idSchema,
  booked_stage_id: idSchema,
  disqualified_stage_id: idSchema
});

export function parseHubspotSettings(value: unknown): HubspotFormSettings {
  const parsed = hubspotFormSettingsSchema.safeParse(value ?? {});
  return parsed.success
    ? parsed.data
    : { deal_on_lead: false, deal_on_booked: false, pipeline_id: null, lead_stage_id: null, booked_stage_id: null, disqualified_stage_id: null };
}

function clean(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Standard contact properties; empty values are left out so they never wipe HubSpot data. */
export function contactProperties(lead: FormBookEvent["lead"]): Record<string, string> {
  let first = clean(lead.first_name);
  let last = clean(lead.last_name);
  const full = clean(lead.full_name);
  if (!first && !last && full) {
    const parts = full.split(/\s+/);
    first = parts[0] ?? "";
    last = parts.slice(1).join(" ");
  }
  const properties: Record<string, string> = {};
  const email = clean(lead.email).toLowerCase();
  if (email) properties.email = email;
  if (first) properties.firstname = first.slice(0, 200);
  if (last) properties.lastname = last.slice(0, 200);
  const phone = clean(lead.phone);
  if (phone) properties.phone = phone.slice(0, 50);
  return properties;
}

export function noteTitleFor(type: CrmEventType): string {
  return HUBSPOT_COPY.noteTitles[type];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NOTE_CAP = 60_000;

function answerText(value: FormBookEvent["answers"][number]["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null) return "";
  return String(value);
}

/** HTML-escaped lines joined with <br>; capped at 60,000 characters. */
export function noteBody(event: FormBookEvent): string {
  const lines: string[] = [noteTitleFor(event.type), `Lead id: ${event.lead.id}`, `Form: ${event.form.name}`, `Status: ${event.lead.status}`];
  if (event.booking) {
    lines.push(`Booking: ${event.booking.start} (${event.booking.timezone})`);
    if (event.booking.meeting_url) lines.push(`Meeting link: ${event.booking.meeting_url}`);
  }
  if (event.disqualification?.reasons.length) {
    lines.push("", "Disqualified by:");
    for (const reason of event.disqualification.reasons) lines.push(`${reason.question}: ${reason.answer}`);
  }
  if (event.answers.length) {
    lines.push("", "Answers:");
    for (const answer of event.answers) lines.push(`${answer.question}: ${answerText(answer.value)}`);
  }
  const trackingLines = Object.entries(event.tracking)
    .filter(([key, value]) => key !== "split_test" && typeof value === "string" && value)
    .map(([key, value]) => `${key}: ${value as string}`);
  if (event.tracking.split_test) {
    trackingLines.push(`split_test: ${event.tracking.split_test.id}${event.tracking.split_test.variant ? ` (${event.tracking.split_test.variant})` : ""}`);
  }
  if (trackingLines.length) lines.push("", "Tracking:", ...trackingLines);

  let body = "";
  for (const line of lines) {
    const next = (body ? "<br>" : "") + escapeHtml(line);
    if (body.length + next.length > NOTE_CAP) break;
    body += next;
  }
  return body;
}

export type DealPlan = { action: "none" } | { action: "create" | "move"; stageId: string };

export function dealPlan(event: FormBookEvent, settings: HubspotFormSettings, hasDeal: boolean): DealPlan {
  const pipeline = settings.pipeline_id;
  if (!pipeline) return { action: "none" };
  if (event.type === "lead.captured") {
    if (settings.deal_on_lead && !hasDeal && settings.lead_stage_id) return { action: "create", stageId: settings.lead_stage_id };
    return { action: "none" };
  }
  if (event.type === "lead.booked") {
    if (!settings.deal_on_booked || !settings.booked_stage_id) return { action: "none" };
    return { action: hasDeal ? "move" : "create", stageId: settings.booked_stage_id };
  }
  if (event.type === "lead.disqualified") {
    if (hasDeal && settings.disqualified_stage_id) return { action: "move", stageId: settings.disqualified_stage_id };
    return { action: "none" };
  }
  return { action: "none" };
}

/** Same tokens as buildOpportunityName; at most 200 characters. */
export function dealName(template: string, event: FormBookEvent): string {
  const lead = event.lead;
  const compact = [clean(lead.first_name), clean(lead.last_name)].filter(Boolean).join(" ");
  const leadName = clean(lead.full_name) || compact || clean(lead.email) || clean(lead.phone) || "Lead";
  const name = (template || "{{lead_name}}")
    .replaceAll("{{lead_name}}", leadName)
    .replaceAll("{{lead_full_name}}", leadName)
    .replaceAll("{{first_name}}", clean(lead.first_name))
    .replaceAll("{{last_name}}", clean(lead.last_name))
    .replaceAll("{{email}}", clean(lead.email))
    .replaceAll("{{phone}}", clean(lead.phone))
    .replaceAll("{{funnel_name}}", event.form.name)
    .replaceAll("{{funnel_slug}}", event.form.slug)
    .replace(/\s+/g, " ")
    .trim();
  return (name || leadName).slice(0, 200);
}

/** 429 and 5xx retry; 2xx sent; other statuses (400, 401, 403, 404) fail. */
export function hubspotOutcome(status: number | null): "sent" | "retry" | "failed" {
  return classifyHttpOutcome(status);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function idOf(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9A-Za-z_-]{1,64}$/.test(value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** U20: batch/upsert answers `{ results: [{ id, ... }] }`. */
export function parseUpsertResponse(body: unknown): string | null {
  const results = asRecord(body).results;
  if (!Array.isArray(results) || !results.length) return null;
  return idOf(asRecord(results[0]).id);
}

export function parseObjectId(body: unknown): string | null {
  return idOf(asRecord(body).id);
}

/** Search response `{ total, results: [{ id }] }`. */
export function parseSearchFirstId(body: unknown): string | null {
  const results = asRecord(body).results;
  if (!Array.isArray(results) || !results.length) return null;
  return idOf(asRecord(results[0]).id);
}

export type HubspotPipeline = { id: string; label: string; stages: Array<{ id: string; label: string }> };

export function parsePipelines(body: unknown): HubspotPipeline[] {
  const results = asRecord(body).results;
  if (!Array.isArray(results)) return [];
  const pipelines: HubspotPipeline[] = [];
  for (const item of results) {
    const record = asRecord(item);
    const id = idOf(record.id);
    if (!id || record.archived === true) continue;
    const stages = Array.isArray(record.stages)
      ? record.stages
          .map((stage) => asRecord(stage))
          .filter((stage) => stage.archived !== true)
          .map((stage) => ({ id: idOf(stage.id), label: typeof stage.label === "string" ? stage.label : "" }))
          .filter((stage): stage is { id: string; label: string } => Boolean(stage.id))
          .map((stage) => ({ id: stage.id, label: stage.label || stage.id }))
      : [];
    pipelines.push({ id, label: typeof record.label === "string" && record.label ? record.label : id, stages });
  }
  return pipelines;
}

/** U21: GET /account-info/v3/details answers `{ portalId }`. */
export function parsePortalId(body: unknown): string | null {
  return idOf(asRecord(body).portalId);
}

/** Checks a chosen pipeline and stages against a fresh list. */
export function validateHubspotSettings(settings: HubspotFormSettings, pipelines: HubspotPipeline[]): boolean {
  const needsPipeline = settings.deal_on_lead || settings.deal_on_booked || Boolean(settings.disqualified_stage_id);
  if (!settings.pipeline_id) return !needsPipeline && !settings.lead_stage_id && !settings.booked_stage_id;
  const pipeline = pipelines.find((item) => item.id === settings.pipeline_id);
  if (!pipeline) return false;
  const stageIds = new Set(pipeline.stages.map((stage) => stage.id));
  return [settings.lead_stage_id, settings.booked_stage_id, settings.disqualified_stage_id].every(
    (stage) => stage === null || stageIds.has(stage)
  );
}
