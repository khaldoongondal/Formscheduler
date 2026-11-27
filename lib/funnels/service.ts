import { unstable_noStore as noStore } from "next/cache";
import { mergeAnalyticsTargetCountryCodes, mergeAnalyticsTrafficSources } from "@/lib/analytics/country-filter";
import { assertFormLimit, planLimitMessageForTenant } from "@/lib/billing/plan-service";
import { parsePlanState, planLimitMessageFromError, shouldShowBadge } from "@/lib/billing/plans";
import { publishReadinessError } from "@/lib/funnels/publish-readiness";
import { QUESTION_NOT_FOUND_MESSAGE, questionUpdateFields } from "@/lib/funnels/question-scope";
import { buildCopySlug, checkSlug } from "@/lib/funnels/slugs";
import { getGhlConnectionForTenant } from "@/lib/ghl/connections";
import { EXTENSION_BY_MIME, sniffImageMime, type SniffedImage } from "@/lib/security/image-sniff";
import { randomSuffix } from "@/lib/security/random";
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
  /** "Powered by FormBook" badge: free tenants unless the owner switched it off. */
  show_badge: boolean;
};

type BookingFunnelBase = Omit<BookingFunnel, "questions" | "show_badge">;

/**
 * One tenant read for public pages: whether the tenant is suspended and whether
 * its forms show the badge. Falls back to the plan alone when migration 0023
 * (badge_enabled) is not applied yet.
 */
async function getPublicTenantFlags(tenantId: string): Promise<{ suspended: boolean; showBadge: boolean }> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("tenants").select("plan, badge_enabled").eq("id", tenantId).single();
  if (error?.code === "42703") {
    const fallback = await supabase.from("tenants").select("plan").eq("id", tenantId).single();
    if (fallback.error) throw new Error(fallback.error.message);
    const plan = parsePlanState(fallback.data.plan);
    return { suspended: plan === "suspended", showBadge: shouldShowBadge(plan, true) };
  }
  if (error) throw new Error(error.message);
  const plan = parsePlanState(data.plan);
  return { suspended: plan === "suspended", showBadge: shouldShowBadge(plan, data.badge_enabled) };
}

export const FOREIGN_CONNECTION_MESSAGE = "Choose a GoHighLevel connection from your own account.";
export const TAKEN_DOWN_COPY_MESSAGE = "This form was taken down and cannot be copied.";

/** Maps the connection trigger error (migration 0021) to the user message. */
function connectionMessageFromError(message: string): string | null {
  return message.includes("FORMBOOK_INVALID:ghl_connection") ? FOREIGN_CONNECTION_MESSAGE : null;
}

async function assertConnectionBelongsToTenant(connectionId: string | null | undefined, tenantId: string) {
  if (!connectionId) return;
  const connection = await getGhlConnectionForTenant(connectionId, tenantId);
  if (!connection) throw new Error(FOREIGN_CONNECTION_MESSAGE);
}

async function assertReadyToPublish(input: {
  tenantId: string;
  ghlConnectionId: string | null | undefined;
  calendarId: string | null | undefined;
}) {
  const connection = input.ghlConnectionId
    ? await getGhlConnectionForTenant(input.ghlConnectionId, input.tenantId)
    : null;
  const message = publishReadinessError({
    ghlConnectionId: connection ? connection.id : null,
    calendarId: input.calendarId,
    connectionCalendarId: connection?.calendar_id ?? null
  });
  if (message) throw new Error(message);
}

function assertSlugAllowed(slug: string) {
  const result = checkSlug(slug);
  if (!result.ok) throw new Error(result.message);
  return result.slug;
}

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
    .is("taken_down_at", null)
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

  // Suspended tenants (lapsed subscriptions) stop serving public booking pages.
  const tenantFlags = await getPublicTenantFlags(funnelBase.tenant_id);
  if (tenantFlags.suspended) return null;

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
    show_badge: tenantFlags.showBadge,
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
  parsed.slug = assertSlugAllowed(parsed.slug);
  await assertConnectionBelongsToTenant(parsed.ghl_connection_id, parsed.tenant_id);
  // New forms are always drafts (the create schema has no is_published).
  await assertFormLimit(parsed.tenant_id, "create_draft");
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

    const friendly =
      (await planLimitMessageForTenant(error.message, parsed.tenant_id)) ?? connectionMessageFromError(error.message);
    if (friendly) throw new Error(friendly);

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
  let existingTenantId: string | null = null;
  const changesConnection = Boolean(funnel.ghl_connection_id);
  const touchesConnectionField = Object.prototype.hasOwnProperty.call(funnel, "ghl_connection_id");
  const touchesCalendarField = Object.prototype.hasOwnProperty.call(funnel, "calendar_id");
  if (
    funnel.is_published === true ||
    funnel.slug !== undefined ||
    changesConnection ||
    touchesConnectionField ||
    touchesCalendarField
  ) {
    const { data: existing, error: existingError } = await supabase
      .from("funnels")
      .select("tenant_id,is_published,slug,ghl_connection_id,calendar_id")
      .eq("id", id)
      .single();
    if (existingError) throw new Error(existingError.message);
    existingTenantId = existing.tenant_id;

    // Slug rules run only when the slug changes, so existing forms keep saving.
    if (funnel.slug !== undefined) {
      funnel.slug =
        funnel.slug.trim().toLowerCase() === existing.slug ? existing.slug : assertSlugAllowed(funnel.slug);
    }
    if (changesConnection) {
      await assertConnectionBelongsToTenant(funnel.ghl_connection_id, existing.tenant_id);
    }
    const activating = funnel.is_published === true && !existing.is_published;
    const staysPublished = (funnel.is_published ?? existing.is_published) === true;
    // An Active form must be able to take bookings: checked when it is turned
    // on, and when an Active form's connection or calendar is changed.
    if (staysPublished && (activating || touchesConnectionField || touchesCalendarField)) {
      await assertReadyToPublish({
        tenantId: existing.tenant_id,
        ghlConnectionId: touchesConnectionField ? funnel.ghl_connection_id || null : existing.ghl_connection_id,
        calendarId: touchesCalendarField ? funnel.calendar_id || null : existing.calendar_id
      });
    }
    if (activating) {
      await assertFormLimit(existing.tenant_id, "activate", id);
    }
  }

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

  if (error) {
    const connectionMessage = connectionMessageFromError(error.message);
    if (connectionMessage) throw new Error(connectionMessage);
    if (planLimitMessageFromError(error.message)) {
      const tenantId = existingTenantId ?? (await getFunnelTenantId(id));
      const friendly = tenantId
        ? await planLimitMessageForTenant(error.message, tenantId)
        : planLimitMessageFromError(error.message);
      if (friendly) throw new Error(friendly);
    }
    throw new Error(error.message);
  }
  return data;
}

async function getFunnelTenantId(id: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data } = await supabase.from("funnels").select("tenant_id").eq("id", id).maybeSingle();
  return data?.tenant_id ?? null;
}

export async function duplicateFunnel(id: string) {
  const source = await getFunnelById(id);
  if (!source) throw new Error("Funnel not found.");

  if (source.taken_down_at) throw new Error(TAKEN_DOWN_COPY_MESSAGE);

  await assertFormLimit(source.tenant_id, "create_draft");

  const supabase = createServiceClient();
  const suffix = randomSuffix();
  const generatedSlug = buildCopySlug(source.slug, suffix);
  const duplicatedSlug = checkSlug(generatedSlug).ok ? generatedSlug : `form-copy-${suffix}`;

  // Explicit payload (decision D6): never copy the id, timestamps, the active
  // state or the takedown columns.
  const {
    questions,
    id: _sourceId,
    created_at: _createdAt,
    updated_at: _updatedAt,
    is_published: _isPublished,
    taken_down_at: _takenDownAt,
    taken_down_reason: _takenDownReason,
    ...sourceFunnel
  } = source;
  void [_sourceId, _createdAt, _updatedAt, _isPublished, _takenDownAt, _takenDownReason];

  const { data: funnel, error: funnelError } = await supabase
    .from("funnels")
    .insert({
      ...sourceFunnel,
      name: `${source.name} Copy`,
      slug: duplicatedSlug,
      is_published: false
    })
    .select("*")
    .single();

  if (funnelError) {
    const friendly =
      (await planLimitMessageForTenant(funnelError.message, source.tenant_id)) ??
      connectionMessageFromError(funnelError.message);
    throw new Error(friendly ?? funnelError.message);
  }

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

/** The caller's verified form. Every question and option write is limited to it. */
export type FunnelScope = { funnelId: string; tenantId: string };

export async function updateQuestion(input: unknown, scope: FunnelScope) {
  const parsed = updateQuestionSchema.parse(input);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("questions")
    .update(questionUpdateFields(parsed))
    .eq("id", parsed.id)
    .eq("funnel_id", scope.funnelId)
    .eq("tenant_id", scope.tenantId)
    .select("*")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error(QUESTION_NOT_FOUND_MESSAGE);
  return data;
}

export async function deleteQuestion(id: string, scope: FunnelScope) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("questions")
    .delete()
    .eq("id", id)
    .eq("funnel_id", scope.funnelId)
    .eq("tenant_id", scope.tenantId);
  if (error) throw new Error(error.message);
}

export async function updateQuestionOrder(input: unknown, scope: FunnelScope) {
  const parsed = updateQuestionOrderSchema.parse(input);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("questions")
    .update({ display_order: parsed.display_order })
    .eq("id", parsed.question_id)
    .eq("funnel_id", scope.funnelId)
    .eq("tenant_id", scope.tenantId);

  if (error) throw new Error(error.message);
}

async function assertQuestionBelongsToFunnel(questionId: string, scope: FunnelScope) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("questions")
    .select("id")
    .eq("id", questionId)
    .eq("funnel_id", scope.funnelId)
    .eq("tenant_id", scope.tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(QUESTION_NOT_FOUND_MESSAGE);
}

export async function upsertQuestionOption(input: unknown, scope: FunnelScope) {
  const parsed = { ...questionOptionSchema.parse(input), tenant_id: scope.tenantId };
  await assertQuestionBelongsToFunnel(parsed.question_id, scope);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("question_options")
    .upsert(parsed, { onConflict: "question_id,stable_key" })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  return data;
}

export async function deleteQuestionOption(id: string, questionId: string, scope: FunnelScope) {
  await assertQuestionBelongsToFunnel(questionId, scope);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("question_options")
    .delete()
    .eq("id", id)
    .eq("question_id", questionId)
    .eq("tenant_id", scope.tenantId);
  if (error) throw new Error(error.message);
}

export const LOGO_TYPE_MESSAGE = "Logo must be a PNG, JPG or WebP file.";
export const LOGO_SIZE_MESSAGE = "Logo must be 2MB or smaller.";

export async function uploadFunnelLogo(input: { funnelId: string; tenantId: string; file: File }) {
  const supabase = createServiceClient();
  const maxLogoBytes = 2 * 1024 * 1024;
  if (input.file.size > maxLogoBytes) {
    throw new Error(LOGO_SIZE_MESSAGE);
  }

  // SVG is not accepted (it can carry scripts). The stored type and extension
  // come from the checked bytes, never from the file name.
  const header = new Uint8Array(await input.file.slice(0, 16).arrayBuffer());
  const sniffed = sniffImageMime(header);
  if (!sniffed || sniffed !== (input.file.type as SniffedImage)) {
    throw new Error(LOGO_TYPE_MESSAGE);
  }

  const path = `${input.tenantId}/${input.funnelId}/logo.${EXTENSION_BY_MIME[sniffed]}`;
  const { error: uploadError } = await supabase.storage.from("funnel-assets").upload(path, input.file, {
    cacheControl: "3600",
    contentType: sniffed,
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
