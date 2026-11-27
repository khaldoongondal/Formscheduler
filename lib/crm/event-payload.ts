/**
 * The FormBook lead event (Sprint 3 P1.9). It is what every non-GoHighLevel
 * CRM adapter receives and, unchanged, the documented webhook payload.
 * Pure: no Next.js, Supabase or I/O imports.
 *
 * The lead id is lead_sessions.external_ref, never the session id: the
 * session id authorises the public lead APIs (decision C21).
 */
import type { CalendarKind, CrmEventType } from "@/lib/connections/types";
import type { Funnel, Json, LeadAnswer, LeadSession, LeadSessionStatus, Question } from "@/lib/types/database";

export const FORMBOOK_EVENT_VERSION = "2026-11-26";
export const EVENT_STRING_CAP = 2000;
export const EVENT_MAX_ANSWERS = 100;

export type FormBookEventAnswer = { key: string; question: string; value: string | number | string[] | null };

export type FormBookEvent = {
  id: string;
  type: CrmEventType;
  version: typeof FORMBOOK_EVENT_VERSION;
  created_at: string;
  form: { id: string; name: string; slug: string };
  lead: {
    id: string;
    status: LeadSessionStatus;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    phone: string | null;
    created_at: string;
  };
  answers: FormBookEventAnswer[];
  tracking: {
    source_url: string | null;
    referrer: string | null;
    landing_page_url: string | null;
    utm_source: string | null;
    utm_medium: string | null;
    utm_campaign: string | null;
    utm_content: string | null;
    utm_term: string | null;
    utm_id: string | null;
    utm_adset: string | null;
    utm_adid: string | null;
    utm_adsetid: string | null;
    utm_campaignid: string | null;
    fbclid: string | null;
    gclid: string | null;
    ttclid: string | null;
    country_code: string | null;
    region: string | null;
    city: string | null;
    split_test: { id: string; variant: string | null } | null;
  };
  booking: {
    provider: CalendarKind;
    start: string;
    end: string;
    timezone: string;
    booking_id: string | null;
    meeting_url: string | null;
  } | null;
  disqualification: { reasons: Array<{ key: string; question: string; answer: string }> } | null;
};

export type DisqualifyingOption = { stable_key: string; label: string; value: string };

function cap(value: string | null | undefined, max = EVENT_STRING_CAP): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!text.length) return null;
  return text.length > max ? text.slice(0, max) : text;
}

/** "fbk.lead.captured.{ref}"; a booked event adds ".{bookingId}". One id per lead and type. */
export function crmEventId(type: CrmEventType, externalRef: string, suffix?: string): string {
  const base = `fbk.${type}.${externalRef}`;
  const cleanSuffix = suffix?.trim().replace(/[^A-Za-z0-9_\-:.@]/g, "").slice(0, 200);
  return cleanSuffix ? `${base}.${cleanSuffix}` : base;
}

function answerValue(answer: LeadAnswer & { question?: Question }): string | number | string[] | null {
  if (answer.answer_options.length) {
    if (answer.question?.question_type === "multi_select" || answer.answer_options.length > 1) {
      return answer.answer_options.slice(0, EVENT_MAX_ANSWERS).map((option) => cap(option) ?? "");
    }
    return cap(answer.answer_options[0]);
  }
  if (answer.answer_number !== null && answer.answer_number !== undefined) return answer.answer_number;
  return cap(answer.answer_text?.trim() ?? "");
}

function isEmptyValue(value: FormBookEventAnswer["value"]) {
  if (value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim().length === 0;
  return false;
}

/** Answers in question display order, labels from the question, empty answers left out, at most 100. */
export function buildEventAnswers(answers: Array<LeadAnswer & { question?: Question }>): FormBookEventAnswer[] {
  return [...answers]
    .sort((left, right) => {
      const leftOrder = left.question?.display_order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.question?.display_order ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      return left.question_stable_key.localeCompare(right.question_stable_key);
    })
    .map((answer) => ({
      key: cap(answer.question?.stable_key ?? answer.question_stable_key) ?? "",
      question: cap(answer.question?.label ?? answer.question_stable_key) ?? "",
      value: answerValue(answer)
    }))
    .filter((answer) => !isEmptyValue(answer.value))
    .slice(0, EVENT_MAX_ANSWERS);
}

function metadataString(metadata: Json, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, Json | undefined>)[key];
  if (typeof value === "string") return cap(value.trim());
  if (typeof value === "number" && Number.isFinite(value)) return cap(String(value));
  return null;
}

function columnOrMetadata(column: string | null | undefined, metadata: Json, key: string) {
  return cap(column?.trim()) ?? metadataString(metadata, key);
}

export function buildEventTracking(session: LeadSession): FormBookEvent["tracking"] {
  const metadata = session.metadata;
  const runningTestId = session.split_test_id ?? null;
  const manualTestId = metadataString(metadata, "split_test_id");
  const splitTest = runningTestId
    ? { id: runningTestId, variant: null }
    : manualTestId
      ? { id: manualTestId, variant: metadataString(metadata, "split_variant") }
      : null;

  return {
    source_url: columnOrMetadata(session.source_url, metadata, "source_url"),
    referrer: columnOrMetadata(session.referrer, metadata, "referrer"),
    landing_page_url: metadataString(metadata, "landing_page_url"),
    utm_source: columnOrMetadata(session.utm_source, metadata, "utm_source"),
    utm_medium: columnOrMetadata(session.utm_medium, metadata, "utm_medium"),
    utm_campaign: columnOrMetadata(session.utm_campaign, metadata, "utm_campaign"),
    utm_content: columnOrMetadata(session.utm_content, metadata, "utm_content"),
    utm_term: columnOrMetadata(session.utm_term, metadata, "utm_term"),
    utm_id: metadataString(metadata, "utm_id"),
    utm_adset: metadataString(metadata, "utm_adset"),
    utm_adid: metadataString(metadata, "utm_adid"),
    utm_adsetid: metadataString(metadata, "utm_adsetid"),
    utm_campaignid: metadataString(metadata, "utm_campaignid"),
    fbclid: metadataString(metadata, "fbclid"),
    gclid: metadataString(metadata, "gclid"),
    ttclid: metadataString(metadata, "ttclid"),
    country_code: metadataString(metadata, "country_code"),
    region: metadataString(metadata, "region"),
    city: metadataString(metadata, "city"),
    split_test: splitTest
  };
}

export function buildFormBookEvent(input: {
  type: CrmEventType;
  nowIso: string;
  funnel: Pick<Funnel, "id" | "name" | "slug">;
  session: LeadSession;
  answers: Array<LeadAnswer & { question?: Question }>;
  booking?: FormBookEvent["booking"];
  disqualifyingOptions?: DisqualifyingOption[];
}): FormBookEvent {
  const externalRef = input.session.external_ref;
  if (!externalRef) {
    // Never fall back to the session id (decision C21).
    throw new Error("Lead has no external reference yet.");
  }
  const booking = input.type === "lead.booked" && input.booking
    ? {
        provider: input.booking.provider,
        start: input.booking.start,
        end: input.booking.end,
        timezone: cap(input.booking.timezone, 80) ?? "UTC",
        booking_id: cap(input.booking.booking_id, 500),
        meeting_url: cap(input.booking.meeting_url)
      }
    : null;
  const suffix = input.type === "lead.booked"
    ? booking?.booking_id ?? (booking ? String(new Date(booking.start).getTime()) : undefined)
    : undefined;
  const reasons = input.type === "lead.disqualified"
    ? (input.disqualifyingOptions ?? []).slice(0, EVENT_MAX_ANSWERS).map((option) => ({
        key: cap(option.stable_key) ?? "",
        question: cap(option.label) ?? "",
        answer: cap(option.value) ?? ""
      }))
    : null;

  return {
    id: crmEventId(input.type, externalRef, suffix),
    type: input.type,
    version: FORMBOOK_EVENT_VERSION,
    created_at: input.nowIso,
    form: { id: input.funnel.id, name: cap(input.funnel.name) ?? "", slug: cap(input.funnel.slug) ?? "" },
    lead: {
      id: externalRef,
      status: input.session.status,
      full_name: cap(input.session.full_name),
      first_name: cap(input.session.first_name),
      last_name: cap(input.session.last_name),
      email: cap(input.session.email),
      phone: cap(input.session.phone),
      created_at: input.session.created_at
    },
    answers: buildEventAnswers(input.answers),
    tracking: buildEventTracking(input.session),
    booking,
    disqualification: reasons ? { reasons } : null
  };
}

/** The "Send test" event: a made-up lead, never real data. */
export function buildTestEvent(nowIso: string, eventUuid: string): FormBookEvent {
  return {
    id: `fbk.test.ping.${eventUuid}`,
    type: "test.ping",
    version: FORMBOOK_EVENT_VERSION,
    created_at: nowIso,
    form: { id: "00000000-0000-4000-8000-000000000000", name: "Test form", slug: "test-form" },
    lead: {
      id: eventUuid,
      status: "potential",
      full_name: "Test Lead",
      first_name: "Test",
      last_name: "Lead",
      email: "test@example.com",
      phone: "+14165550100",
      created_at: nowIso
    },
    answers: [{ key: "example_question", question: "Example question", value: "Example answer" }],
    tracking: {
      source_url: "https://example.com/book",
      referrer: null,
      landing_page_url: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      utm_id: null,
      utm_adset: null,
      utm_adid: null,
      utm_adsetid: null,
      utm_campaignid: null,
      fbclid: null,
      gclid: null,
      ttclid: null,
      country_code: null,
      region: null,
      city: null,
      split_test: null
    },
    booking: null,
    disqualification: null
  };
}

function displayValue(value: FormBookEventAnswer["value"]): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === null) return "";
  return String(value);
}

/** "Question: answer" lines, cut to maxLength characters. */
export function answerLinesText(answers: FormBookEventAnswer[], maxLength: number): string {
  const text = answers.map((answer) => `${answer.question}: ${displayValue(answer.value)}`).join("\n");
  if (text.length <= maxLength) return text;
  return text.slice(0, Math.max(0, maxLength)).trimEnd();
}

export function answersNoteText(event: FormBookEvent, maxLength: number): string {
  return answerLinesText(event.answers, maxLength);
}
