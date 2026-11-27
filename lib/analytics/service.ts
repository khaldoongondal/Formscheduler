import { unstable_noStore as noStore } from "next/cache";
import {
  matchesAnalyticsTargetCountries,
  matchesAnalyticsTrafficSources,
  resolveAnalyticsTargetCountryCodes,
  resolveAnalyticsTrafficSources
} from "@/lib/analytics/country-filter";
import {
  buildDropOffRows,
  computeStageCounts,
  rate,
  unionSets,
  visitorIdentity,
  type FunnelDropOffStepRow,
  type StageCounts,
  type VisitorEventRow
} from "@/lib/analytics/funnel-math";
import { chunk, mapInBatches, selectAllByKeyset, selectAllPages } from "@/lib/supabase/paging";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  AnalyticsEvent,
  AnalyticsEventType,
  Json,
  LeadSession,
  LeadStatusHistory,
  Question
} from "@/lib/types/database";

export type { FunnelDropOffStepRow, StageCounts } from "@/lib/analytics/funnel-math";

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
  /** Running split test this event belongs to (checked by the caller). */
  splitTestId?: string | null;
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
  /** Funnel stages per distinct visitor (Sprint 2): starts, qualified, disqualified, calendar shown. */
  stageCounts: StageCounts;
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

const percentage = rate;
const getVisitorIdentity = visitorIdentity;

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
  const row: Record<string, unknown> = {
    tenant_id: input.tenantId,
    funnel_id: input.funnelId ?? null,
    lead_session_id: input.leadSessionId ?? null,
    visitor_id: input.visitorId ?? null,
    event_type: input.eventType,
    source: input.source ?? "app",
    source_url: input.sourceUrl ?? null,
    user_agent: input.userAgent ?? null,
    metadata: input.metadata ?? {}
  };
  // The column is only sent when there is a test, so rows without one keep
  // working on a database without migration 0025.
  if (input.splitTestId) row.split_test_id = input.splitTestId;

  const { data, error } = await supabase.from("analytics_events").insert(row).select("id").single();
  if (error && input.splitTestId && isMissingColumnError(error)) {
    const { split_test_id: _dropped, ...withoutTest } = row;
    void _dropped;
    const retry = await supabase.from("analytics_events").insert(withoutTest).select("id").single();
    if (retry.error) throw new Error(retry.error.message);
    return { id: retry.data.id as string };
  }

  if (error) throw new Error(error.message);
  return { id: data.id as string };
}

function isMissingColumnError(error: { code?: string; message?: string }) {
  return error.code === "42703" || error.code === "PGRST204" || /split_test_id/.test(error.message ?? "");
}

function getEventVisitorIds(events: AnalyticsEvent[], eventType?: AnalyticsEventType) {
  return new Set(
    events
      .filter((event) => !eventType || event.event_type === eventType)
      .map((event) => getVisitorIdentity(event))
  );
}

function stepEventsFor(events: AnalyticsEvent[]): VisitorEventRow[] {
  return events.map((event) => ({
    id: event.id,
    visitor_id: event.visitor_id,
    funnel_id: event.funnel_id,
    event_type: event.event_type,
    step_key: getMetadataString(event.metadata, "step_key")
  }));
}

const PERFORMANCE_HISTORY_STATUSES = ["potential", "qualified", "slots_shown", "booked", "disqualified"] as const;
const SESSION_ID_CHUNK = 200;

/**
 * Status history rows in range. With a form id, only that form's rows are
 * read (inner join on its lead session), not every form in the tenant.
 */
async function loadPerformanceHistory(
  supabase: ReturnType<typeof createServiceClient>,
  tenantId: string,
  fromIso: string,
  toIso: string,
  funnelId?: string
): Promise<LeadStatusHistory[]> {
  const rows = await selectAllByKeyset<LeadStatusHistory>((afterId, limit) => {
    let query = supabase
      .from("lead_status_history")
      .select(funnelId ? "*, lead_sessions!inner(funnel_id)" : "*")
      .eq("tenant_id", tenantId)
      .in("to_status", [...PERFORMANCE_HISTORY_STATUSES])
      .gte("created_at", fromIso)
      .lte("created_at", toIso);
    if (funnelId) query = query.eq("lead_sessions.funnel_id", funnelId);
    if (afterId) query = query.gt("id", afterId);
    return query.order("id", { ascending: true }).limit(limit) as unknown as PromiseLike<{
      data: LeadStatusHistory[] | null;
      error: { message: string } | null;
    }>;
  });
  if (!funnelId) return rows;
  return rows.map((row) => {
    const { lead_sessions: _joined, ...history } = row as LeadStatusHistory & { lead_sessions?: unknown };
    void _joined;
    return history as LeadStatusHistory;
  });
}

/**
 * Per-form analytics for a date range. Every query is paged (PostgREST returns
 * at most 1000 rows per request) and lead sessions are loaded only when a
 * history row in range points at them. Pass `funnelId` to load one form.
 */
export async function getFunnelPerformance(
  tenantId: string,
  range: AnalyticsDateRange,
  opts?: { funnelId?: string }
) {
  noStore();
  const supabase = createServiceClient();
  const funnelId = opts?.funnelId;
  const fromIso = range.from.toISOString();
  const toIso = range.to.toISOString();

  const funnelsQuery = supabase.from("funnels").select("*").eq("tenant_id", tenantId);
  const questionsQuery = supabase
    .from("questions")
    .select("id,funnel_id,label,display_order")
    .eq("tenant_id", tenantId);
  const [funnelsResult, questionsResult, events, history] = await Promise.all([
    (funnelId ? funnelsQuery.eq("id", funnelId) : funnelsQuery).order("created_at", { ascending: false }),
    (funnelId ? questionsQuery.eq("funnel_id", funnelId) : questionsQuery).order("display_order", { ascending: true }),
    selectAllByKeyset<AnalyticsEvent>((afterId, limit) => {
      let query = supabase
        .from("analytics_events")
        .select("*")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", fromIso)
        .lte("occurred_at", toIso);
      if (funnelId) query = query.eq("funnel_id", funnelId);
      if (afterId) query = query.gt("id", afterId);
      return query.order("id", { ascending: true }).limit(limit);
    }),
    loadPerformanceHistory(supabase, tenantId, fromIso, toIso, funnelId)
  ]);

  if (funnelsResult.error) throw new Error(funnelsResult.error.message);
  if (questionsResult.error) throw new Error(questionsResult.error.message);

  const sessionIds = [...new Set(history.map((row) => row.lead_session_id))];
  const sessionChunks = await mapInBatches(chunk(sessionIds, SESSION_ID_CHUNK), 5, (ids) =>
    selectAllPages<LeadSession>((from, to) => {
      const query = supabase.from("lead_sessions").select("*").eq("tenant_id", tenantId).in("id", ids);
      return (funnelId ? query.eq("funnel_id", funnelId) : query).order("id", { ascending: true }).range(from, to);
    })
  );
  const sessions = sessionChunks.flat();

  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const questionsByFunnelId = new Map<string, Array<Pick<Question, "id" | "label">>>();
  questionsResult.data.forEach((question) => {
    const questions = questionsByFunnelId.get(question.funnel_id) ?? [];
    questions.push(question);
    questionsByFunnelId.set(question.funnel_id, questions);
  });

  return funnelsResult.data.map((funnel): FunnelPerformanceRow => {
    const targetCountryCodes = resolveAnalyticsTargetCountryCodes(funnel.qualification_rule);
    const targetTrafficSources = resolveAnalyticsTrafficSources(funnel.qualification_rule);
    const funnelEvents = events.filter(
      (event) =>
        event.funnel_id === funnel.id &&
        matchesAnalyticsTargetCountries(event.metadata, targetCountryCodes) &&
        matchesAnalyticsTrafficSources(event.metadata, targetTrafficSources, {
          source_url: event.source_url
        })
    );
    const pageViewVisitorIds = getEventVisitorIds(funnelEvents, "page_view");
    const stepViewVisitorIds = getEventVisitorIds(funnelEvents, "step_view");
    const splitRowsByKey = new Map<string, SplitAggregation>();

    funnelEvents.forEach((event) => {
      const split = getSplitIdentityOrUntagged(event.metadata);
      const splitRow = getSplitAggregation(splitRowsByKey, split);
      splitRow.visitorIds.add(getVisitorIdentity(event));
    });

    const stageHistory = history.filter((history) => {
      const session = sessionById.get(history.lead_session_id);
      return (
        session?.funnel_id === funnel.id &&
        matchesAnalyticsTargetCountries(session.metadata, targetCountryCodes) &&
        matchesAnalyticsTrafficSources(session.metadata, targetTrafficSources, session)
      );
    });
    const stageSessionIds = new Set(stageHistory.map((history) => history.lead_session_id));
    const stageCounts = computeStageCounts(
      stepEventsFor(funnelEvents),
      sessions
        .filter((session) => stageSessionIds.has(session.id))
        .map((session) => ({ id: session.id, visitor_id: session.visitor_id, funnel_id: session.funnel_id })),
      stageHistory
    );
    // "qualified" rows feed only the stage counts; every older figure uses the
    // same statuses as before, so its values do not change.
    const funnelHistory = stageHistory.filter((history) => history.to_status !== "qualified");
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
      const identity = getVisitorIdentity(session);
      splitRow.visitorIds.add(identity);

      if (history.to_status === "potential") {
        splitRow.optInVisitorIds.add(identity);
      }

      if (history.to_status === "booked") {
        splitRow.bookedVisitorIds.add(identity);
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
      events: stepEventsFor(funnelEvents),
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
      dropOffSteps,
      stageCounts: {
        visitors: stageCounts.visitors,
        starts: stageCounts.starts,
        leads: stageCounts.leads,
        qualified: stageCounts.qualified,
        disqualified: stageCounts.disqualified,
        calendarShown: stageCounts.calendarShown,
        bookings: stageCounts.bookings
      }
    };
  });
}

export async function getFunnelAnalytics(funnelId: string, range = resolveAnalyticsDateRange()) {
  const supabase = createServiceClient();
  const { data: funnel, error: funnelError } = await supabase
    .from("funnels")
    .select("id,tenant_id")
    .eq("id", funnelId)
    .single();
  if (funnelError) throw new Error(funnelError.message);

  const rows = await getFunnelPerformance(funnel.tenant_id, range, { funnelId });
  return rows.find((row) => row.funnelId === funnelId) ?? null;
}
