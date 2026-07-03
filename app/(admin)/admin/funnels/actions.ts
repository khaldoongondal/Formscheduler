"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { normalizeAnalyticsTargetCountryCodes, normalizeAnalyticsTrafficSources } from "@/lib/analytics/country-filter";
import { requireTenantRole } from "@/lib/auth/tenant";
import {
  contactFieldKeys,
  defaultContactFieldOrder,
  intakeFlowItemToKey,
  normalizeContactFieldOrder,
  normalizeContactFieldsPerPage,
  normalizeDisabledQuestionIds,
  resolveDisabledQuestionIds,
  resolveIntakeFlowEditorOrder,
  resolveContactFieldConfig,
  type ContactFieldKey
} from "@/lib/funnels/contact-fields";
import {
  mergeQuestionDisqualificationRule,
  validateQuestionDisqualificationRule,
  type QuestionDisqualificationOperator
} from "@/lib/funnels/disqualification";
import type { QuestionType } from "@/lib/types/database";
import {
  createFunnel,
  deleteFunnel,
  deleteQuestion,
  deleteQuestionOption,
  duplicateFunnel,
  getFunnelById,
  updateFunnel,
  updateQuestionOrder,
  updateQuestion,
  uploadFunnelLogo,
  upsertQuestion,
  upsertQuestionOption
} from "@/lib/funnels/service";

function optionalString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : undefined;
}

function trimmedString(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function nullableString(formData: FormData, key: string) {
  const value = String(formData.get(key) ?? "").trim();
  return value.length ? value : null;
}

function adminActionErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown admin action error.";
  const normalized = message.toLowerCase();

  if (normalized.includes("redirect_url")) {
    return "Supabase needs migration 0007_funnel_redirect_url.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("phone_pulse_enabled")) {
    return "Supabase needs migration 0008_phone_pulse_setting.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("show_intro_headline") || normalized.includes("show_intro_description")) {
    return "Supabase needs migration 0012_intro_visibility_settings.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("logo_alignment")) {
    return "Supabase needs migration 0013_logo_alignment.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("availability_window_days")) {
    return "Supabase needs migration 0009_availability_window_days.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("opportunity_name_template")) {
    return "Supabase needs migration 0004_scheduler_hardening.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (
    normalized.includes("disqualified_pipeline_id") ||
    normalized.includes("disqualified_pipeline_stage_id") ||
    normalized.includes("is_disqualifying") ||
    normalized.includes("disqualified_at")
  ) {
    return "Supabase needs migration 0011_disqualification_rules.sql before this setting can be saved. Run that migration in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("schema cache") || normalized.includes("could not find") || normalized.includes("column")) {
    return "Supabase is missing a database column required by this setting. Run any skipped migrations in Supabase SQL Editor, then try again.";
  }

  if (normalized.includes("select at least phone number or email")) {
    return "Select at least phone number or email so the lead can be saved.";
  }

  return message;
}

function redirectWithError(path: string, error: unknown): never {
  redirect(`${path}?error=${encodeURIComponent(adminActionErrorMessage(error))}`);
}

async function assertAdminFunnel(funnelId: string) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  const funnel = await getFunnelById(funnelId);
  if (!funnel || funnel.tenant_id !== tenantId) {
    throw new Error("Funnel not found.");
  }
  return { tenantId, funnel };
}

function contactFieldSettingsFromForm(formData: FormData) {
  const fullName = formData.get("contact_field_full_name") === "on";

  return {
    full_name: fullName,
    phone: formData.get("contact_field_phone") === "on",
    first_name: fullName ? false : formData.get("contact_field_first_name") === "on",
    last_name: fullName ? false : formData.get("contact_field_last_name") === "on",
    email: formData.get("contact_field_email") === "on"
  };
}

function contactFieldOrderFromForm(formData: FormData) {
  return normalizeContactFieldOrder(formData.getAll("contact_field_order"));
}

function intakeFlowOrderFromForm(formData: FormData, questionIds: string[]) {
  const intakeFlowOrder = formData.getAll("intake_flow_order").map(String);
  return resolveIntakeFlowEditorOrder(
    { intake_flow_order: intakeFlowOrder, contact_field_order: contactFieldOrderFromForm(formData) },
    questionIds
  ).map(intakeFlowItemToKey);
}

function disabledQuestionIdsFromForm(formData: FormData, questionIds: string[]) {
  return normalizeDisabledQuestionIds(
    questionIds.filter((questionId) => formData.get(`question_enabled_${questionId}`) !== "on"),
    questionIds
  );
}

function moveContactFieldOrder(order: ContactFieldKey[], fieldKey: ContactFieldKey, direction: string) {
  if (!contactFieldKeys.includes(fieldKey as ContactFieldKey) || (direction !== "up" && direction !== "down")) {
    return order;
  }

  const index = order.indexOf(fieldKey as ContactFieldKey);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) {
    return order;
  }

  const nextOrder = [...order];
  [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
  return nextOrder;
}

function moveIntakeFlowOrder(order: string[], itemKey: string, direction: string) {
  if (direction !== "up" && direction !== "down") {
    return order;
  }

  const index = order.indexOf(itemKey);
  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) {
    return order;
  }

  const nextOrder = [...order];
  [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
  return nextOrder;
}

async function syncQuestionDisplayOrderFromFlow(funnelId: string, flowOrder: string[]) {
  const questionKeys = flowOrder.filter((key) => key.startsWith("question:"));
  await Promise.all(
    questionKeys.map((key, index) =>
      updateQuestionOrder({
        question_id: key.slice("question:".length),
        display_order: index + 1
      })
    )
  );
  revalidatePath(`/admin/funnels/${funnelId}`);
}

export async function createFunnelAction(formData: FormData) {
  const { tenantId } = await requireTenantRole(["owner", "admin"]);
  let funnelId: string;

  try {
    const funnel = await createFunnel({
      tenant_id: tenantId,
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      description: optionalString(formData, "description"),
      show_intro_headline: true,
      show_intro_description: true,
      redirect_url: optionalString(formData, "redirect_url"),
      ghl_connection_id: optionalString(formData, "ghl_connection_id"),
      calendar_id: optionalString(formData, "calendar_id"),
      slot_duration_minutes: Number(formData.get("slot_duration_minutes") ?? 30),
      availability_window_days: Number(formData.get("availability_window_days") ?? 14),
      opt_in_pipeline_id: optionalString(formData, "opt_in_pipeline_id"),
      opt_in_pipeline_stage_id: optionalString(formData, "opt_in_pipeline_stage_id"),
      booked_pipeline_id: optionalString(formData, "booked_pipeline_id"),
      booked_pipeline_stage_id: optionalString(formData, "booked_pipeline_stage_id"),
      disqualified_pipeline_id: optionalString(formData, "disqualified_pipeline_id"),
      disqualified_pipeline_stage_id: optionalString(formData, "disqualified_pipeline_stage_id"),
      phone_pulse_enabled: formData.get("phone_pulse_enabled") !== "off",
      contact_fields: {
        full_name: true,
        phone: true,
        first_name: false,
        last_name: false,
        email: false
      },
      contact_field_order: defaultContactFieldOrder,
      contact_fields_per_page: 4,
      appointment_title: trimmedString(formData, "appointment_title"),
      opportunity_name_template:
        optionalString(formData, "opportunity_name_template") ?? "{{lead_name}}",
      theme: {
        primary_color: String(formData.get("primary_color") ?? "#173f2d"),
        accent_color: String(formData.get("accent_color") ?? "#4f9a78"),
        button_color: String(formData.get("button_color") ?? "#173f2d"),
        border_radius: Number(formData.get("border_radius") ?? 8),
        logo_url: optionalString(formData, "logo_url") ?? "",
        logo_alignment: "left"
      }
    });
    funnelId = funnel.id;
  } catch (error) {
    redirectWithError("/admin/funnels", error);
  }

  revalidatePath("/admin/funnels");
  redirect(`/admin/funnels/${funnelId}?saved=created#settings`);
}

export async function updateFunnelAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await assertAdminFunnel(id);

  try {
    await updateFunnel({
      id,
      name: String(formData.get("name") ?? ""),
      slug: String(formData.get("slug") ?? ""),
      description: optionalString(formData, "description"),
      show_intro_headline: formData.get("show_intro_headline") === "on",
      show_intro_description: formData.get("show_intro_description") === "on",
      redirect_url: optionalString(formData, "redirect_url"),
      ghl_connection_id: optionalString(formData, "ghl_connection_id"),
      calendar_id: optionalString(formData, "calendar_id"),
      slot_duration_minutes: Number(formData.get("slot_duration_minutes") ?? 30),
      availability_window_days: Number(formData.get("availability_window_days") ?? 14),
      opt_in_pipeline_id: optionalString(formData, "opt_in_pipeline_id"),
      opt_in_pipeline_stage_id: optionalString(formData, "opt_in_pipeline_stage_id"),
      booked_pipeline_id: optionalString(formData, "booked_pipeline_id"),
      booked_pipeline_stage_id: optionalString(formData, "booked_pipeline_stage_id"),
      disqualified_pipeline_id: optionalString(formData, "disqualified_pipeline_id"),
      disqualified_pipeline_stage_id: optionalString(formData, "disqualified_pipeline_stage_id"),
      phone_pulse_enabled: formData.get("phone_pulse_enabled") === "on",
      appointment_title: trimmedString(formData, "appointment_title"),
      opportunity_name_template:
        optionalString(formData, "opportunity_name_template") ?? "{{lead_name}}",
      is_published: formData.get("is_published") === "on",
      theme: {
        primary_color: String(formData.get("primary_color") ?? "#173f2d"),
        accent_color: String(formData.get("accent_color") ?? "#4f9a78"),
        button_color: String(formData.get("button_color") ?? "#173f2d"),
        border_radius: Number(formData.get("border_radius") ?? 8),
        logo_url: optionalString(formData, "logo_url") ?? "",
        logo_alignment: String(formData.get("logo_alignment") ?? "left")
      }
    });
  } catch (error) {
    redirectWithError(`/admin/funnels/${id}`, error);
  }

  revalidatePath("/admin/funnels");
  revalidatePath(`/admin/funnels/${id}`);
  redirect(`/admin/funnels/${id}?saved=funnel`);
}

export async function updateContactFieldsAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const { funnel } = await assertAdminFunnel(id);
  const questionIds = funnel.questions.map((question) => question.id);
  const intakeFlowOrder = intakeFlowOrderFromForm(formData, questionIds);
  const disabledQuestionIds = disabledQuestionIdsFromForm(formData, questionIds);

  try {
    await updateFunnel({
      id,
      contact_fields: contactFieldSettingsFromForm(formData),
      contact_field_order: contactFieldOrderFromForm(formData),
      contact_fields_per_page: normalizeContactFieldsPerPage(formData.get("contact_fields_per_page")),
      disabled_question_ids: disabledQuestionIds,
      intake_flow_order: intakeFlowOrder
    });
    await syncQuestionDisplayOrderFromFlow(id, intakeFlowOrder);
  } catch (error) {
    redirectWithError(`/admin/funnels/${id}`, error);
  }

  revalidatePath(`/admin/funnels/${id}`);
  redirect(`/admin/funnels/${id}?saved=intake-flow`);
}

export async function updateAnalyticsTargetCountriesAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await assertAdminFunnel(id);

  try {
    await updateFunnel({
      id,
      analytics_target_country_codes: normalizeAnalyticsTargetCountryCodes(
        formData.getAll("analytics_target_country_codes")
      ),
      analytics_traffic_sources: normalizeAnalyticsTrafficSources(formData.getAll("analytics_traffic_sources"))
    });
  } catch (error) {
    redirectWithError(`/admin/funnels/${id}`, error);
  }

  revalidatePath(`/admin/funnels/${id}`);
  redirect(`/admin/funnels/${id}?saved=analytics-filters#performance`);
}

export async function moveContactFieldAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const fieldKey = String(formData.get("field_key") ?? "") as ContactFieldKey;
  const direction = String(formData.get("direction") ?? "");
  const { funnel } = await assertAdminFunnel(id);
  const currentOrder = resolveContactFieldConfig(funnel.qualification_rule).order;
  const nextOrder = moveContactFieldOrder(currentOrder, fieldKey, direction);

  try {
    await updateFunnel({
      id,
      contact_field_order: nextOrder
    });
  } catch (error) {
    redirectWithError(`/admin/funnels/${id}`, error);
  }

  revalidatePath(`/admin/funnels/${id}`);
  redirect(`/admin/funnels/${id}?saved=contact-fields`);
}

export async function moveIntakeFlowItemAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  const itemKey = String(formData.get("item_key") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const { funnel } = await assertAdminFunnel(id);
  const questionIds = funnel.questions.map((question) => question.id);
  const currentFlowOrder = resolveIntakeFlowEditorOrder(funnel.qualification_rule, questionIds).map(intakeFlowItemToKey);
  const nextFlowOrder = moveIntakeFlowOrder(currentFlowOrder, itemKey, direction);
  const contactFieldOrder = normalizeContactFieldOrder(
    nextFlowOrder
      .filter((key) => key.startsWith("contact:"))
      .map((key) => key.slice("contact:".length))
  );
  const currentConfig = resolveContactFieldConfig(funnel.qualification_rule);
  const disabledQuestionIds = resolveDisabledQuestionIds(funnel.qualification_rule, questionIds);

  try {
    await updateFunnel({
      id,
      contact_field_order: contactFieldOrder,
      contact_fields_per_page: currentConfig.fieldsPerPage,
      disabled_question_ids: disabledQuestionIds,
      intake_flow_order: nextFlowOrder
    });
    await syncQuestionDisplayOrderFromFlow(id, nextFlowOrder);
  } catch (error) {
    redirectWithError(`/admin/funnels/${id}`, error);
  }

  revalidatePath(`/admin/funnels/${id}`);
  redirect(`/admin/funnels/${id}?saved=intake-flow`);
}

export async function duplicateFunnelAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await assertAdminFunnel(id);
  const funnel = await duplicateFunnel(id);
  revalidatePath("/admin/funnels");
  redirect(`/admin/funnels/${funnel.id}?saved=duplicated#settings`);
}

export async function deleteFunnelAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await assertAdminFunnel(id);
  await deleteFunnel(id);
  revalidatePath("/admin/funnels");
  redirect("/admin/funnels?saved=deleted");
}

export async function uploadLogoAction(formData: FormData) {
  const funnelId = String(formData.get("funnel_id") ?? "");
  const { tenantId } = await assertAdminFunnel(funnelId);
  const file = formData.get("logo");

  if (!(file instanceof File) || file.size === 0) {
    redirectWithError(`/admin/funnels/${funnelId}`, new Error("Logo file is required."));
  }

  try {
    await uploadFunnelLogo({ funnelId, tenantId, file });
  } catch (error) {
    redirectWithError(`/admin/funnels/${funnelId}`, error);
  }

  revalidatePath(`/admin/funnels/${funnelId}`);
  redirect(`/admin/funnels/${funnelId}?saved=logo`);
}

export async function moveQuestionAction(formData: FormData) {
  const funnelId = String(formData.get("funnel_id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  const direction = String(formData.get("direction") ?? "");
  const { funnel } = await assertAdminFunnel(funnelId);
  const sortedQuestions = [...funnel.questions].sort((first, second) => first.display_order - second.display_order);
  const currentIndex = sortedQuestions.findIndex((question) => question.id === questionId);
  const targetIndex = direction === "up" ? currentIndex - 1 : direction === "down" ? currentIndex + 1 : -1;

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sortedQuestions.length) {
    revalidatePath(`/admin/funnels/${funnelId}`);
    return;
  }

  const currentQuestion = sortedQuestions[currentIndex];
  const targetQuestion = sortedQuestions[targetIndex];
  await Promise.all([
    updateQuestionOrder({
      question_id: currentQuestion.id,
      display_order: targetQuestion.display_order
    }),
    updateQuestionOrder({
      question_id: targetQuestion.id,
      display_order: currentQuestion.display_order
    })
  ]);

  revalidatePath(`/admin/funnels/${funnelId}`);
  redirect(`/admin/funnels/${funnelId}?saved=question-order&question=${currentQuestion.id}`);
}

export async function upsertQuestionAction(formData: FormData) {
  const funnelId = String(formData.get("funnel_id") ?? "");
  const { tenantId, funnel } = await assertAdminFunnel(funnelId);
  const questionId = optionalString(formData, "id");
  const questionType = String(formData.get("question_type") ?? "text") as QuestionType;
  const existingQuestion = questionId ? funnel.questions.find((question) => question.id === questionId) : undefined;
  const disqualificationRule = {
    enabled: formData.get("disqualification_enabled") === "on",
    operator: String(
      formData.get("disqualification_operator") ?? (questionType === "number" ? "less_than" : "equals")
    ) as QuestionDisqualificationOperator,
    value: String(formData.get("disqualification_value") ?? "")
  };
  const payload = {
    tenant_id: tenantId,
    funnel_id: funnelId,
    stable_key: String(formData.get("stable_key") ?? ""),
    label: String(formData.get("label") ?? ""),
    help_text: nullableString(formData, "help_text"),
    question_type: questionType,
    placeholder: nullableString(formData, "placeholder"),
    is_required: formData.get("is_required") === "on",
    display_order: Number(formData.get("display_order") ?? 0),
    ghl_field_key: nullableString(formData, "ghl_field_key"),
    ghl_custom_field_id: nullableString(formData, "ghl_custom_field_id"),
    ghl_custom_field_key: nullableString(formData, "ghl_custom_field_key"),
    validation: mergeQuestionDisqualificationRule(
      existingQuestion?.validation,
      questionType,
      disqualificationRule
    )
  };

  let savedQuestionId: string;
  try {
    validateQuestionDisqualificationRule(questionType, disqualificationRule);
    const savedQuestion = questionId
      ? await updateQuestion({ id: questionId, ...payload })
      : await upsertQuestion(payload);
    savedQuestionId = savedQuestion.id;
  } catch (error) {
    redirectWithError(`/admin/funnels/${funnelId}`, error);
  }

  revalidatePath(`/admin/funnels/${funnelId}`);
  redirect(`/admin/funnels/${funnelId}?saved=question&question=${savedQuestionId}`);
}

export async function deleteQuestionAction(formData: FormData) {
  const funnelId = String(formData.get("funnel_id") ?? "");
  await assertAdminFunnel(funnelId);
  try {
    await deleteQuestion(String(formData.get("id") ?? ""));
  } catch (error) {
    redirectWithError(`/admin/funnels/${funnelId}`, error);
  }
  revalidatePath(`/admin/funnels/${funnelId}`);
  redirect(`/admin/funnels/${funnelId}?saved=question-deleted#questions`);
}

export async function upsertQuestionOptionAction(formData: FormData) {
  const funnelId = String(formData.get("funnel_id") ?? "");
  const { tenantId } = await assertAdminFunnel(funnelId);
  const questionId = String(formData.get("question_id") ?? "");
  let savedOptionId: string;

  try {
    const savedOption = await upsertQuestionOption({
      tenant_id: tenantId,
      question_id: questionId,
      stable_key: String(formData.get("stable_key") ?? ""),
      label: String(formData.get("label") ?? ""),
      value: String(formData.get("value") ?? ""),
      display_order: Number(formData.get("display_order") ?? 0),
      is_disqualifying: formData.get("is_disqualifying") === "on"
    });
    savedOptionId = savedOption.id;
  } catch (error) {
    redirectWithError(`/admin/funnels/${funnelId}`, error);
  }

  revalidatePath(`/admin/funnels/${funnelId}`);
  redirect(`/admin/funnels/${funnelId}?saved=option&question=${questionId}&option=${savedOptionId}`);
}

export async function deleteQuestionOptionAction(formData: FormData) {
  const funnelId = String(formData.get("funnel_id") ?? "");
  const questionId = String(formData.get("question_id") ?? "");
  await assertAdminFunnel(funnelId);
  try {
    await deleteQuestionOption(String(formData.get("id") ?? ""));
  } catch (error) {
    redirectWithError(`/admin/funnels/${funnelId}`, error);
  }
  revalidatePath(`/admin/funnels/${funnelId}`);
  redirect(`/admin/funnels/${funnelId}?saved=option-deleted&question=${questionId}#question-${questionId}`);
}
