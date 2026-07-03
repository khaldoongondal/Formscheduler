import { unstable_noStore as noStore } from "next/cache";
import { mergeAnalyticsTargetCountryCodes, mergeAnalyticsTrafficSources } from "@/lib/analytics/country-filter";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel, Question, QuestionOption } from "@/lib/types/database";
import { mergeContactFieldSettings, resolveContactFieldConfig } from "@/lib/funnels/contact-fields";
import {
  createFunnelSchema,
  questionOptionSchema,
  questionSchema,
  updateFunnelSchema,
  updateQuestionOrderSchema,
  updateQuestionSchema
} from "@/lib/validation/funnels";

export interface FunnelWithQuestions extends Funnel {
  questions: Array<Question & { options: QuestionOption[] }>;
}

export interface BookingQuestion {
  id: string;
  tenant_id: string;
  funnel_id: string;
  stable_key: string;
  label: string;
  help_text: string | null;
  question_type: Question["question_type"];
  placeholder: string | null;
  is_required: boolean;
  display_order: number;
  validation: Question["validation"];
  options: Array<Pick<QuestionOption, "id" | "tenant_id" | "question_id" | "stable_key" | "label" | "value" | "display_order" | "is_disqualifying">>;
}

export type BookingFunnel = Pick<
  Funnel,
  | "id"
  | "tenant_id"
  | "name"
  | "slug"
  | "description"
  | "is_published"
  | "logo_url"
  | "logo_alignment"
  | "show_intro_headline"
  | "show_intro_description"
  | "primary_color"
  | "accent_color"
  | "button_color"
  | "border_radius"
  | "phone_pulse_enabled"
  | "slot_duration_minutes"
  | "appointment_title"
  | "redirect_url"
  | "qualification_rule"
> & {
  questions: BookingQuestion[];
};

type BookingFunnelBase = Omit<BookingFunnel, "questions">;

type FunnelSlugRow = Pick<
  Funnel,
  | "id"
  | "tenant_id"
  | "name"
  | "slug"
  | "description"
  | "is_published"
  | "logo_url"
  | "primary_color"
  | "accent_color"
  | "button_color"
  | "border_radius"
  | "phone_pulse_enabled"
  | "slot_duration_minutes"
  | "appointment_title"
  | "redirect_url"
  | "qualification_rule"
> &
  Partial<Pick<Funnel, "show_intro_headline" | "show_intro_description" | "logo_alignment">>;

function normalizeBookingFunnelBase(row: FunnelSlugRow): BookingFunnelBase {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    is_published: row.is_published,
    logo_url: row.logo_url,
    logo_alignment: row.logo_alignment ?? "left",
    show_intro_headline: row.show_intro_headline ?? true,
    show_intro_description: row.show_intro_description ?? true,
    primary_color: row.primary_color,
    accent_color: row.accent_color,
    button_color: row.button_color,
    border_radius: row.border_radius,
    phone_pulse_enabled: row.phone_pulse_enabled,
    slot_duration_minutes: row.slot_duration_minutes,
    appointment_title: row.appointment_title,
    redirect_url: row.redirect_url,
    qualification_rule: row.qualification_rule
  };
}

export async function listFunnels(tenantId?: string) {
  noStore();
  const supabase = createServiceClient();
  let query = supabase.from("funnels").select("*").order("created_at", { ascending: false });

  if (tenantId) {
    query = query.eq("tenant_id", tenantId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

export async function getFunnelBySlug(slug: string): Promise<BookingFunnel | null> {
  noStore();
  const supabase = createServiceClient();
  const funnelSelect =
    "id,tenant_id,name,slug,description,is_published,logo_url,logo_alignment,show_intro_headline,show_intro_description,primary_color,accent_color,button_color,border_radius,phone_pulse_enabled,slot_duration_minutes,appointment_title,redirect_url,qualification_rule";
  const fallbackWithoutLogoAlignmentSelect =
    "id,tenant_id,name,slug,description,is_published,logo_url,show_intro_headline,show_intro_description,primary_color,accent_color,button_color,border_radius,phone_pulse_enabled,slot_duration_minutes,appointment_title,redirect_url,qualification_rule";
  const fallbackFunnelSelect =
    "id,tenant_id,name,slug,description,is_published,logo_url,primary_color,accent_color,button_color,border_radius,phone_pulse_enabled,slot_duration_minutes,appointment_title,redirect_url,qualification_rule";

  const { data: funnel, error: initialFunnelError } = await supabase
    .from("funnels")
    .select(funnelSelect)
    .eq("slug", slug)
    .eq("is_published", true)
    .single();
  let funnelBase = funnel ? normalizeBookingFunnelBase(funnel as FunnelSlugRow) : null;
  let funnelError = initialFunnelError;

  if (funnelError?.code === "42703") {
    const fallbackWithoutLogoAlignmentResult = await supabase
      .from("funnels")
      .select(fallbackWithoutLogoAlignmentSelect)
      .eq("slug", slug)
      .eq("is_published", true)
      .single();

    funnelBase = fallbackWithoutLogoAlignmentResult.data
      ? normalizeBookingFunnelBase(fallbackWithoutLogoAlignmentResult.data as FunnelSlugRow)
      : null;
    funnelError = fallbackWithoutLogoAlignmentResult.error;

    if (funnelError?.code === "42703") {
      const fallbackResult = await supabase
        .from("funnels")
        .select(fallbackFunnelSelect)
        .eq("slug", slug)
        .eq("is_published", true)
        .single();

      funnelBase = fallbackResult.data ? normalizeBookingFunnelBase(fallbackResult.data as FunnelSlugRow) : null;
      funnelError = fallbackResult.error;
    }
  }

  if (funnelError) {
    if (funnelError.code === "PGRST116") return null;
    throw new Error(funnelError.message);
  }

  if (!funnelBase) return null;

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("id,tenant_id,funnel_id,stable_key,label,help_text,question_type,placeholder,is_required,display_order,validation")
    .eq("funnel_id", funnelBase.id)
    .order("display_order", { ascending: true });

  if (questionsError) throw new Error(questionsError.message);

  const questionIds = questions.map((question) => question.id);
  let options: BookingQuestion["options"] = [];
  if (questionIds.length) {
    const optionsResult = await supabase
      .from("question_options")
      .select("id,tenant_id,question_id,stable_key,label,value,display_order,is_disqualifying")
      .in("question_id", questionIds)
      .order("display_order", { ascending: true });

    if (optionsResult.error?.code === "42703") {
      const fallbackOptionsResult = await supabase
        .from("question_options")
        .select("id,tenant_id,question_id,stable_key,label,value,display_order")
        .in("question_id", questionIds)
        .order("display_order", { ascending: true });

      if (fallbackOptionsResult.error) throw new Error(fallbackOptionsResult.error.message);
      options = fallbackOptionsResult.data.map((option) => ({
        ...option,
        is_disqualifying: false
      }));
    } else {
      if (optionsResult.error) throw new Error(optionsResult.error.message);
      options = optionsResult.data;
    }
  }

  return {
    ...funnelBase,
    questions: questions.map((question) => ({
      ...question,
      options: options.filter((option) => option.question_id === question.id)
    }))
  };
}

export async function getFunnelById(id: string): Promise<FunnelWithQuestions | null> {
  noStore();
  const supabase = createServiceClient();
  const { data: funnel, error: funnelError } = await supabase
    .from("funnels")
    .select("*")
    .eq("id", id)
    .single();

  if (funnelError) {
    if (funnelError.code === "PGRST116") return null;
    throw new Error(funnelError.message);
  }

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("*")
    .eq("funnel_id", funnel.id)
    .order("display_order", { ascending: true });

  if (questionsError) throw new Error(questionsError.message);

  const questionIds = questions.map((question) => question.id);
  const { data: options, error: optionsError } = questionIds.length
    ? await supabase
        .from("question_options")
        .select("*")
        .in("question_id", questionIds)
        .order("display_order", { ascending: true })
    : { data: [], error: null };

  if (optionsError) throw new Error(optionsError.message);

  return {
    ...funnel,
    questions: questions.map((question) => ({
      ...question,
      options: options.filter((option) => option.question_id === question.id)
    }))
  };
}

function getMissingInsertColumn(message: string, payload: Record<string, unknown>) {
  const normalizedMessage = message.toLowerCase();
  if (
    !normalizedMessage.includes("schema cache") &&
    !normalizedMessage.includes("could not find") &&
    !normalizedMessage.includes("column")
  ) {
    return null;
  }

  return Object.keys(payload).find((column) => normalizedMessage.includes(column.toLowerCase())) ?? null;
}

export async function createFunnel(input: unknown) {
  const parsed = createFunnelSchema.parse(input);
  const supabase = createServiceClient();
  const {
    contact_field_order: contactFieldOrder,
    contact_fields: contactFields,
    contact_fields_per_page: contactFieldsPerPage,
    disabled_question_ids: disabledQuestionIds,
    intake_flow_order: intakeFlowOrder,
    theme,
    ...funnel
  } = parsed;
  const insertPayload: Record<string, unknown> = {
    ...funnel,
    ghl_connection_id: funnel.ghl_connection_id || null,
    calendar_id: funnel.calendar_id || null,
    opt_in_pipeline_id: funnel.opt_in_pipeline_id || null,
    opt_in_pipeline_stage_id: funnel.opt_in_pipeline_stage_id || null,
    booked_pipeline_id: funnel.booked_pipeline_id || null,
    booked_pipeline_stage_id: funnel.booked_pipeline_stage_id || null,
    disqualified_pipeline_id: funnel.disqualified_pipeline_id || null,
    disqualified_pipeline_stage_id: funnel.disqualified_pipeline_stage_id || null,
    appointment_title: funnel.appointment_title,
    redirect_url: funnel.redirect_url || null,
    phone_pulse_enabled: funnel.phone_pulse_enabled,
    qualification_rule: mergeContactFieldSettings(
      undefined,
      contactFields,
      contactFieldOrder,
      contactFieldsPerPage,
      intakeFlowOrder,
      disabledQuestionIds
    ),
    logo_url: theme.logo_url || null,
    logo_alignment: theme.logo_alignment,
    primary_color: theme.primary_color,
    accent_color: theme.accent_color,
    button_color: theme.button_color,
    border_radius: theme.border_radius,
    slot_duration_minutes: funnel.slot_duration_minutes ?? 30,
    availability_window_days: funnel.availability_window_days ?? 14
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data, error } = await supabase.from("funnels").insert(insertPayload).select("*").single();
    if (!error) return data;

    const missingColumn = getMissingInsertColumn(error.message, insertPayload);
    if (!missingColumn) throw new Error(error.message);
    delete insertPayload[missingColumn];
  }

  throw new Error("Unable to create funnel because Supabase is missing multiple funnel columns.");
}

export async function updateFunnel(input: unknown) {
  const parsed = updateFunnelSchema.parse(input);
  const supabase = createServiceClient();
  const {
    contact_field_order: contactFieldOrder,
    contact_fields: contactFields,
    contact_fields_per_page: contactFieldsPerPage,
    disabled_question_ids: disabledQuestionIds,
    intake_flow_order: intakeFlowOrder,
    analytics_target_country_codes: analyticsTargetCountryCodes,
    analytics_traffic_sources: analyticsTrafficSources,
    id,
    theme,
    ...funnel
  } = parsed;
  const hasQualificationRuleUpdates =
    contactFields ||
    contactFieldOrder ||
    contactFieldsPerPage ||
    intakeFlowOrder ||
    disabledQuestionIds ||
    analyticsTargetCountryCodes ||
    analyticsTrafficSources;
  const existingQualificationRule = hasQualificationRuleUpdates
    ? await supabase.from("funnels").select("qualification_rule").eq("id", id).single()
    : null;

  if (existingQualificationRule?.error) throw new Error(existingQualificationRule.error.message);

  const updatePayload = {
    ...funnel,
    ...(Object.prototype.hasOwnProperty.call(funnel, "ghl_connection_id")
      ? { ghl_connection_id: funnel.ghl_connection_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "calendar_id")
      ? { calendar_id: funnel.calendar_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "opt_in_pipeline_id")
      ? { opt_in_pipeline_id: funnel.opt_in_pipeline_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "opt_in_pipeline_stage_id")
      ? { opt_in_pipeline_stage_id: funnel.opt_in_pipeline_stage_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "booked_pipeline_id")
      ? { booked_pipeline_id: funnel.booked_pipeline_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "booked_pipeline_stage_id")
      ? { booked_pipeline_stage_id: funnel.booked_pipeline_stage_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "disqualified_pipeline_id")
      ? { disqualified_pipeline_id: funnel.disqualified_pipeline_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "disqualified_pipeline_stage_id")
      ? { disqualified_pipeline_stage_id: funnel.disqualified_pipeline_stage_id || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "appointment_title")
      ? { appointment_title: funnel.appointment_title ?? "" }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "redirect_url")
      ? { redirect_url: funnel.redirect_url || null }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(funnel, "phone_pulse_enabled")
      ? { phone_pulse_enabled: funnel.phone_pulse_enabled }
      : {}),
    ...(hasQualificationRuleUpdates
      ? {
          qualification_rule: (() => {
            const currentConfig = resolveContactFieldConfig(existingQualificationRule?.data?.qualification_rule);
            const nextRule = mergeContactFieldSettings(
              existingQualificationRule?.data?.qualification_rule,
              contactFields ?? currentConfig.settings,
              contactFieldOrder ?? currentConfig.order,
              contactFieldsPerPage ?? currentConfig.fieldsPerPage,
              intakeFlowOrder,
              disabledQuestionIds
            );
            const withCountryFilter = analyticsTargetCountryCodes
              ? mergeAnalyticsTargetCountryCodes(nextRule, analyticsTargetCountryCodes)
              : nextRule;
            return analyticsTrafficSources
              ? mergeAnalyticsTrafficSources(withCountryFilter, analyticsTrafficSources)
              : withCountryFilter;
          })()
        }
      : {}),
    ...(theme
      ? {
          logo_url: theme.logo_url || null,
          logo_alignment: theme.logo_alignment,
          primary_color: theme.primary_color,
          accent_color: theme.accent_color,
          button_color: theme.button_color,
          border_radius: theme.border_radius
        }
      : {})
  };

  const { data, error } = await supabase
    .from("funnels")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function duplicateFunnel(id: string) {
  const source = await getFunnelById(id);
  if (!source) throw new Error("Funnel not found.");

  const supabase = createServiceClient();
  const duplicatedSlug = `${source.slug}-copy-${Date.now().toString(36)}`;
  const { questions, ...sourceFunnel } = source;

  const { data: funnel, error: funnelError } = await supabase
    .from("funnels")
    .insert({
      ...sourceFunnel,
      id: undefined,
      name: `${source.name} Copy`,
      slug: duplicatedSlug,
      is_published: false,
      created_at: undefined,
      updated_at: undefined
    })
    .select("*")
    .single();

  if (funnelError) throw new Error(funnelError.message);

  for (const question of questions) {
    const { options, ...sourceQuestion } = question;
    const { data: duplicatedQuestion, error: questionError } = await supabase
      .from("questions")
      .insert({
        ...sourceQuestion,
        id: undefined,
        funnel_id: funnel.id,
        created_at: undefined,
        updated_at: undefined
      })
      .select("*")
      .single();

    if (questionError) throw new Error(questionError.message);

    if (options.length) {
      const { error: optionError } = await supabase.from("question_options").insert(
        options.map((option) => ({
          ...option,
          id: undefined,
          question_id: duplicatedQuestion.id,
          created_at: undefined,
          updated_at: undefined
        }))
      );

      if (optionError) throw new Error(optionError.message);
    }
  }

  return funnel;
}

export async function deleteFunnel(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("funnels").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function upsertQuestion(input: unknown) {
  const parsed = questionSchema.parse(input);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("questions")
    .upsert(parsed, { onConflict: "funnel_id,stable_key" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function updateQuestion(input: unknown) {
  const parsed = updateQuestionSchema.parse(input);
  const { id, ...payload } = parsed;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("questions")
    .update(payload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteQuestion(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("questions").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function updateQuestionOrder(input: unknown) {
  const parsed = updateQuestionOrderSchema.parse(input);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("questions")
    .update({ display_order: parsed.display_order })
    .eq("id", parsed.question_id);

  if (error) throw new Error(error.message);
}

export async function upsertQuestionOption(input: unknown) {
  const parsed = questionOptionSchema.parse(input);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("question_options")
    .upsert(parsed, { onConflict: "question_id,stable_key" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteQuestionOption(id: string) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("question_options").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function uploadFunnelLogo(input: { funnelId: string; tenantId: string; file: File }) {
  const supabase = createServiceClient();
  const allowedTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
  const maxLogoBytes = 2 * 1024 * 1024;
  if (!allowedTypes.has(input.file.type)) {
    throw new Error("Logo must be a PNG, JPG, WebP, or SVG file.");
  }
  if (input.file.size > maxLogoBytes) {
    throw new Error("Logo must be 2MB or smaller.");
  }

  const extension = input.file.name.split(".").pop()?.toLowerCase() ?? "png";
  const path = `${input.tenantId}/${input.funnelId}/logo.${extension}`;
  const { error: uploadError } = await supabase.storage.from("funnel-assets").upload(path, input.file, {
    cacheControl: "3600",
    contentType: input.file.type,
    upsert: true
  });

  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from("funnel-assets").getPublicUrl(path);
  const { error: updateError } = await supabase
    .from("funnels")
    .update({ logo_url: data.publicUrl })
    .eq("id", input.funnelId);

  if (updateError) throw new Error(updateError.message);

  return data.publicUrl;
}
