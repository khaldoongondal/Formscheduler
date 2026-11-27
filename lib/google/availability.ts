/**
 * Working hours for a Google Calendar connection and the slots they produce
 * (decision C12). Slots = working-hours candidates minus busy times (each
 * candidate widened by its buffers), minus the notice window and anything
 * past the days-ahead limit.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import { z } from "zod";
import type { Slot } from "@/lib/connections/types";
import {
  addDays,
  isValidTimeZone,
  weekdayOf,
  zonedDate,
  zonedWallTimeToUtc,
  type Weekday
} from "@/lib/time/zoned";

export type { Weekday };
export { isValidTimeZone };

export type Interval = { start: string; end: string };

export type Availability = {
  version: 1;
  timezone: string;
  /** Up to 3 per day, sorted, non-overlapping. */
  weekly: Record<Weekday, Interval[]>;
  slot_minutes: number;
  start_interval_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  min_notice_minutes: number;
  max_days_ahead: number;
};

export const WEEKDAYS: readonly Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
export const MAX_DAYS_AHEAD = 60;
export const MAX_INTERVALS_PER_DAY = 3;
export const DEFAULT_MAX_SLOTS = 400;

export const AVAILABILITY_MESSAGES = {
  timezone: "Choose a time zone from the list.",
  timeFormat: "Each time must look like 09:00.",
  endAfterStart: "The end time must be after the start time.",
  overlap: "Working hours on one day cannot overlap.",
  tooMany: "Up to 3 time ranges per day.",
  slotMinutes: "Meeting length must be between 15 and 240 minutes.",
  startInterval: "Start times must be every 5 to 240 minutes, in steps of 5.",
  buffers: "Buffers must be between 0 and 240 minutes.",
  notice: "Minimum notice must be between 0 minutes and 14 days.",
  daysAhead: "Days ahead must be between 1 and 60.",
  noDays: "Turn on at least one day."
} as const;

const workday: Interval[] = [{ start: "09:00", end: "17:00" }];

export const DEFAULT_AVAILABILITY: Availability = {
  version: 1,
  timezone: "America/Toronto",
  weekly: { mon: workday, tue: workday, wed: workday, thu: workday, fri: workday, sat: [], sun: [] },
  slot_minutes: 30,
  start_interval_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  min_notice_minutes: 240,
  max_days_ahead: 14
};

const TIME_PATTERN = /^(?:([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

/** "09:30" -> 570; "24:00" -> 1440; invalid -> null. */
export function timeToMinutes(value: string): number | null {
  if (typeof value !== "string" || !TIME_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function intRange(min: number, max: number, message: string) {
  return z.coerce
    .number(message)
    .int({ message })
    .min(min, { message })
    .max(max, { message });
}

function requiredString(invalidTypeMessage: string) {
  return z.string({ error: (issue) => issue.input === undefined ? "Required" : invalidTypeMessage });
}

const intervalSchema = z.object({
  start: requiredString(AVAILABILITY_MESSAGES.timeFormat),
  end: requiredString(AVAILABILITY_MESSAGES.timeFormat)
});

const daySchema = z.array(intervalSchema).max(MAX_INTERVALS_PER_DAY, { message: AVAILABILITY_MESSAGES.tooMany });

const rawSchema = z.object({
  version: z.literal(1).optional(),
  timezone: requiredString(AVAILABILITY_MESSAGES.timezone),
  weekly: z.object({
    mon: daySchema.default([]),
    tue: daySchema.default([]),
    wed: daySchema.default([]),
    thu: daySchema.default([]),
    fri: daySchema.default([]),
    sat: daySchema.default([]),
    sun: daySchema.default([])
  }),
  slot_minutes: intRange(15, 240, AVAILABILITY_MESSAGES.slotMinutes),
  start_interval_minutes: intRange(5, 240, AVAILABILITY_MESSAGES.startInterval).refine((value) => value % 5 === 0, {
    message: AVAILABILITY_MESSAGES.startInterval
  }),
  buffer_before_minutes: intRange(0, 240, AVAILABILITY_MESSAGES.buffers),
  buffer_after_minutes: intRange(0, 240, AVAILABILITY_MESSAGES.buffers),
  min_notice_minutes: intRange(0, 20_160, AVAILABILITY_MESSAGES.notice),
  max_days_ahead: intRange(1, MAX_DAYS_AHEAD, AVAILABILITY_MESSAGES.daysAhead)
});

export const availabilitySchema: z.ZodType<Availability> = rawSchema
  .superRefine((value, ctx) => {
    if (!isValidTimeZone(value.timezone)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["timezone"], message: AVAILABILITY_MESSAGES.timezone });
    }
    let anyDay = false;
    for (const day of WEEKDAYS) {
      const intervals = value.weekly[day];
      const parsed: Array<{ start: number; end: number }> = [];
      for (const interval of intervals) {
        const start = timeToMinutes(interval.start);
        const end = timeToMinutes(interval.end);
        if (start === null || end === null || start === 1440) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekly", day], message: AVAILABILITY_MESSAGES.timeFormat });
          return;
        }
        if (end <= start) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekly", day], message: AVAILABILITY_MESSAGES.endAfterStart });
          return;
        }
        parsed.push({ start, end });
      }
      parsed.sort((a, b) => a.start - b.start);
      for (let index = 1; index < parsed.length; index += 1) {
        if (parsed[index].start < parsed[index - 1].end) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekly", day], message: AVAILABILITY_MESSAGES.overlap });
          return;
        }
      }
      if (parsed.length) anyDay = true;
    }
    if (!anyDay) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["weekly"], message: AVAILABILITY_MESSAGES.noDays });
    }
  })
  .transform((value): Availability => {
    const weekly = {} as Record<Weekday, Interval[]>;
    for (const day of WEEKDAYS) {
      weekly[day] = [...value.weekly[day]]
        .map((interval) => ({ start: interval.start, end: interval.end }))
        .sort((a, b) => (timeToMinutes(a.start) ?? 0) - (timeToMinutes(b.start) ?? 0));
    }
    return {
      version: 1,
      timezone: value.timezone,
      weekly,
      slot_minutes: value.slot_minutes,
      start_interval_minutes: value.start_interval_minutes,
      buffer_before_minutes: value.buffer_before_minutes,
      buffer_after_minutes: value.buffer_after_minutes,
      min_notice_minutes: value.min_notice_minutes,
      max_days_ahead: value.max_days_ahead
    };
  });

export function parseAvailability(value: unknown): Availability | null {
  const result = availabilitySchema.safeParse(value);
  return result.success ? result.data : null;
}

/** The first validation message, for admin redirects. */
export function availabilityErrorMessage(value: unknown): string | null {
  const result = availabilitySchema.safeParse(value);
  if (result.success) return null;
  return result.error.issues[0]?.message ?? AVAILABILITY_MESSAGES.timeFormat;
}

export type BusyInterval = { startMs: number; endMs: number };

export type GenerateSlotsInput = {
  availability: Availability;
  busy: BusyInterval[];
  nowMs: number;
  displayTimezone: string;
  maxSlots?: number;
};

const DAY_MS = 86_400_000;

function overlapsBusy(startMs: number, endMs: number, busy: BusyInterval[]): boolean {
  for (const interval of busy) {
    if (startMs < interval.endMs && interval.startMs < endMs) return true;
  }
  return false;
}

function candidateInstants(input: GenerateSlotsInput): Array<{ startMs: number; endMs: number }> {
  const { availability, busy, nowMs } = input;
  const tz = availability.timezone;
  const slotMs = availability.slot_minutes * 60_000;
  const step = availability.start_interval_minutes;
  const earliest = nowMs + availability.min_notice_minutes * 60_000;
  const latest = nowMs + availability.max_days_ahead * DAY_MS;
  const beforeMs = availability.buffer_before_minutes * 60_000;
  const afterMs = availability.buffer_after_minutes * 60_000;
  const today = zonedDate(nowMs, tz);
  const result: Array<{ startMs: number; endMs: number }> = [];

  for (let offset = 0; offset <= availability.max_days_ahead; offset += 1) {
    const date = addDays(today, offset);
    const intervals = availability.weekly[weekdayOf(date)] ?? [];
    for (const interval of intervals) {
      const intervalStart = timeToMinutes(interval.start);
      const intervalEnd = timeToMinutes(interval.end);
      if (intervalStart === null || intervalEnd === null) continue;
      for (let wall = intervalStart; wall + availability.slot_minutes <= intervalEnd; wall += step) {
        const startMs = zonedWallTimeToUtc(date.y, date.m, date.d, Math.floor(wall / 60), wall % 60, tz);
        // A start inside a daylight saving gap does not exist that day. The end is
        // absolute (start + meeting length), so a slot whose wall end falls in the
        // gap is still a real, full-length meeting and is kept.
        if (startMs === null) continue;
        const endMs = startMs + slotMs;
        if (startMs < earliest || startMs >= latest) continue;
        if (overlapsBusy(startMs - beforeMs, endMs + afterMs, busy)) continue;
        result.push({ startMs, endMs });
      }
    }
  }
  return result;
}

export function generateSlots(input: GenerateSlotsInput): Slot[] {
  const maxSlots = input.maxSlots ?? DEFAULT_MAX_SLOTS;
  const sorted = candidateInstants(input).sort((a, b) => a.startMs - b.startMs);
  const slots: Slot[] = [];
  let lastStart: number | null = null;
  for (const candidate of sorted) {
    if (candidate.startMs === lastStart) continue;
    lastStart = candidate.startMs;
    slots.push({
      startTime: new Date(candidate.startMs).toISOString(),
      endTime: new Date(candidate.endMs).toISOString(),
      timezone: input.displayTimezone
    });
    if (slots.length >= maxSlots) break;
  }
  return slots;
}

/** True when the requested start and end are exactly one of the slots the rules produce right now. */
export function isGeneratedSlot(input: GenerateSlotsInput & { startIso: string; endIso: string }): boolean {
  const startMs = Date.parse(input.startIso);
  const endMs = Date.parse(input.endIso);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return candidateInstants(input).some((candidate) => candidate.startMs === startMs && candidate.endMs === endMs);
}

/** The free/busy range that covers every candidate and its buffers. */
export function freeBusyWindow(availability: Availability, nowMs: number): { timeMinMs: number; timeMaxMs: number } {
  return {
    timeMinMs: nowMs - availability.buffer_before_minutes * 60_000,
    timeMaxMs: nowMs + (availability.max_days_ahead + 1) * DAY_MS
  };
}
