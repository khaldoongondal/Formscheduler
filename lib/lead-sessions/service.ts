import { LeadStatusKeptError, type StatusUpdateOptions } from "@/lib/lead-sessions/status-guard";
import { PublicError } from "@/lib/api/responses";
import { assertFunnelServesPublic } from "@/lib/funnels/public-gate";
import { resolveRecordedSplitTestId } from "@/lib/split-tests/public";
import { enforceDailyCap } from "@/lib/security/rate-limit";
import { createServiceClient } from "@/lib/supabase/server";
import { getRequestGeoMetadata } from "@/lib/analytics/country-filter";
import { trackEvent } from "@/lib/analytics/service";
import { createDemoGhlId, isDemoSlotModeEnabled } from "@/lib/demo/slots";
import { answerMatchesQuestionDisqualificationRule } from "@/lib/funnels/disqualification";
import { getFunnelGhlConfig } from "@/lib/ghl/funnel-config";
import {
  createLeadAnswersContactNote,
  ensureGhlOpportunity,
  updateLeadContactAnswers,
  upsertLeadContact
} from "@/lib/ghl/service";
import { isUsableClickTime } from "@/lib/meta/fbc";
import { leadConsentValue } from "@/lib/meta/gating";
import { onLead, onLeadStage } from "@/lib/meta/hooks";
import type { QueuedMetaEvent } from "@/lib/meta/queue";
import { getClientIp, toStorableIp } from "@/lib/security/client-ip";
import { dispatchCrmEvent } from "@/lib/crm/dispatch";
import { leadStageMetadata } from "@/lib/bookings/outcome-plan";
import type { Funnel, Json, LeadAnswer, LeadSession, Question } from "@/lib/types/database";
import { startLeadSessionSchema, submitAnswersSchema } from "@/lib/validation/lead-sessions";
import { isValidWebsiteValue, normalizeWebsiteValue, websiteValidationMessage } from "@/lib/validation/website";

function splitName(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts[0] ?? null;
  const lastName = parts.length > 1 ? parts.slice(1).join(" ") : null;
  return { firstName, lastName };
}

function buildTrackingMetadata(input: {
  fbclid?: string;
  fingerprint?: string;
  fbc?: string;
  fbp?: string;
  gclid?: string;
  ttclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  utm_adset?: string;
  utm_adid?: string;
  utm_adsetid?: string;
  utm_campaignid?: string;
  utm_id?: string;
  split_test_id?: string;
  split_variant?: string;
  landing_page_url?: string;
}) {
  const fingerprint = input.fingerprint?.trim();
  return Object.fromEntries(
    [
      ["fbclid", input.fbclid?.trim()],
      ["fingerprint", fingerprint],
      ["device_fingerprint", fingerprint],
      ["fbc", input.fbc?.trim()],
      ["fbp", input.fbp?.trim()],
      ["gclid", input.gclid?.trim()],
      ["ttclid", input.ttclid?.trim()],
      ["utm_source", input.utm_source?.trim()],
      ["utm_medium", input.utm_medium?.trim()],
      ["utm_campaign", input.utm_campaign?.trim()],
      ["utm_content", input.utm_content?.trim()],
      ["utm_term", input.utm_term?.trim()],
      ["utm_adset", input.utm_adset?.trim()],
      ["utm_adid", input.utm_adid?.trim()],
      ["utm_adsetid", input.utm_adsetid?.trim()],
      ["utm_campaignid", input.utm_campaignid?.trim()],
      ["utm_id", input.utm_id?.trim()],
      ["split_test_id", input.split_test_id?.trim()],
      ["split_variant", input.split_variant?.trim()],
      ["landing_page_url", input.landing_page_url?.trim()]
    ].filter((entry): entry is [string, string] => Boolean(entry[1]))
  ) as Json;
}

function isAnswered(answer: LeadAnswer | undefined, question: Question) {
  if (!answer) return false;
  if (question.question_type === "multi_select" || question.question_type === "single_select") {
    return answer.answer_options.length > 0;
  }
  if (question.question_type === "number") {
    return answer.answer_number !== null;
  }
  return Boolean(answer.answer_text?.trim());
}

function normalizeAnswer(question: Question, value: string | number | string[]) {
  if (question.question_type === "multi_select") {
    const options = Array.isArray(value) ? value.map(String).filter(Boolean) : [String(value)].filter(Boolean);
    return {
      answer_text: null,
      answer_number: null,
      answer_options: options,
      raw_value: options as Json
    };
  }

  if (question.question_type === "single_select") {
    const option = Array.isArray(value) ? String(value[0] ?? "") : String(value);
    return {
      answer_text: null,
      answer_number: null,
      answer_options: option ? [option] : [],
      raw_value: option as Json
    };
  }

  if (question.question_type === "number") {
    const numericValue = typeof value === "number" ? value : Number(value);
    return {
      answer_text: null,
      answer_number: Number.isFinite(numericValue) ? numericValue : null,
      answer_options: [],
      raw_value: numericValue as Json
    };
  }

  if (question.question_type === "url") {
    const text = Array.isArray(value) ? value.join(", ") : String(value);
    const normalizedText = text.trim() ? normalizeWebsiteValue(text) : "";
    return {
      answer_text: normalizedText,
      answer_number: null,
      answer_options: [],
      raw_value: normalizedText as Json
    };
  }

  const text = Array.isArray(value) ? value.join(", ") : String(value);
  return {
    answer_text: text,
    answer_number: null,
    answer_options: [],
    raw_value: text as Json
  };
}

function getDisqualifyingAnswerMatches(
  answers: LeadAnswer[],
  questions: Question[],
  options: Array<{
    question_id: string;
    stable_key: string;
    label: string;
    value: string;
    is_disqualifying: boolean;
  }>
) {
  const answerByQuestionId = new Map(answers.map((answer) => [answer.question_id, answer]));
  const matches = options.filter((option) => {
    if (!option.is_disqualifying) {
      return false;
    }

    const answer = answerByQuestionId.get(option.question_id);
    return Boolean(answer?.answer_options.includes(option.value));
  });

  for (const question of questions) {
    const answer = answerByQuestionId.get(question.id);
    if (!answer) continue;

    const value =
      question.question_type === "number"
        ? answer.answer_number
        : question.question_type === "single_select" || question.question_type === "multi_select"
          ? answer.answer_options
          : answer.answer_text;

    if (answerMatchesQuestionDisqualificationRule(question.question_type, question.validation, value)) {
      matches.push({
        question_id: question.id,
        stable_key: question.stable_key,
        label: question.label,
        value: Array.isArray(value) ? value.join(", ") : String(value ?? ""),
        is_disqualifying: true
      });
    }
  }

  return matches;
}

async function moveDisqualifiedLeadToGhl(
  session: LeadSession,
  disqualifyingOptions: Array<{ stable_key: string; label: string; value: string }>
) {
  if (isDemoSlotModeEnabled() || !session.ghl_contact_id) {
    return session;
  }

  const supabase = createServiceClient();

  try {
    const { funnel, connection, config } = await getFunnelGhlConfig(session.funnel_id);
    const opportunityId = await ensureGhlOpportunity({
      config,
      funnel,
      leadSession: session,
      contactId: session.ghl_contact_id,
      stage: "disqualified"
    });

    const { data: updatedSession, error } = await supabase
      .from("lead_sessions")
      .update({
        ghl_connection_id: connection.id,
        ghl_opportunity_id: opportunityId
      })
      .eq("id", session.id)
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return updatedSession;
  } catch (error) {
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "booking_error",
      metadata: {
        phase: "disqualified_handoff",
        disqualifying_options: disqualifyingOptions.map((option) => ({
          stable_key: option.stable_key,
          label: option.label,
          value: option.value
        })),
        message: error instanceof Error ? error.message : "Unknown disqualified GHL handoff error"
      }
    });

    return session;
  }
}

/**
 * Lead capture for a form whose calendar is not GoHighLevel (decision C5):
 * the lead reaches potential in the same request with no third-party call,
 * then the CRM gets lead.captured after the response.
 */
async function startGenericLead(
  session: LeadSession,
  funnel: Funnel
): Promise<{ session: LeadSession; metaEvents: Array<QueuedMetaEvent | null> }> {
  const supabase = createServiceClient();
  const { data: updatedSession, error: updateError } = await supabase
    .from("lead_sessions")
    .update({ status: "potential" })
    .eq("id", session.id)
    .select("*")
    .single();

  if (updateError) throw new Error(updateError.message);

  await trackEvent({
    tenantId: updatedSession.tenant_id,
    funnelId: updatedSession.funnel_id,
    leadSessionId: updatedSession.id,
    visitorId: updatedSession.visitor_id ?? undefined,
    splitTestId: updatedSession.split_test_id ?? null,
    eventType: "lead_captured",
    sourceUrl: updatedSession.source_url ?? undefined,
    userAgent: updatedSession.user_agent ?? undefined,
    metadata: leadStageMetadata(funnel.calendar_provider) ?? { provider: funnel.calendar_provider ?? "ghl" }
  });

  // Decision M15: Lead fires when the session reaches potential. Never throws.
  const leadEvent = await onLead(updatedSession, funnel);
  dispatchCrmEvent({ type: "lead.captured", funnel, sessionId: updatedSession.id });
  return { session: updatedSession, metaEvents: [leadEvent] };
}

export async function startLeadSession(
  input: unknown,
  request?: Request
): Promise<{ session: LeadSession; metaEvents: Array<QueuedMetaEvent | null> }> {
  const parsed = startLeadSessionSchema.parse(input);
  const supabase = createServiceClient();
  const funnel = await assertFunnelServesPublic(parsed.funnel_id);
  if (!(await enforceDailyCap("lead", { funnelId: funnel.id, tenantId: funnel.tenant_id, headers: request?.headers }))) {
    throw new PublicError("This form is not taking new submissions right now. Please try again later.", 429);
  }

  const normalizedFullName = parsed.full_name?.trim() ?? "";
  const fallbackNameParts = splitName(normalizedFullName);
  const firstName = parsed.first_name?.trim() || fallbackNameParts.firstName;
  const lastName = parsed.last_name?.trim() || fallbackNameParts.lastName;
  const trackingMetadata = buildTrackingMetadata({
    fbclid: parsed.fbclid,
    fingerprint: parsed.fingerprint,
    fbc: parsed.fbc,
    fbp: parsed.fbp,
    gclid: parsed.gclid,
    ttclid: parsed.ttclid,
    utm_source: parsed.utm_source,
    utm_medium: parsed.utm_medium,
    utm_campaign: parsed.utm_campaign,
    utm_content: parsed.utm_content,
    utm_term: parsed.utm_term,
    utm_adset: parsed.utm_adset,
    utm_adid: parsed.utm_adid,
    utm_adsetid: parsed.utm_adsetid,
    utm_campaignid: parsed.utm_campaignid,
    utm_id: parsed.utm_id,
    split_test_id: parsed.split_test_id,
    split_variant: parsed.split_variant,
    landing_page_url: parsed.landing_page_url
  });
  // Decision M13: the first time this browser saw the fbclid, kept only when plausible.
  const fbclidSeenAt =
    parsed.fbclid && isUsableClickTime(parsed.fbclid_seen_at, Date.now()) ? parsed.fbclid_seen_at : undefined;
  const metadataWithGeo = {
    ...(trackingMetadata as Record<string, Json | undefined>),
    ...(fbclidSeenAt ? { fbclid_seen_at: fbclidSeenAt } : {}),
    ...getRequestGeoMetadata(request)
  } as Json;
  // Decision S9: only a running test this form belongs to is recorded. Never throws.
  const splitTestId = await resolveRecordedSplitTestId(parsed.test_id, funnel.id, funnel.tenant_id);
  // Decision M11: the visitor's consent answer, only when the form has a pixel and shows the box.
  const metaConsent = leadConsentValue(
    { meta_pixel_id: funnel.meta_pixel_id ?? null, meta_consent_checkbox_enabled: funnel.meta_consent_checkbox_enabled === true },
    parsed.meta_consent
  );
  // Decision M14: the client IP from the trusted header, only when it is a valid address.
  const ipAddress = request ? toStorableIp(getClientIp(request.headers)) : null;
  const { data: session, error } = await supabase
    .from("lead_sessions")
    .insert({
      ...(splitTestId ? { split_test_id: splitTestId } : {}),
      ...(metaConsent !== null ? { meta_consent: metaConsent } : {}),
      ip_address: ipAddress,
      tenant_id: funnel.tenant_id,
      funnel_id: funnel.id,
      status: "started",
      first_name: firstName,
      last_name: lastName,
      full_name: normalizedFullName || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      visitor_id: parsed.visitor_id ?? null,
      source_url: parsed.source_url ?? null,
      referrer: parsed.referrer ?? null,
      utm_source: parsed.utm_source ?? null,
      utm_medium: parsed.utm_medium ?? null,
      utm_campaign: parsed.utm_campaign ?? null,
      utm_content: parsed.utm_content ?? null,
      utm_term: parsed.utm_term ?? null,
      metadata: metadataWithGeo,
      user_agent: request?.headers.get("user-agent") ?? null
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);

  await trackEvent({
    tenantId: session.tenant_id,
    funnelId: session.funnel_id,
    leadSessionId: session.id,
    visitorId: session.visitor_id ?? undefined,
    splitTestId: session.split_test_id ?? null,
    eventType: "funnel_start",
    sourceUrl: session.source_url ?? undefined,
    userAgent: session.user_agent ?? undefined,
    metadata: metadataWithGeo
  });

  if (isDemoSlotModeEnabled()) {
    const { data: updatedSession, error: updateError } = await supabase
      .from("lead_sessions")
      .update({
        status: "potential",
        ghl_connection_id: funnel.ghl_connection_id,
        ghl_contact_id: createDemoGhlId("contact", session.id),
        ghl_opportunity_id: createDemoGhlId("opportunity", session.id)
      })
      .eq("id", session.id)
      .select("*")
      .single();

    if (updateError) throw new Error(updateError.message);

    await trackEvent({
      tenantId: updatedSession.tenant_id,
      funnelId: updatedSession.funnel_id,
      leadSessionId: updatedSession.id,
      visitorId: updatedSession.visitor_id ?? undefined,
      splitTestId: updatedSession.split_test_id ?? null,
      eventType: "lead_captured",
      sourceUrl: updatedSession.source_url ?? undefined,
      userAgent: updatedSession.user_agent ?? undefined,
      metadata: { mode: "demo_slot_preview" }
    });

    // Decision M15: Lead fires when the session reaches potential. Never throws.
    const leadEvent = await onLead(updatedSession, funnel);
    return { session: updatedSession, metaEvents: [leadEvent] };
  }

  if ((funnel.calendar_provider ?? "ghl") !== "ghl") {
    return startGenericLead(session, funnel);
  }

  try {
    const { funnel: configuredFunnel, connection, config } = await getFunnelGhlConfig(funnel.id);
    const contact = await upsertLeadContact(config, session, []);
    const opportunityId = await ensureGhlOpportunity({
      config,
      funnel: configuredFunnel,
      leadSession: session,
      contactId: contact.contact.id,
      stage: "opt_in"
    });

    const { data: updatedSession, error: updateError } = await supabase
      .from("lead_sessions")
      .update({
        status: "potential",
        ghl_connection_id: connection.id,
        ghl_contact_id: contact.contact.id,
        ghl_opportunity_id: opportunityId
      })
      .eq("id", session.id)
      .select("*")
      .single();

    if (updateError) throw new Error(updateError.message);

    await trackEvent({
      tenantId: updatedSession.tenant_id,
      funnelId: updatedSession.funnel_id,
      leadSessionId: updatedSession.id,
      visitorId: updatedSession.visitor_id ?? undefined,
      splitTestId: updatedSession.split_test_id ?? null,
      eventType: "lead_captured",
      sourceUrl: updatedSession.source_url ?? undefined,
      userAgent: updatedSession.user_agent ?? undefined
    });

    // Decision M15: Lead fires when the session reaches potential. Never throws.
    const leadEvent = await onLead(updatedSession, funnel);
    return { session: updatedSession, metaEvents: [leadEvent] };
  } catch (error) {
    await supabase
      .from("lead_sessions")
      .update({ status: "error", errored_at: new Date().toISOString() })
      .eq("id", session.id);
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "booking_error",
      metadata: { phase: "opt_in_handoff", message: error instanceof Error ? error.message : "Unknown GHL handoff error" }
    });
    throw error;
  }
}

export async function getLeadSession(id: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("lead_sessions").select("*").eq("id", id).single();
  if (error) throw new Error(error.message);
  return data;
}

export async function getAnswersForSession(leadSessionId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_answers")
    .select("*")
    .eq("lead_session_id", leadSessionId);

  if (error) throw new Error(error.message);
  return data;
}

export async function getAnswersWithQuestions(leadSessionId: string) {
  const supabase = createServiceClient();
  const session = await getLeadSession(leadSessionId);
  const [answersResult, questionsResult] = await Promise.all([
    supabase.from("lead_answers").select("*").eq("lead_session_id", leadSessionId),
    supabase.from("questions").select("*").eq("funnel_id", session.funnel_id)
  ]);

  if (answersResult.error) throw new Error(answersResult.error.message);
  if (questionsResult.error) throw new Error(questionsResult.error.message);

  return answersResult.data.map((answer) => ({
    ...answer,
    question: questionsResult.data.find((question) => question.id === answer.question_id)
  }));
}

export async function submitLeadAnswers(input: unknown) {
  const parsed = submitAnswersSchema.parse(input);
  const supabase = createServiceClient();
  const session = await getLeadSession(parsed.lead_session_id);
  const funnel = await assertFunnelServesPublic(session.funnel_id);

  const { data: questions, error: questionError } = await supabase
    .from("questions")
    .select("*")
    .eq("funnel_id", session.funnel_id)
    .order("display_order", { ascending: true });

  if (questionError) throw new Error(questionError.message);

  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const answerRows = parsed.answers.map((answer) => {
    const question = questionsById.get(answer.question_id);
    if (!question) {
      throw new PublicError("Answer references a question outside this funnel.");
    }

    const rawTextValue = Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value);
    if (question.question_type === "url" && rawTextValue.trim() && !isValidWebsiteValue(rawTextValue)) {
      throw new PublicError(websiteValidationMessage);
    }

    const normalized = normalizeAnswer(question, answer.value);
    return {
      tenant_id: session.tenant_id,
      lead_session_id: session.id,
      question_id: question.id,
      question_stable_key: question.stable_key,
      ...normalized
    };
  });

  const { error: upsertError } = await supabase
    .from("lead_answers")
    .upsert(answerRows, { onConflict: "lead_session_id,question_id" });

  if (upsertError) throw new Error(upsertError.message);

  const answers = await getAnswersForSession(session.id);
  const questionIds = questions.map((question) => question.id);
  let options: Array<{
    question_id: string;
    stable_key: string;
    label: string;
    value: string;
    is_disqualifying: boolean;
  }> = [];

  if (questionIds.length) {
    const optionsResult = await supabase
      .from("question_options")
      .select("question_id,stable_key,label,value,is_disqualifying")
      .in("question_id", questionIds);

    if (optionsResult.error?.code === "42703") {
      options = [];
    } else {
      if (optionsResult.error) throw new Error(optionsResult.error.message);
      options = optionsResult.data;
    }
  }

  const disqualifyingOptions = getDisqualifyingAnswerMatches(answers, questions, options);
  if (disqualifyingOptions.length) {
    const disqualifiedSession = await updateLeadSessionStatus(session.id, "disqualified");
    const genericCalendar = (funnel.calendar_provider ?? "ghl") !== "ghl";
    const syncedSession = genericCalendar
      ? disqualifiedSession
      : await moveDisqualifiedLeadToGhl(disqualifiedSession, disqualifyingOptions);
    if (genericCalendar && !isDemoSlotModeEnabled()) {
      dispatchCrmEvent({
        type: "lead.disqualified",
        funnel,
        sessionId: session.id,
        disqualifyingOptions: disqualifyingOptions.map((option) => ({
          stable_key: option.stable_key,
          label: option.label,
          value: option.value
        }))
      });
    }

    await trackEvent({
      tenantId: syncedSession.tenant_id,
      funnelId: syncedSession.funnel_id,
      leadSessionId: syncedSession.id,
      visitorId: syncedSession.visitor_id ?? undefined,
      splitTestId: syncedSession.split_test_id ?? null,
      eventType: "disqualified_lead",
      metadata: {
        // Decision C22: rows from a non-GoHighLevel calendar carry the provider.
        ...leadStageMetadata(funnel.calendar_provider),
        disqualifying_options: disqualifyingOptions.map((option) => ({
          stable_key: option.stable_key,
          label: option.label,
          value: option.value
        }))
      }
    });

    const disqualifiedEvent = await onLeadStage("disqualified_lead", syncedSession, funnel);
    return { session: syncedSession, qualified: false, disqualified: true, metaEvents: [disqualifiedEvent] };
  }

  const answersByQuestionId = new Map(answers.map((answer) => [answer.question_id, answer]));
  const allRequiredAnswered = questions
    .filter((question) => question.is_required)
    .every((question) => isAnswered(answersByQuestionId.get(question.id), question));

  const nextStatus = allRequiredAnswered ? "qualified" : "potential";
  const { data: updatedSession, error: updateError } = await supabase
    .from("lead_sessions")
    .update({
      status: nextStatus,
      qualified_at: allRequiredAnswered ? new Date().toISOString() : null
    })
    .eq("id", session.id)
    .select("*")
    .single();

  if (updateError) throw new Error(updateError.message);

  if (allRequiredAnswered) {
    // Decision C22: rows from a non-GoHighLevel calendar carry the provider; GoHighLevel rows are unchanged.
    const qualifiedMetadata = leadStageMetadata(funnel.calendar_provider);
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "qualified_lead",
      ...(qualifiedMetadata ? { metadata: qualifiedMetadata } : {})
    });
  }

  const qualifiedEvent = allRequiredAnswered ? await onLeadStage("qualified_lead", updatedSession, funnel) : null;
  if (allRequiredAnswered && (funnel.calendar_provider ?? "ghl") !== "ghl" && !isDemoSlotModeEnabled()) {
    dispatchCrmEvent({ type: "lead.qualified", funnel, sessionId: session.id });
  }
  return {
    session: updatedSession,
    qualified: allRequiredAnswered,
    disqualified: false,
    metaEvents: [qualifiedEvent]
  };
}

/** The form's calendar provider; a database without migration 0029 means GoHighLevel. */
async function getFunnelCalendarProvider(funnelId: string, tenantId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("calendar_provider")
    .eq("id", funnelId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error) {
    if (error.code === "42703") return "ghl";
    throw new Error(error.message);
  }
  return (data?.calendar_provider as string | undefined) ?? "ghl";
}

export async function syncLeadAnswersToGhl(leadSessionId: string) {
  const session = await getLeadSession(leadSessionId);

  if (isDemoSlotModeEnabled() || !session.ghl_contact_id) {
    return;
  }

  // Forms on another calendar send answers through their CRM event instead.
  if ((await getFunnelCalendarProvider(session.funnel_id, session.tenant_id)) !== "ghl") {
    return;
  }

  try {
    const { config } = await getFunnelGhlConfig(session.funnel_id);
    const answers = await getAnswersWithQuestions(session.id);
    const [contactResult, noteResult] = await Promise.allSettled([
      updateLeadContactAnswers(config, session, session.ghl_contact_id, answers),
      createLeadAnswersContactNote(config, session, session.ghl_contact_id, answers)
    ]);

    if (contactResult.status === "rejected") {
      await trackEvent({
        tenantId: session.tenant_id,
        funnelId: session.funnel_id,
        leadSessionId: session.id,
        visitorId: session.visitor_id ?? undefined,
        splitTestId: session.split_test_id ?? null,
        eventType: "booking_error",
        metadata: {
          phase: "ghl_answer_custom_fields",
          message: contactResult.reason instanceof Error ? contactResult.reason.message : "Unknown GHL answer custom field error"
        }
      });
    }

    if (noteResult.status === "rejected") {
      await trackEvent({
        tenantId: session.tenant_id,
        funnelId: session.funnel_id,
        leadSessionId: session.id,
        visitorId: session.visitor_id ?? undefined,
        splitTestId: session.split_test_id ?? null,
        eventType: "booking_error",
        metadata: {
          phase: "ghl_answer_note",
          message: noteResult.reason instanceof Error ? noteResult.reason.message : "Unknown GHL answer note error"
        }
      });
    }
  } catch (error) {
    await trackEvent({
      tenantId: session.tenant_id,
      funnelId: session.funnel_id,
      leadSessionId: session.id,
      visitorId: session.visitor_id ?? undefined,
      splitTestId: session.split_test_id ?? null,
      eventType: "booking_error",
      metadata: {
        phase: "ghl_answer_sync",
        message: error instanceof Error ? error.message : "Unknown GHL answer sync error"
      }
    });
  }
}

/**
 * With options.unlessStatusIn the change is one conditional update, and
 * LeadStatusKeptError is thrown when the row kept its status.
 */
export async function updateLeadSessionStatus(
  id: string,
  status: LeadSession["status"],
  options?: StatusUpdateOptions
): Promise<LeadSession> {
  const supabase = createServiceClient();
  const timestampField = {
    started: null,
    potential: null,
    qualified: "qualified_at",
    slots_shown: "slots_shown_at",
    booked: "booked_at",
    disqualified: "disqualified_at",
    abandoned: "abandoned_at",
    error: "errored_at"
  }[status];

  const update = supabase
    .from("lead_sessions")
    .update({
      status,
      ...(timestampField ? { [timestampField]: new Date().toISOString() } : {})
    })
    .eq("id", id);

  if (options) {
    const skip = options.unlessStatusIn.filter((value) => /^[a-z_]+$/.test(value));
    const guarded = skip.length ? update.not("status", "in", `(${skip.join(",")})`) : update;
    const { data, error } = await guarded.select("*").maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new LeadStatusKeptError();
    return data;
  }

  const { data, error } = await update.select("*").single();
  if (error) throw new Error(error.message);
  return data;
}

export async function abandonLeadSession(id: string) {
  const session = await getLeadSession(id);
  if (session.status === "booked" || session.status === "disqualified") {
    return session;
  }

  const updated = await updateLeadSessionStatus(id, "abandoned");
  await trackEvent({
    tenantId: session.tenant_id,
    funnelId: session.funnel_id,
    leadSessionId: session.id,
    visitorId: session.visitor_id ?? undefined,
    splitTestId: session.split_test_id ?? null,
    eventType: "abandoned"
  });
  return updated;
}
