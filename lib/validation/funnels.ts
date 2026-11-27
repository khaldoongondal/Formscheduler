import { z } from "zod";
import { databaseIdSchema, urlStringSchema } from "@/lib/validation/fields";
import { browserTrackingSettingsSchema } from "@/lib/tracking/settings";
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
const intakeFlowItemKeySchema = z.string().regex(/^(contact:[a-z_]+|question:[0-9a-fA-F-]{36})$/);

export const funnelThemeSchema = z.object({
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  button_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  border_radius: z.coerce.number().int().min(0).max(32),
  logo_url: urlStringSchema.optional().or(z.literal("")),
  logo_alignment: z.enum(["left", "center"]).default("left")
});

/** A form's provider settings object; small and JSON only. */
export const connectionSettingsSchema = z
  .record(z.string(), z.unknown())
  .refine((value) => JSON.stringify(value).length <= 4000, "These settings are too large.")
  .transform((value) => value as { [key: string]: Json });

// Create schemas supply defaults separately so PATCH never resets omitted fields.
const funnelSchema = z.object({
  tenant_id: databaseIdSchema,
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(80).regex(/^[a-z0-9-]+$/),
  description: z.string().max(500).optional(),
  show_intro_headline: z.boolean(),
  show_intro_description: z.boolean(),
  redirect_url: urlStringSchema
    .refine(
      (url) => url.startsWith("http://") || url.startsWith("https://"),
      "Redirect URL must start with http:// or https://."
    )
    .optional(),
  ghl_connection_id: databaseIdSchema.optional().or(z.literal("")),
  calendar_id: z.string().optional(),
  slot_duration_minutes: z.coerce.number().int().min(15).max(240),
  availability_window_days: z.coerce.number().int().min(1).max(60),
  appointment_title: z.string().trim().max(160),
  opt_in_pipeline_id: z.string().optional(),
  opt_in_pipeline_stage_id: z.string().optional(),
  booked_pipeline_id: z.string().optional(),
  booked_pipeline_stage_id: z.string().optional(),
  disqualified_pipeline_id: z.string().optional(),
  disqualified_pipeline_stage_id: z.string().optional(),
  phone_pulse_enabled: z.boolean(),
  contact_fields: contactFieldSettingsSchema,
  contact_field_order: z.array(contactFieldKeySchema),
  contact_fields_per_page: z.coerce.number().int().min(1).max(contactFieldKeys.length),
  intake_flow_order: z.array(intakeFlowItemKeySchema).optional(),
  disabled_question_ids: z.array(databaseIdSchema).optional(),
  analytics_target_country_codes: z.array(z.string()).optional(),
  analytics_traffic_sources: z.array(z.string()).optional(),
  browser_tracking: browserTrackingSettingsSchema.nullable().optional(),
  opportunity_name_template: z.string().min(2).max(200),
  theme: funnelThemeSchema,
  /** Starter template the form is created from (migration 0033). Create only. */
  template_key: z.string().regex(/^[a-z_]{2,40}$/).optional()
});

export const createFunnelSchema = funnelSchema.extend({
  show_intro_headline: funnelSchema.shape.show_intro_headline.default(true),
  show_intro_description: funnelSchema.shape.show_intro_description.default(true),
  slot_duration_minutes: funnelSchema.shape.slot_duration_minutes.default(30),
  availability_window_days: funnelSchema.shape.availability_window_days.default(14),
  appointment_title: funnelSchema.shape.appointment_title.default(""),
  phone_pulse_enabled: funnelSchema.shape.phone_pulse_enabled.default(true),
  contact_fields: funnelSchema.shape.contact_fields.default(defaultContactFieldSettings),
  contact_field_order: funnelSchema.shape.contact_field_order.default(defaultContactFieldOrder),
  contact_fields_per_page: funnelSchema.shape.contact_fields_per_page.default(defaultContactFieldsPerPage),
  opportunity_name_template: funnelSchema.shape.opportunity_name_template.default("{{lead_name}}")
});

export const updateFunnelSchema = funnelSchema
  .omit({ tenant_id: true, template_key: true })
  .partial()
  .extend({
    id: databaseIdSchema,
    is_published: z.boolean().optional(),
    // Calendar and CRM choice (Sprint 3, migration 0029). Per-provider
    // settings schemas are applied in the action (P2, P3).
    calendar_provider: z.enum(["ghl", "google_calendar", "calcom", "calendly"]).optional(),
    crm_provider: z.enum(["ghl", "hubspot", "webhook"]).optional(),
    calendar_connection_id: databaseIdSchema.optional().or(z.literal("")).nullable(),
    crm_connection_id: databaseIdSchema.optional().or(z.literal("")).nullable(),
    calendar_settings: connectionSettingsSchema.optional(),
    crm_settings: connectionSettingsSchema.optional()
  });

const questionFields = z.object({
  tenant_id: databaseIdSchema,
  funnel_id: databaseIdSchema,
  stable_key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().min(2).max(200),
  help_text: z.string().max(500).nullable().optional(),
  question_type: z.enum(["text", "email", "phone", "url", "number", "single_select", "multi_select"]),
  placeholder: z.string().max(160).nullable().optional(),
  is_required: z.boolean(),
  display_order: z.coerce.number().int().min(0),
  ghl_field_key: z.string().max(120).nullable().optional(),
  ghl_custom_field_id: z.string().max(120).nullable().optional(),
  ghl_custom_field_key: z.string().max(120).nullable().optional(),
  validation: z.custom<Json>().optional()
});

export const questionSchema = questionFields.extend({
  is_required: questionFields.shape.is_required.default(true)
});

export const updateQuestionSchema = questionFields.partial().extend({
  id: databaseIdSchema
});

export const questionOptionSchema = z.object({
  tenant_id: databaseIdSchema,
  question_id: databaseIdSchema,
  stable_key: z.string().min(2).max(80).regex(/^[a-z0-9_]+$/),
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(160),
  display_order: z.coerce.number().int().min(0),
  is_disqualifying: z.boolean().default(false)
});

export const updateQuestionOrderSchema = z.object({
  question_id: databaseIdSchema,
  display_order: z.coerce.number().int().min(0)
});

const ghlConnectionFields = z.object({
  tenant_id: databaseIdSchema,
  name: z.string().min(2).max(120),
  location_id: z.string().min(2).max(160),
  calendar_id: z.string().max(160).optional(),
  private_token: z.string().max(2000).optional(),
  api_base_url: urlStringSchema,
  api_version: z.string().min(4).max(40),
  is_active: z.boolean()
});

export const ghlConnectionSchema = ghlConnectionFields.extend({
  api_base_url: ghlConnectionFields.shape.api_base_url.default("https://services.leadconnectorhq.com"),
  api_version: ghlConnectionFields.shape.api_version.default("2023-02-21"),
  is_active: ghlConnectionFields.shape.is_active.default(true)
});

export const updateGhlConnectionSchema = ghlConnectionFields.partial().extend({
  id: databaseIdSchema,
  tenant_id: databaseIdSchema
});
