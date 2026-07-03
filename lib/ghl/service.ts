import {
  createOpportunity,
  createAppointment,
  createContactNote,
  getCalendarSlots,
  searchOpportunities,
  upsertContact,
  updateContact,
  updateOpportunity,
  type GhlRuntimeConfig
} from "@/lib/ghl/client";
import type { Funnel, Json, LeadAnswer, LeadSession, Question } from "@/lib/types/database";

const MAX_GHL_NOTE_BODY_LENGTH = 5000;
const GHL_ATTRIBUTION_FIELD_IDS = {
  device_fingerprint: "mD0nl9Bol76ktldcLQh9",
  fbclid: "NYqxiIU8Cw5MuKvZuxqU",
  fbc: "uxxBgB61uS01OOPXS6c6",
  fbp: "zelneybTWDq3nVVvi27t",
  utm_source: "LwNlb6SU9bcF5oM3umBC",
  utm_medium: "Wx41yHI1dyO4r2YN9R9B",
  utm_campaign: "N5EydZ1pHC6Mnsq7LIic",
  utm_content: "f5eU5TgjtvGyRgvQ7ygP",
  utm_term: "O6LkXOXEBmTvMAyQCfh3",
  utm_adset: "48D31CoLhFH8u6iSCnqL",
  utm_adid: "TCeKglZheFpbe06LTD95",
  utm_adsetid: "xT7tCx1XJkgGTIGXhmXI",
  utm_campaignid: "FD0XrXhntAvPrFPZPEq6"
} as const;

function getSlotStartsFromGhlResponse(result: Record<string, unknown>) {
  return Object.values(result).flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const slots = (value as { slots?: unknown }).slots;
    if (!Array.isArray(slots)) {
      return [];
    }

    return slots.filter((slot): slot is string => typeof slot === "string");
  });
}

function getZonedDateKey(startTime: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: timezone,
    year: "numeric"
  }).format(new Date(startTime));
}

function getZonedMinuteOffset(startTime: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: timezone
  }).formatToParts(new Date(startTime));

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const normalizedHour = Number.isFinite(hour) ? hour % 24 : 0;
  const normalizedMinute = Number.isFinite(minute) ? minute : 0;

  return normalizedHour * 60 + normalizedMinute;
}

function filterSlotStartsByDuration(slotStarts: string[], timezone: string, slotDurationMinutes: number) {
  const duration = Math.max(Math.round(slotDurationMinutes), 1);
  if (duration <= 15) {
    return slotStarts;
  }

  const dayAnchors = new Map<string, number>();

  return slotStarts.filter((slotStart) => {
    const dayKey = getZonedDateKey(slotStart, timezone);
    const minuteOffset = getZonedMinuteOffset(slotStart, timezone);
    const anchor = dayAnchors.get(dayKey);

    if (anchor === undefined) {
      dayAnchors.set(dayKey, minuteOffset);
      return true;
    }

    return (minuteOffset - anchor + 1440) % duration === 0;
  });
}

function getAnswerDisplayValue(answer: LeadAnswer) {
  if (answer.answer_options.length) {
    return answer.answer_options.join(", ");
  }

  if (answer.answer_number !== null) {
    return String(answer.answer_number);
  }

  return answer.answer_text?.trim() ?? "";
}

function getAnswerCustomFieldValue(answer: LeadAnswer & { question?: Question }) {
  if (answer.answer_options.length) {
    if (answer.question?.question_type === "multi_select" || answer.answer_options.length > 1) {
      return answer.answer_options;
    }

    return answer.answer_options[0];
  }

  if (answer.answer_number !== null) {
    return answer.answer_number;
  }

  return answer.answer_text?.trim() ?? "";
}

function normalizeGhlCustomFieldKey(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const mergeTagMatch = trimmed.match(/^\{\{\s*contact\.([^}\s]+)\s*\}\}$/i);
  if (mergeTagMatch?.[1]) {
    return mergeTagMatch[1];
  }

  if (trimmed.toLowerCase().startsWith("contact.")) {
    return trimmed.slice("contact.".length);
  }

  return trimmed;
}

function buildGhlAnswerCustomFields(answers: Array<LeadAnswer & { question?: Question }>) {
  return answers
    .map((answer) => {
      const id = answer.question?.ghl_custom_field_id?.trim() || undefined;
      const key = id
        ? undefined
        : normalizeGhlCustomFieldKey(answer.question?.ghl_custom_field_key ?? answer.question?.ghl_field_key);

      if (!id && !key) return null;

      return {
        id,
        key,
        fieldValue: getAnswerCustomFieldValue(answer)
      };
    })
    .filter((field): field is NonNullable<typeof field> => field !== null);
}

function isJsonRecord(value: Json): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getMetadataString(metadata: Json, key: string) {
  if (!isJsonRecord(metadata)) return undefined;

  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildGhlTrackingCustomFields(leadSession: LeadSession) {
  return [
    [GHL_ATTRIBUTION_FIELD_IDS.fbclid, getMetadataString(leadSession.metadata, "fbclid")],
    [
      GHL_ATTRIBUTION_FIELD_IDS.device_fingerprint,
      getMetadataString(leadSession.metadata, "device_fingerprint") ?? getMetadataString(leadSession.metadata, "fingerprint")
    ],
    [GHL_ATTRIBUTION_FIELD_IDS.fbc, getMetadataString(leadSession.metadata, "fbc")],
    [GHL_ATTRIBUTION_FIELD_IDS.fbp, getMetadataString(leadSession.metadata, "fbp")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_source, leadSession.utm_source?.trim() ?? getMetadataString(leadSession.metadata, "utm_source")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_medium, leadSession.utm_medium?.trim() ?? getMetadataString(leadSession.metadata, "utm_medium")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_campaign, leadSession.utm_campaign?.trim() ?? getMetadataString(leadSession.metadata, "utm_campaign")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_content, leadSession.utm_content?.trim() ?? getMetadataString(leadSession.metadata, "utm_content")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_term, leadSession.utm_term?.trim() ?? getMetadataString(leadSession.metadata, "utm_term")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_adset, getMetadataString(leadSession.metadata, "utm_adset")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_adid, getMetadataString(leadSession.metadata, "utm_adid")],
    [GHL_ATTRIBUTION_FIELD_IDS.utm_adsetid, getMetadataString(leadSession.metadata, "utm_adsetid")],
    [
      GHL_ATTRIBUTION_FIELD_IDS.utm_campaignid,
      getMetadataString(leadSession.metadata, "utm_campaignid") ?? getMetadataString(leadSession.metadata, "utm_id")
    ]
  ]
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([id, fieldValue]) => ({
      id,
      fieldValue
    }));
}

function buildGhlLeadContactCustomFields(
  leadSession: LeadSession,
  answers: Array<LeadAnswer & { question?: Question }>
) {
  return [...buildGhlTrackingCustomFields(leadSession), ...buildGhlAnswerCustomFields(answers)];
}

function truncateNoteBody(body: string) {
  if (body.length <= MAX_GHL_NOTE_BODY_LENGTH) {
    return body;
  }

  return `${body.slice(0, MAX_GHL_NOTE_BODY_LENGTH - 40).trimEnd()}\n\n[Truncated by Leadder]`;
}

export async function upsertLeadContact(
  config: GhlRuntimeConfig,
  leadSession: LeadSession,
  answers: Array<LeadAnswer & { question?: Question }>
) {
  return upsertContact(config, {
    firstName: leadSession.first_name ?? undefined,
    lastName: leadSession.last_name ?? undefined,
    name: leadSession.full_name ?? undefined,
    email: leadSession.email ?? undefined,
    phone: leadSession.phone ?? undefined,
    customFields: buildGhlLeadContactCustomFields(leadSession, answers)
  });
}

export async function updateLeadContactAnswers(
  config: GhlRuntimeConfig,
  leadSession: LeadSession,
  contactId: string,
  answers: Array<LeadAnswer & { question?: Question }>
) {
  return updateContact(config, contactId, {
    firstName: leadSession.first_name ?? undefined,
    lastName: leadSession.last_name ?? undefined,
    name: leadSession.full_name ?? undefined,
    email: leadSession.email ?? undefined,
    phone: leadSession.phone ?? undefined,
    customFields: buildGhlLeadContactCustomFields(leadSession, answers)
  });
}

export async function createLeadAnswersContactNote(
  config: GhlRuntimeConfig,
  leadSession: LeadSession,
  contactId: string,
  answers: Array<LeadAnswer & { question?: Question }>
) {
  const answeredQuestions = answers
    .map((answer) => ({
      label: answer.question?.label ?? answer.question_stable_key,
      value: getAnswerDisplayValue(answer)
    }))
    .filter((answer) => answer.value.length > 0);

  if (!answeredQuestions.length) {
    return null;
  }

  const body = truncateNoteBody(
    [
      "Leadder survey answers",
      `Lead session: ${leadSession.id}`,
      leadSession.source_url ? `Source URL: ${leadSession.source_url}` : null,
      "",
      ...answeredQuestions.map((answer) => `${answer.label}: ${answer.value}`)
    ]
      .filter((line): line is string => line !== null)
      .join("\n")
  );

  return createContactNote(config, {
    contactId,
    title: "Leadder Survey Answers",
    body,
    color: "#4f9a78",
    pinned: false
  });
}

function compactName(...parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildOpportunityName(funnel: Funnel, leadSession: LeadSession) {
  const leadName =
    leadSession.full_name?.trim() ||
    compactName(leadSession.first_name, leadSession.last_name) ||
    leadSession.email?.trim() ||
    leadSession.phone?.trim() ||
    "Lead";

  const opportunityName = funnel.opportunity_name_template
    .replaceAll("{{lead_name}}", leadName)
    .replaceAll("{{lead_full_name}}", leadName)
    .replaceAll("{{first_name}}", leadSession.first_name?.trim() ?? "")
    .replaceAll("{{last_name}}", leadSession.last_name?.trim() ?? "")
    .replaceAll("{{email}}", leadSession.email?.trim() ?? "")
    .replaceAll("{{phone}}", leadSession.phone?.trim() ?? "")
    .replaceAll("{{funnel_name}}", funnel.name)
    .replaceAll("{{funnel_slug}}", funnel.slug)
    .replace(/\s+/g, " ")
    .trim();

  return opportunityName || leadName;
}

export async function ensureGhlOpportunity(input: {
  config: GhlRuntimeConfig;
  funnel: Funnel;
  leadSession: LeadSession;
  contactId: string;
  stage: "opt_in" | "booked" | "disqualified";
}) {
  const pipelineId = {
    opt_in: input.funnel.opt_in_pipeline_id,
    booked: input.funnel.booked_pipeline_id,
    disqualified: input.funnel.disqualified_pipeline_id
  }[input.stage];
  const pipelineStageId = {
    opt_in: input.funnel.opt_in_pipeline_stage_id,
    booked: input.funnel.booked_pipeline_stage_id,
    disqualified: input.funnel.disqualified_pipeline_stage_id
  }[input.stage];

  if (!pipelineId || !pipelineStageId) {
    const label = {
      opt_in: "call-not-booked",
      booked: "booked-call",
      disqualified: "disqualified"
    }[input.stage];
    throw new Error(`Missing ${label} pipeline settings for this funnel.`);
  }

  let opportunityId = input.leadSession.ghl_opportunity_id ?? undefined;
  if (!opportunityId) {
    const search = await searchOpportunities(input.config, {
      contactId: input.contactId,
      pipelineId,
      status: "open"
    });
    opportunityId = search.opportunities.find((opportunity) => opportunity.contactId === input.contactId)?.id;
  }

  const opportunityPayload = {
    pipelineId,
    pipelineStageId,
    name: buildOpportunityName(input.funnel, input.leadSession),
    status: "open" as const,
    source: `Leadder:${input.funnel.slug}`
  };

  const result = opportunityId
    ? await updateOpportunity(input.config, {
        id: opportunityId,
        ...opportunityPayload
      })
    : await createOpportunity(input.config, {
        contactId: input.contactId,
        ...opportunityPayload
      });

  const resolvedId = result.opportunity?.id ?? result.id ?? opportunityId;
  if (!resolvedId) {
    throw new Error("GHL opportunity response did not include an opportunity id.");
  }

  return resolvedId;
}

export async function lookupAvailability(
  config: GhlRuntimeConfig,
  calendarId: string,
  timezone: string,
  slotDurationMinutes: number,
  availabilityWindowDays: number
) {
  const now = new Date();
  const startDate = String(now.getTime());
  const boundedWindowDays = Math.min(Math.max(availabilityWindowDays, 1), 60);
  const endDate = String(new Date(now.getTime() + 1000 * 60 * 60 * 24 * boundedWindowDays).getTime());
  const result = await getCalendarSlots(config, calendarId, startDate, endDate, timezone);
  const uniqueSlotStarts = Array.from(new Set(getSlotStartsFromGhlResponse(result))).sort(
    (firstSlot, secondSlot) => new Date(firstSlot).getTime() - new Date(secondSlot).getTime()
  );

  return filterSlotStartsByDuration(uniqueSlotStarts, timezone, slotDurationMinutes)
    .map((slotStart) => {
      const start = new Date(slotStart);
      const end = new Date(start.getTime() + slotDurationMinutes * 60 * 1000);
      return {
        startTime: slotStart,
        endTime: end.toISOString(),
        timezone
      };
    });
}

export async function bookGhlAppointment(input: {
  config: GhlRuntimeConfig;
  calendarId: string;
  contactId: string;
  slotStart: string;
  slotEnd: string;
  timezone: string;
  title?: string;
}) {
  return createAppointment(input.config, {
    calendarId: input.calendarId,
    contactId: input.contactId,
    startTime: input.slotStart,
    endTime: input.slotEnd,
    timezone: input.timezone,
    title: input.title
  });
}
