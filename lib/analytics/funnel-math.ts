/**
 * Pure funnel maths shared by the form analytics and the split test results.
 * No Next or Supabase imports, so node:test loads it directly.
 */
import {
  contactFieldOptions,
  resolveContactFieldConfig,
  resolveIntakeFlowOrder,
  type ContactFieldKey
} from "@/lib/funnels/contact-fields";
import type { AnalyticsEventType, Funnel, LeadSessionStatus, Question } from "@/lib/types/database";

export type VisitorEventRow = {
  id: string;
  visitor_id: string | null;
  funnel_id: string | null;
  event_type: AnalyticsEventType;
  step_key: string | null;
};
export type SessionRow = { id: string; visitor_id: string | null; funnel_id: string };
export type HistoryRow = { lead_session_id: string; to_status: LeadSessionStatus };

export type StageCounts = {
  visitors: number;
  starts: number;
  leads: number;
  qualified: number;
  disqualified: number;
  calendarShown: number;
  bookings: number;
};
export type StageSets = {
  visitors: Set<string>;
  starts: Set<string>;
  leads: Set<string>;
  qualified: Set<string>;
  disqualified: Set<string>;
  calendarShown: Set<string>;
  bookings: Set<string>;
};
export type StageRates = {
  visitorToStart: number;
  startToLead: number;
  leadToBooking: number;
  visitorToBooking: number;
};

export interface FunnelDropOffStepRow {
  stepKey: string;
  stepLabel: string;
  stepType: "page_view" | "contact" | "question" | "calendar";
  uniqueVisitors: number;
  continuedCount: number;
  dropOffCount: number;
  dropOffRate: number;
}

export interface AnalyticsFlowStep {
  stepKey: string;
  stepLabel: string;
  stepType: FunnelDropOffStepRow["stepType"];
}

export const EMPTY_STAGE_COUNTS: StageCounts = {
  visitors: 0,
  starts: 0,
  leads: 0,
  qualified: 0,
  disqualified: 0,
  calendarShown: 0,
  bookings: 0
};

/** A visitor is counted by visitor id, else by the row id (like the form analytics). */
export function visitorIdentity(row: { id: string; visitor_id?: string | null }): string {
  return row.visitor_id ?? row.id;
}

/** numerator / denominator, or 0 when the denominator is 0. */
export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

const HISTORY_STAGE: Partial<Record<LeadSessionStatus, keyof StageSets>> = {
  potential: "leads",
  qualified: "qualified",
  disqualified: "disqualified",
  slots_shown: "calendarShown",
  booked: "bookings"
};

/**
 * Stage counts per distinct visitor identity:
 * visitors = every event and every session; starts = a form_start event or a
 * lead session; leads, qualified, disqualified, calendar shown and bookings =
 * sessions whose history reached that status. History rows for sessions that
 * are not in `sessions` are ignored.
 */
export function computeStageCounts(
  events: VisitorEventRow[],
  sessions: SessionRow[],
  history: HistoryRow[]
): StageCounts & { sets: StageSets } {
  const sets: StageSets = {
    visitors: new Set(),
    starts: new Set(),
    leads: new Set(),
    qualified: new Set(),
    disqualified: new Set(),
    calendarShown: new Set(),
    bookings: new Set()
  };

  for (const event of events) {
    const identity = visitorIdentity(event);
    sets.visitors.add(identity);
    if (event.event_type === "form_start") sets.starts.add(identity);
  }

  const sessionById = new Map<string, SessionRow>();
  for (const session of sessions) {
    sessionById.set(session.id, session);
    const identity = visitorIdentity(session);
    sets.visitors.add(identity);
    sets.starts.add(identity);
  }

  for (const row of history) {
    const stage = HISTORY_STAGE[row.to_status];
    if (!stage) continue;
    const session = sessionById.get(row.lead_session_id);
    if (!session) continue;
    sets[stage].add(visitorIdentity(session));
  }

  return {
    visitors: sets.visitors.size,
    starts: sets.starts.size,
    leads: sets.leads.size,
    qualified: sets.qualified.size,
    disqualified: sets.disqualified.size,
    calendarShown: sets.calendarShown.size,
    bookings: sets.bookings.size,
    sets
  };
}

export function computeStageRates(counts: StageCounts): StageRates {
  return {
    visitorToStart: rate(counts.starts, counts.visitors),
    startToLead: rate(counts.leads, counts.starts),
    leadToBooking: rate(counts.bookings, counts.leads),
    visitorToBooking: rate(counts.bookings, counts.visitors)
  };
}

export function addStageCounts(left: StageCounts, right: StageCounts): StageCounts {
  return {
    visitors: left.visitors + right.visitors,
    starts: left.starts + right.starts,
    leads: left.leads + right.leads,
    qualified: left.qualified + right.qualified,
    disqualified: left.disqualified + right.disqualified,
    calendarShown: left.calendarShown + right.calendarShown,
    bookings: left.bookings + right.bookings
  };
}

function getContactFieldLabel(fieldKey: ContactFieldKey) {
  return contactFieldOptions.find((field) => field.key === fieldKey)?.label ?? fieldKey.replace("_", " ");
}

export function buildAnalyticsFlowSteps(
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

function addToSetMap(map: Map<string, Set<string>>, key: string, value: string) {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }

  map.set(key, new Set([value]));
}

export function unionSets(...sets: Array<Set<string> | undefined>) {
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

/** Step drop-off from step_view events and the visitor sets of the later stages. */
export function buildDropOffRows(input: {
  bookedVisitorIds: Set<string>;
  disqualifiedVisitorIds: Set<string>;
  events: Array<Pick<VisitorEventRow, "id" | "visitor_id" | "event_type" | "step_key">>;
  funnel: Pick<Funnel, "qualification_rule">;
  pageViewVisitorIds: Set<string>;
  questions: Array<Pick<Question, "id" | "label">>;
  slotsShownVisitorIds: Set<string>;
}): FunnelDropOffStepRow[] {
  const stepViewEvents = input.events.filter((event) => event.event_type === "step_view");
  if (!stepViewEvents.length) return [];

  const visitorsByStepKey = new Map<string, Set<string>>();
  stepViewEvents.forEach((event) => {
    const stepKey = event.step_key && event.step_key.trim() ? event.step_key.trim() : null;
    if (!stepKey) return;
    addToSetMap(visitorsByStepKey, stepKey, visitorIdentity(event));
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
        dropOffRate: rate(dropOffCount, entered.size)
      };
    })
    .filter((row) => row.uniqueVisitors > 0 || row.stepType !== "page_view");
}
