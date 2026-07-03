import { unstable_noStore as noStore } from "next/cache";
import {
  matchesAnalyticsTargetCountries,
  matchesAnalyticsTrafficSources,
  resolveAnalyticsTargetCountryCodes,
  resolveAnalyticsTrafficSources
} from "@/lib/analytics/country-filter";
import {
  contactFieldOptions,
  resolveContactFieldConfig,
  resolveIntakeFlowOrder,
  type ContactFieldKey
} from "@/lib/funnels/contact-fields";
import { createServiceClient } from "@/lib/supabase/server";
import type { AnalyticsEvent, AnalyticsEventType, Funnel, Json, Question } from "@/lib/types/database";

export type AnalyticsPreset = "today" | "yesterday" | "last_7_days" | "last_30_days" | "custom";

interface TrackEventInput {
  tenantId: string;
  funnelId?: string;
  leadSessionId?: string;
  visitorId?: string;
  eventType: AnalyticsEventType;
  source?: string;
  sourceUrl?: string;
  userAgent?: string;
  metadata?: Json;
}

export interface AnalyticsDateRange {
  from: Date;
  to: Date;
  preset: AnalyticsPreset;
}

export interface FunnelPerformanceRow {
  funnelId: string;
  funnelName: string;
  funnelSlug: string;
  uniqueVisitors: number;
  optInCount: number;
  optInRate: number;
  callsBookedCount: number;
  callBookingRate: number;
  visitorToBookedRate: number;
  targetCountryCodes: string[];
  targetTrafficSources: string[];
  splitVariants: SplitVariantPerformanceRow[];
  dropOffSteps: FunnelDropOffStepRow[];
}

export interface SplitVariantPerformanceRow {
  splitTestId: string;
  splitVariant: string;
  uniqueVisitors: number;
  optInCount: number;
  optInRate: number;
  callsBookedCount: number;
  callBookingRate: number;
  visitorToBookedRate: number;
}

export interface FunnelDropOffStepRow {
  stepKey: string;
  stepLabel: string;
  stepType: "page_view" | "contact" | "question" | "calendar";
  uniqueVisitors: number;
  continuedCount: number;
  dropOffCount: number;
  dropOffRate: number;
}

interface AnalyticsFlowStep {
  stepKey: string;
  stepLabel: string;
  stepType: FunnelDropOffStepRow["stepType"];
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

export function resolveAnalyticsDateRange(input?: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
}): AnalyticsDateRange {
  const now = new Date();
  const preset = (input?.preset ?? "last_7_days") as AnalyticsPreset;

  if (preset === "today") {
    return { preset, from: startOfDay(now), to: endOfDay(now) };
  }

  if (preset === "yesterday") {
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    return { preset, from: startOfDay(yesterday), to: endOfDay(yesterday) };
  }

  if (preset === "last_30_days") {
    const from = startOfDay(new Date(now));
    from.setDate(from.getDate() - 29);
    return { preset, from, to: endOfDay(now) };
  }

  if (preset === "custom" && input?.from && input?.to) {
    return {
      preset,
      from: startOfDay(new Date(input.from)),
      to: endOfDay(new Date(input.to))
    };
  }

  const from = startOfDay(new Date(now));
  from.setDate(from.getDate() - 6);
  return { preset: "last_7_days", from, to: endOfDay(now) };
}

function percentage(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function getVisitorIdentity(input: { id: string; visitor_id?: string | null }) {
  return input.visitor_id ?? input.id;
}

function isJsonRecord(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getMetadataString(metadata: Json, key: string) {
  if (!isJsonRecord(metadata)) return null;
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getSplitIdentity(metadata: Json) {
  const splitTestId = getMetadataString(metadata, "split_test_id");
  const splitVariant = getMetadataString(metadata, "split_variant");

  if (!splitTestId && !splitVariant) {
    return null;
  }

  return {
    splitTestId: splitTestId ?? "default",
    splitVariant: splitVariant ?? "unknown"
  };
}

function getSplitIdentityOrUntagged(metadata: Json) {
  return (
    getSplitIdentity(metadata) ?? {
      splitTestId: "No split tag",
      splitVariant: "untagged"
    }
  );
}

function getContactFieldLabel(fieldKey: ContactFieldKey) {
  return contactFieldOptions.find((field) => field.key === fieldKey)?.label ?? fieldKey.replace("_", " ");
}

function buildAnalyticsFlowSteps(
  funnel: Pick<Funnel, "qualification_rule">,
  questions: Array<Pick<Question, "id" | "label">>
): AnalyticsFlowStep[] {
  const contactFieldConfig = resolveContactFieldConfig(funnel.qualification_rule);
  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const questionIds = questions.map((question) => question.id);
  const flowItems = resolveIntakeFlowOrder(funnel.qualification_rule, questionIds);
  const steps: AnalyticsFlowStep[] = [];
  const pendingContactFields: ContactFieldKey[] = [];

  const flushContactFields = () => {
    while (pendingContactFields.length) {
      const fields = pendingContactFields.splice(0, contactFieldConfig.fieldsPerPage);
      steps.push({
        stepKey: `contact:${steps.length + 1}:${fields.join(",")}`,
        stepLabel: `Contact: ${fields.map(getContactFieldLabel).join(" + ")}`,
        stepType: "contact"
      });
    }
  };

  for (const item of flowItems) {
    if (item.type === "contact") {
      if (contactFieldConfig.settings[item.key]) {
        pendingContactFields.push(item.key);
      }
      continue;
    }

    flushContactFields();
    const question = questionsById.get(item.id);
    if (question) {
      steps.push({
        stepKey: `question:${question.id}`,
        stepLabel: question.label,
        stepType: "question"
      });
    }
  }

  flushContactFields();
  return steps;
}

function getEventStepKey(event: Pick<AnalyticsEvent, "metadata">) {
  return getMetadataString(event.metadata, "step_key");
}

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }

  map.set(key, new Set([value]));
}

function unionSets(...sets: Array<Set<string> | undefined>) {
  const union = new Set<string>();
  sets.forEach((set) => {
    set?.forEach((value) => union.add(value));
  });
  return union;
}

function intersectSize(left: Set<string>, right: Set<string>) {
  let count = 0;
  left.forEach((value) => {
    if (right.has(value)) count += 1;
  });
  return count;
}

function getEventVisitorIds(events: AnalyticsEvent[], eventType?: AnalyticsEventType) {
  return new Set(
    events
      .filter((event) => !eventType || event.event_type === eventType)
      .map((event) => getVisitorIdentity(event))
  );
}

function buildDropOffRows(input: {
  bookedVisitorIds: Set<string>;
  disqualifiedVisitorIds: Set<string>;
  events: AnalyticsEvent[];
  funnel: Pick<Funnel, "qualification_rule">;
  pageViewVisitorIds: Set<string>;
  questions: Array<Pick<Question, "id" | "label">>;
  slotsShownVisitorIds: Set<string>;
}) {
  const stepViewEvents = input.events.filter((event) => event.event_type === "step_view");
  if (!stepViewEvents.length) return [];

  const visitorsByStepKey = new Map<string, Set<string>>();
  stepViewEvents.forEach((event) => {
    const stepKey = getEventStepKey(event);
    if (!stepKey) return;
    addToSetMap(visitorsByStepKey, stepKey, getVisitorIdentity(event));
  });

  const intakeSteps = buildAnalyticsFlowSteps(input.funnel, input.questions);
  const calendarStep: AnalyticsFlowStep = {
    stepKey: "slots",
    stepLabel: "Calendar availability",
    stepType: "calendar"
  };
  const steps: AnalyticsFlowStep[] = [
    { stepKey: "page_view", stepLabel: "Page loaded", stepType: "page_view" },
    ...intakeSteps,
    calendarStep
  ];
  const rawVisitorsByStep = steps.map((step) => {
    if (step.stepType === "page_view") return input.pageViewVisitorIds;
    if (step.stepType === "calendar") {
      return unionSets(visitorsByStepKey.get(step.stepKey), input.slotsShownVisitorIds, input.bookedVisitorIds);
    }

    return visitorsByStepKey.get(step.stepKey) ?? new Set<string>();
  });
  const enteredByStep: Set<string>[] = [];

  for (let index = steps.length - 1; index >= 0; index -= 1) {
    enteredByStep[index] = unionSets(rawVisitorsByStep[index], enteredByStep[index + 1]);
  }

  return steps
    .map((step, index): FunnelDropOffStepRow => {
      const entered = enteredByStep[index] ?? new Set<string>();
      const continuedVisitors =
        step.stepType === "calendar"
          ? input.bookedVisitorIds
          : unionSets(enteredByStep[index + 1], input.disqualifiedVisitorIds);
      const continuedCount = intersectSize(entered, continuedVisitors);
      const dropOffCount = Math.max(entered.size - continuedCount, 0);

      return {
        stepKey: step.stepKey,
        stepLabel: step.stepLabel,
        stepType: step.stepType,
        uniqueVisitors: entered.size,
        continuedCount,
        dropOffCount,
        dropOffRate: percentage(dropOffCount, entered.size)
      };
    })
    .filter((row) => row.uniqueVisitors > 0 || row.stepType !== "page_view");
}

type SplitAggregation = SplitVariantPerformanceRow & {
  bookedVisitorIds: Set<string>;
  optInVisitorIds: Set<string>;
  visitorIds: Set<string>;
};

function getSplitAggregation(
  splitRowsByKey: Map<string, SplitAggregation>,
  split: { splitTestId: string; splitVariant: string }
) {
  const key = `${split.splitTestId}:${split.splitVariant}`;
  const existing = splitRowsByKey.get(key);
  if (existing) return existing;

  const created: SplitAggregation = {
    splitTestId: split.splitTestId,
    splitVariant: split.splitVariant,
    uniqueVisitors: 0,
    optInCount: 0,
    optInRate: 0,
    callsBookedCount: 0,
    callBookingRate: 0,
    visitorToBookedRate: 0,
    visitorIds: new Set<string>(),
    optInVisitorIds: new Set<string>(),
    bookedVisitorIds: new Set<string>()
  };
  splitRowsByKey.set(key, created);
  return created;
}

function compareSplitVariants(left: SplitVariantPerformanceRow, right: SplitVariantPerformanceRow) {
  const preferredOrder = new Map([
    ["control", 0],
    ["variation", 1],
    ["untagged", 2]
  ]);
  const leftOrder = preferredOrder.get(left.splitVariant.toLowerCase()) ?? 10;
  const rightOrder = preferredOrder.get(right.splitVariant.toLowerCase()) ?? 10;

  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  if (left.splitTestId !== right.splitTestId) return left.splitTestId.localeCompare(right.splitTestId);
  return left.splitVariant.localeCompare(right.splitVariant);
}

export async function trackEvent(input: TrackEventInput) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("analytics_events").insert({
    tenant_id: input.tenantId,
    funnel_id: input.funnelId ?? null,
    lead_session_id: input.leadSessionId ?? null,
    visitor_id: input.visitorId ?? null,
    event_type: input.eventType,
    source: input.source ?? "app",
    source_url: input.sourceUrl ?? null,
    user_agent: input.userAgent ?? null,
    metadata: input.metadata ?? {}
  });

  if (error) throw new Error(error.message);
}

export async function getFunnelPerformance(tenantId: string, range: AnalyticsDateRange) {
  noStore();
  const supabase = createServiceClient();
  const [funnelsResult, eventsResult, historyResult, sessionsResult, questionsResult] = await Promise.all([
    supabase.from("funnels").select("*").eq("tenant_id", tenantId).order("created_at", { ascending: false }),
    supabase
      .from("analytics_events")
      .select("*")
      .eq("tenant_id", tenantId)
      .gte("occurred_at", range.from.toISOString())
      .lte("occurred_at", range.to.toISOString()),
    supabase
      .from("lead_status_history")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("to_status", ["potential", "slots_shown", "booked", "disqualified"])
      .gte("created_at", range.from.toISOString())
      .lte("created_at", range.to.toISOString()),
    supabase.from("lead_sessions").select("*").eq("tenant_id", tenantId),
    supabase
      .from("questions")
      .select("id,funnel_id,label,display_order")
      .eq("tenant_id", tenantId)
      .order("display_order", { ascending: true })
  ]);

  if (funnelsResult.error) throw new Error(funnelsResult.error.message);
  if (eventsResult.error) throw new Error(eventsResult.error.message);
  if (historyResult.error) throw new Error(historyResult.error.message);
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);
  if (questionsResult.error) throw new Error(questionsResult.error.message);

  const sessionById = new Map(sessionsResult.data.map((session) => [session.id, session]));
  const questionsByFunnelId = new Map<string, Array<Pick<Question, "id" | "label">>>();
  questionsResult.data.forEach((question) => {
    const questions = questionsByFunnelId.get(question.funnel_id) ?? [];
    questions.push(question);
    questionsByFunnelId.set(question.funnel_id, questions);
  });

  return funnelsResult.data.map((funnel): FunnelPerformanceRow => {
    const targetCountryCodes = resolveAnalyticsTargetCountryCodes(funnel.qualification_rule);
    const targetTrafficSources = resolveAnalyticsTrafficSources(funnel.qualification_rule);
    const events = eventsResult.data.filter(
      (event) =>
        event.funnel_id === funnel.id &&
        matchesAnalyticsTargetCountries(event.metadata, targetCountryCodes) &&
        matchesAnalyticsTrafficSources(event.metadata, targetTrafficSources, {
          source_url: event.source_url
        })
    ) as AnalyticsEvent[];
    const pageViewVisitorIds = getEventVisitorIds(events, "page_view");
    const stepViewVisitorIds = getEventVisitorIds(events, "step_view");
    const splitRowsByKey = new Map<string, SplitAggregation>();

    events.forEach((event) => {
      const split = getSplitIdentityOrUntagged(event.metadata);
      const splitRow = getSplitAggregation(splitRowsByKey, split);
      splitRow.visitorIds.add(getVisitorIdentity(event));
    });

    const funnelHistory = historyResult.data.filter((history) => {
      const session = sessionById.get(history.lead_session_id);
      return (
        session?.funnel_id === funnel.id &&
        matchesAnalyticsTargetCountries(session.metadata, targetCountryCodes) &&
        matchesAnalyticsTrafficSources(session.metadata, targetTrafficSources, session)
      );
    });
    const optInVisitorIds = new Set(
      funnelHistory
        .filter((history) => history.to_status === "potential")
        .map((history) => sessionById.get(history.lead_session_id))
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
        .map((session) => getVisitorIdentity(session))
    );
    const bookedVisitorIds = new Set(
      funnelHistory
        .filter((history) => history.to_status === "booked")
        .map((history) => sessionById.get(history.lead_session_id))
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
        .map((session) => getVisitorIdentity(session))
    );
    const slotsShownVisitorIds = new Set(
      funnelHistory
        .filter((history) => history.to_status === "slots_shown")
        .map((history) => sessionById.get(history.lead_session_id))
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
        .map((session) => getVisitorIdentity(session))
    );
    const disqualifiedVisitorIds = new Set(
      funnelHistory
        .filter((history) => history.to_status === "disqualified")
        .map((history) => sessionById.get(history.lead_session_id))
        .filter((session): session is NonNullable<typeof session> => Boolean(session))
        .map((session) => getVisitorIdentity(session))
    );

    funnelHistory.forEach((history) => {
      const session = sessionById.get(history.lead_session_id);
      if (!session) return;

      const split = getSplitIdentityOrUntagged(session.metadata);

      const splitRow = getSplitAggregation(splitRowsByKey, split);
      const visitorIdentity = getVisitorIdentity(session);
      splitRow.visitorIds.add(visitorIdentity);

      if (history.to_status === "potential") {
        splitRow.optInVisitorIds.add(visitorIdentity);
      }

      if (history.to_status === "booked") {
        splitRow.bookedVisitorIds.add(visitorIdentity);
      }
    });

    const funnelVisitorIds = unionSets(
      pageViewVisitorIds,
      stepViewVisitorIds,
      optInVisitorIds,
      slotsShownVisitorIds,
      bookedVisitorIds,
      disqualifiedVisitorIds
    );
    const uniqueVisitors = funnelVisitorIds.size;
    const splitVariants = Array.from(splitRowsByKey.values())
      .map((row): SplitVariantPerformanceRow => {
        const uniqueSplitVisitors = row.visitorIds.size;
        return {
          splitTestId: row.splitTestId,
          splitVariant: row.splitVariant,
          uniqueVisitors: uniqueSplitVisitors,
          optInCount: row.optInVisitorIds.size,
          optInRate: percentage(row.optInVisitorIds.size, uniqueSplitVisitors),
          callsBookedCount: row.bookedVisitorIds.size,
          callBookingRate: percentage(row.bookedVisitorIds.size, row.optInVisitorIds.size),
          visitorToBookedRate: percentage(row.bookedVisitorIds.size, uniqueSplitVisitors)
        };
      })
      .sort(compareSplitVariants);
    const dropOffSteps = buildDropOffRows({
      bookedVisitorIds,
      disqualifiedVisitorIds,
      events,
      funnel,
      pageViewVisitorIds: funnelVisitorIds,
      questions: questionsByFunnelId.get(funnel.id) ?? [],
      slotsShownVisitorIds
    });

    return {
      funnelId: funnel.id,
      funnelName: funnel.name,
      funnelSlug: funnel.slug,
      uniqueVisitors,
      optInCount: optInVisitorIds.size,
      optInRate: percentage(optInVisitorIds.size, uniqueVisitors),
      callsBookedCount: bookedVisitorIds.size,
      callBookingRate: percentage(bookedVisitorIds.size, optInVisitorIds.size),
      visitorToBookedRate: percentage(bookedVisitorIds.size, uniqueVisitors),
      targetCountryCodes,
      targetTrafficSources,
      splitVariants,
      dropOffSteps
    };
  });
}

export async function getFunnelAnalytics(funnelId: string, range = resolveAnalyticsDateRange()) {
  const supabase = createServiceClient();
  const { data: funnel, error: funnelError } = await supabase
    .from("funnels")
    .select("*")
    .eq("id", funnelId)
    .single();
  if (funnelError) throw new Error(funnelError.message);

  const rows = await getFunnelPerformance(funnel.tenant_id, range);
  return rows.find((row) => row.funnelId === funnelId) ?? null;
}
