import { z } from "zod";
import type { Json } from "@/lib/types/database";
import {
  contactFieldKeys,
  defaultContactFieldOrder,
  defaultContactFieldsPerPage,
  defaultContactFieldSettings
} from "@/lib/funnels/contact-fields";

export const contactFieldSettingsSchema = z
  .object({
    full_name: z.boolean(),
    phone: z.boolean(),
    first_name: z.boolean(),
    last_name: z.boolean(),
    email: z.boolean()
  })
  .refine((settings) => settings.phone || settings.email, {
    message: "Select at least phone number or email so the lead can be saved.",
    path: ["phone"]
  });
const contactFieldKeySchema = z.enum(contactFieldKeys);
const contactFieldOrderSchema = z.array(contactFieldKeySchema).default(defaultContactFieldOrder);
const intakeFlowItemKeySchema = z.string().regex(/^(contact:[a-z_]+|question:[0-9a-fA-F-]{36})$/);

export const funnelThemeSchema = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  button_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  border_radius: z.coerce.number().int().min(0).max(32),
  logo_url: z.string().url().optional().or(z.literal("")),
  logo_alignment: z.enum(["left", "center"]).default("left")
});

/** A form's provider settings object; small and JSON only. */
export const connectionSettingsSchema = z
  .record(z.unknown())
  .refine((value) => JSON.stringify(value).length <= 4000, "These settings are too large.")
  .transform((value) => value as { [key: string]: Json });

export const createFunnelSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  show_intro_headline: z.boolean().default(true),
  show_intro_description: z.boolean().default(true),
  redirect_url: z
    .string()
    .url()
    .refine(
      (url) => url.startsWith("http://") || url.startsWith("https://"),
      "Redirect URL must start with http:// or https://."
    )
    .optional(),
  ghl_connection_id: z.string().uuid().optional().or(z.literal("")),
  calendar_id: z.string().optional(),
  slot_duration_minutes: z.coerce.number().int().min(15).max(240).default(30),
  availability_window_days: z.coerce.number().int().min(1).max(60).default(14),
  appointment_title: z.string().trim().max(160).default(""),
  opt_in_pipeline_id: z.string().optional(),
  opt_in_pipeline_stage_id: z.string().optional(),
  booked_pipeline_id: z.string().optional(),
  booked_pipeline_stage_id: z.string().optional(),
  disqualified_pipeline_id: z.string().optional(),
  disqualified_pipeline_stage_id: z.string().optional(),
  phone_pulse_enabled: z.boolean().default(true),
  contact_fields: contactFieldSettingsSchema.default(defaultContactFieldSettings),
  contact_field_order: contactFieldOrderSchema,
  contact_fields_per_page: z.coerce.number().int().min(1).max(contactFieldKeys.length).default(defaultContactFieldsPerPage),
  intake_flow_order: z.array(intakeFlowItemKeySchema).optional(),
  disabled_question_ids: z.array(z.string().uuid()).optional(),
  analytics_target_country_codes: z.array(z.string()).optional(),
  analytics_traffic_sources: z.array(z.string()).optional(),
  opportunity_name_template: z.string().min(2).max(200).default("{{lead_name}}"),
  theme: funnelThemeSchema,
  /** Starter template the form is created from (migration 0033). Create only. */
  template_key: z.string().regex(/^[a-z_]{2,40}$/).optional()
});

export const updateFunnelSchema = createFunnelSchema
  .omit({ tenant_id: true, template_key: true })
  .partial()
  .extend({
    id: z.string().uuid(),
    is_published: z.boolean().optional(),
    // Calendar and CRM choice (Sprint 3, migration 0029). Per-provider
    // settings schemas are applied in the action (P2, P3).
    calendar_provider: z.enum(["ghl", "google_calendar", "calcom", "calendly"]).optional(),
    crm_provider: z.enum(["ghl", "hubspot", "webhook"]).optional(),
    calendar_connection_id: z.string().uuid().optional().or(z.literal("")).nullable(),
    crm_connection_id: z.string().uuid().optional().or(z.literal("")).nullable(),
    calendar_settings: connectionSettingsSchema.optional(),
    crm_settings: connectionSettingsSchema.optional()
  });

export const questionSchema = z.object({
  tenant_id: z.string().uuid(),
  funnel_id: z.string().uuid(),
  stable_key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().min(2).max(200),
  help_text: z.string().max(500).nullable().optional(),
  question_type: z.enum(["text", "email", "phone", "url", "number", "single_select", "multi_select"]),
  placeholder: z.string().max(160).nullable().optional(),
  is_required: z.boolean().default(true),
  display_order: z.coerce.number().int().min(0),
  ghl_field_key: z.string().max(120).nullable().optional(),
  ghl_custom_field_id: z.string().max(120).nullable().optional(),
  ghl_custom_field_key: z.string().max(120).nullable().optional(),
  validation: z.custom<Json>().optional()
});

export const updateQuestionSchema = questionSchema.partial().extend({
  id: z.string().uuid()
});

export const questionOptionSchema = z.object({
  tenant_id: z.string().uuid(),
  question_id: z.string().uuid(),
  stable_key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(160),
  display_order: z.coerce.number().int().min(0),
  is_disqualifying: z.boolean().default(false)
});

export const updateQuestionOrderSchema = z.object({
  question_id: z.string().uuid(),
  display_order: z.coerce.number().int().min(0)
});

export const ghlConnectionSchema = z.object({
  tenant_id: z.string().uuid(),
  name: z.string().min(2).max(120),
  location_id: z.string().min(2).max(160),
  calendar_id: z.string().max(160).optional(),
  private_token: z.string().max(2000).optional(),
  api_base_url: z.string().url().default("https://services.leadconnectorhq.com"),
  api_version: z.string().min(4).max(40).default("2023-02-21"),
  is_active: z.boolean().default(true)
});

export const updateGhlConnectionSchema = ghlConnectionSchema.partial().extend({
  id: z.string().uuid(),
  tenant_id: z.string().uuid()
});
