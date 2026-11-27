/**
 * Shared helpers for CRM adapters: turning a thrown error into a delivery
 * outcome, and rebuilding a session-like row from a frozen event.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { CrmDeliveryOutcome, CrmLeadState, FormBookEvent } from "@/lib/connections/types";
import type { Json, LeadAnswer, LeadSession, Question } from "@/lib/types/database";

export const OUTCOME_SUMMARY_CAP = 500;

export function capSummary(text: string): string {
  return text.length > OUTCOME_SUMMARY_CAP ? text.slice(0, OUTCOME_SUMMARY_CAP) : text;
}

/** HTTP statuses worth retrying (decision C19). */
export function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * GoHighLevel client errors look like "GHL request failed (POST /path): 422 {body}"
 * or "GHL request timed out after 15s (...)". The summary never carries the body.
 */
export function classifyGhlError(error: unknown): CrmDeliveryOutcome {
  const message = error instanceof Error ? error.message : "";
  const statusMatch = message.match(/^GHL request failed \([^)]*\): (\d{3})\b/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return {
      outcome: isRetryableStatus(status) ? "retry" : "failed",
      httpStatus: status,
      summary: `GoHighLevel returned ${status}.`
    };
  }
  if (message.startsWith("GHL request timed out")) {
    return { outcome: "retry", httpStatus: null, summary: "GoHighLevel did not answer in time." };
  }
  if (error instanceof TypeError) {
    return { outcome: "retry", httpStatus: null, summary: "GoHighLevel could not be reached." };
  }
  if (message.startsWith("Missing ") && message.includes("pipeline settings")) {
    return { outcome: "failed", httpStatus: null, summary: capSummary(message) };
  }
  return { outcome: "failed", httpStatus: null, summary: "GoHighLevel refused the request." };
}

function trackingMetadata(event: FormBookEvent): Json {
  const tracking = event.tracking;
  const entries: Array<[string, string]> = [];
  const keys = [
    "landing_page_url",
    "utm_id",
    "utm_adset",
    "utm_adid",
    "utm_adsetid",
    "utm_campaignid",
    "fbclid",
    "gclid",
    "ttclid",
    "country_code",
    "region",
    "city"
  ] as const;
  for (const key of keys) {
    const value = tracking[key];
    if (value) entries.push([key, value]);
  }
  // Only a manual tag carries a variant; a running test's id is not copied into metadata.
  if (tracking.split_test?.variant) {
    entries.push(["split_test_id", tracking.split_test.id]);
    entries.push(["split_variant", tracking.split_test.variant]);
  }
  return Object.fromEntries(entries) as Json;
}

/**
 * A LeadSession-shaped row rebuilt from a frozen event and the lead's CRM
 * ids, so the GoHighLevel helpers behave as with a live session. Its id is
 * the lead's external reference, never the session id.
 */
export function sessionLikeFromEvent(event: FormBookEvent, lead: CrmLeadState, tenantId: string): LeadSession {
  const tracking = event.tracking;
  return {
    id: event.lead.id,
    tenant_id: tenantId,
    funnel_id: event.form.id,
    status: event.lead.status,
    first_name: event.lead.first_name,
    last_name: event.lead.last_name,
    full_name: event.lead.full_name,
    email: event.lead.email,
    phone: event.lead.phone,
    visitor_id: null,
    ghl_connection_id: null,
    ghl_contact_id: lead.ghlContactId,
    ghl_opportunity_id: lead.ghlOpportunityId,
    source_url: tracking.source_url,
    referrer: tracking.referrer,
    utm_source: tracking.utm_source,
    utm_medium: tracking.utm_medium,
    utm_campaign: tracking.utm_campaign,
    utm_content: tracking.utm_content,
    utm_term: tracking.utm_term,
    user_agent: null,
    ip_address: null,
    metadata: trackingMetadata(event),
    external_ref: event.lead.id,
    started_at: event.lead.created_at,
    qualified_at: null,
    slots_shown_at: null,
    booked_at: null,
    disqualified_at: null,
    abandoned_at: null,
    errored_at: null,
    created_at: event.lead.created_at,
    updated_at: event.created_at
  };
}

/**
 * Answer rows rebuilt from the event, joined to the form's questions by key
 * so GoHighLevel custom field mapping still applies.
 */
export function answersFromEvent(
  event: FormBookEvent,
  questions: Question[],
  tenantId: string
): Array<LeadAnswer & { question?: Question }> {
  const byKey = new Map(questions.map((question) => [question.stable_key, question]));
  return event.answers.map((answer, index) => {
    const question = byKey.get(answer.key);
    const value = answer.value;
    const options = Array.isArray(value)
      ? value
      : question && (question.question_type === "single_select" || question.question_type === "multi_select") && typeof value === "string"
        ? [value]
        : [];
    return {
      id: `${event.id}:${index}`,
      tenant_id: tenantId,
      lead_session_id: event.lead.id,
      question_id: question?.id ?? answer.key,
      question_stable_key: answer.key,
      answer_text: !options.length && typeof value === "string" ? value : null,
      answer_number: typeof value === "number" ? value : null,
      answer_options: options,
      raw_value: (value ?? null) as Json,
      created_at: event.created_at,
      updated_at: event.created_at,
      question: question ?? ({ label: answer.question, stable_key: answer.key } as Question)
    };
  });
}
