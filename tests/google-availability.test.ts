import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AVAILABILITY_MESSAGES,
  DEFAULT_AVAILABILITY,
  availabilityErrorMessage,
  availabilitySchema,
  freeBusyWindow,
  generateSlots,
  isGeneratedSlot,
  parseAvailability,
  type Availability,
  type BusyInterval,
  type Interval,
  type Weekday
} from "@/lib/google/availability";
import { GOOGLE_COPY } from "@/lib/google/copy";
import { addDays, weekdayOf, zoneOffsetMinutes, zonedDate, zonedWallTimeToUtc } from "@/lib/time/zoned";
import { relativeTime } from "@/lib/time/relative";

const EM_DASH = String.fromCharCode(0x2014);
const ms = (iso: string) => Date.parse(iso);
const emptyWeek = (): Record<Weekday, Interval[]> => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

function availability(
  overrides: Partial<Omit<Availability, "weekly">> & { weekly?: Partial<Record<Weekday, Interval[]>> }
): Availability {
  return {
    ...DEFAULT_AVAILABILITY,
    min_notice_minutes: 0,
    max_days_ahead: 3,
    ...overrides,
    weekly: { ...emptyWeek(), ...(overrides.weekly ?? {}) }
  };
}

function starts(input: Parameters<typeof generateSlots>[0]) {
  return generateSlots(input).map((slot) => slot.startTime);
}

// Monday 2026-01-12, Toronto is UTC-5. Now: Sunday 2026-01-11 12:00 UTC.
const JAN_NOW = ms("2026-01-11T12:00:00Z");
const MONDAY_MORNING = availability({
  timezone: "America/Toronto",
  weekly: { mon: [{ start: "09:00", end: "12:00" }] },
  slot_minutes: 30,
  start_interval_minutes: 30,
  max_days_ahead: 2
});

describe("zoned time helpers", () => {
  it("reads offsets and converts wall times", () => {
    assert.equal(zoneOffsetMinutes(ms("2026-01-12T12:00:00Z"), "America/Toronto"), -300);
    assert.equal(zoneOffsetMinutes(ms("2026-07-12T12:00:00Z"), "America/Toronto"), -240);
    assert.equal(zonedWallTimeToUtc(2026, 1, 12, 9, 0, "America/Toronto"), ms("2026-01-12T14:00:00Z"));
    assert.equal(zonedWallTimeToUtc(2026, 3, 8, 2, 30, "America/Toronto"), null);
    assert.equal(zonedWallTimeToUtc(2026, 11, 1, 1, 30, "America/Toronto"), ms("2026-11-01T05:30:00Z"));
    assert.equal(zonedWallTimeToUtc(2026, 1, 12, 24, 0, "America/Toronto"), ms("2026-01-13T05:00:00Z"));
  });

  it("walks local dates", () => {
    assert.deepEqual(zonedDate(ms("2026-01-12T03:00:00Z"), "America/Toronto"), { y: 2026, m: 1, d: 11 });
    assert.deepEqual(addDays({ y: 2026, m: 2, d: 28 }, 1), { y: 2026, m: 3, d: 1 });
    assert.equal(weekdayOf({ y: 2026, m: 1, d: 12 }), "mon");
  });
});

describe("generateSlots", () => {
  it("plain winter day in Toronto: 6 slots at the right instants", () => {
    assert.deepEqual(starts({ availability: MONDAY_MORNING, busy: [], nowMs: JAN_NOW, displayTimezone: "America/Toronto" }), [
      "2026-01-12T14:00:00.000Z",
      "2026-01-12T14:30:00.000Z",
      "2026-01-12T15:00:00.000Z",
      "2026-01-12T15:30:00.000Z",
      "2026-01-12T16:00:00.000Z",
      "2026-01-12T16:30:00.000Z"
    ]);
    const first = generateSlots({ availability: MONDAY_MORNING, busy: [], nowMs: JAN_NOW, displayTimezone: "America/Toronto" })[0];
    assert.equal(first.endTime, "2026-01-12T14:30:00.000Z");
  });

  it("spring forward in Toronto: no 02:00, 01:00 and 03:00 are one hour apart", () => {
    const result = starts({
      availability: availability({
        timezone: "America/Toronto",
        weekly: { sun: [{ start: "00:00", end: "06:00" }] },
        slot_minutes: 60,
        start_interval_minutes: 60
      }),
      busy: [],
      nowMs: ms("2026-03-07T00:00:00Z"),
      displayTimezone: "America/Toronto"
    });
    assert.deepEqual(result, [
      "2026-03-08T05:00:00.000Z",
      "2026-03-08T06:00:00.000Z",
      "2026-03-08T07:00:00.000Z",
      "2026-03-08T08:00:00.000Z",
      "2026-03-08T09:00:00.000Z"
    ]);
    assert.equal(ms(result[2]) - ms(result[1]), 3_600_000);
  });

  it("fall back in Toronto: 01:00 once, at the earlier instant", () => {
    const result = starts({
      availability: availability({
        timezone: "America/Toronto",
        weekly: { sun: [{ start: "00:00", end: "04:00" }] },
        slot_minutes: 60,
        start_interval_minutes: 60
      }),
      busy: [],
      nowMs: ms("2026-10-31T00:00:00Z"),
      displayTimezone: "America/Toronto"
    });
    assert.deepEqual(result, [
      "2026-11-01T04:00:00.000Z",
      "2026-11-01T05:00:00.000Z",
      "2026-11-01T07:00:00.000Z",
      "2026-11-01T08:00:00.000Z"
    ]);
  });

  it("London spring and autumn changes", () => {
    const sunday = (nowIso: string) =>
      starts({
        availability: availability({
          timezone: "Europe/London",
          weekly: { sun: [{ start: "00:00", end: "03:00" }] },
          slot_minutes: 60,
          start_interval_minutes: 60
        }),
        busy: [],
        nowMs: ms(nowIso),
        displayTimezone: "Europe/London"
      });
    assert.deepEqual(sunday("2026-03-28T00:00:00Z"), ["2026-03-29T00:00:00.000Z", "2026-03-29T01:00:00.000Z"]);
    assert.deepEqual(sunday("2026-10-24T00:00:00Z"), [
      "2026-10-24T23:00:00.000Z",
      "2026-10-25T00:00:00.000Z",
      "2026-10-25T02:00:00.000Z"
    ]);
  });

  it("Kolkata half-hour offset", () => {
    const result = starts({
      availability: availability({ timezone: "Asia/Kolkata", weekly: { mon: [{ start: "09:00", end: "10:00" }] }, slot_minutes: 60, start_interval_minutes: 60 }),
      busy: [],
      nowMs: ms("2026-01-11T00:00:00Z"),
      displayTimezone: "Asia/Kolkata"
    });
    assert.deepEqual(result, ["2026-01-12T03:30:00.000Z"]);
  });

  it("Lord Howe 30-minute daylight saving change", () => {
    const result = starts({
      availability: availability({
        timezone: "Australia/Lord_Howe",
        weekly: { sun: [{ start: "01:00", end: "03:00" }] },
        slot_minutes: 30,
        start_interval_minutes: 30,
        max_days_ahead: 5
      }),
      busy: [],
      nowMs: ms("2026-04-03T00:00:00Z"),
      displayTimezone: "Australia/Lord_Howe"
    });
    assert.deepEqual(result, [
      "2026-04-04T14:00:00.000Z",
      "2026-04-04T14:30:00.000Z",
      "2026-04-04T15:30:00.000Z",
      "2026-04-04T16:00:00.000Z"
    ]);
  });

  it("a different visitor zone keeps the instants and labels the zone", () => {
    const toronto = generateSlots({ availability: MONDAY_MORNING, busy: [], nowMs: JAN_NOW, displayTimezone: "America/Toronto" });
    const tokyo = generateSlots({ availability: MONDAY_MORNING, busy: [], nowMs: JAN_NOW, displayTimezone: "Asia/Tokyo" });
    assert.deepEqual(
      tokyo.map((slot) => slot.startTime),
      toronto.map((slot) => slot.startTime)
    );
    assert.ok(tokyo.every((slot) => slot.timezone === "Asia/Tokyo"));
  });

  describe("busy times and buffers", () => {
    const busy: BusyInterval[] = [{ startMs: ms("2026-01-12T15:00:00Z"), endMs: ms("2026-01-12T15:30:00Z") }];
    const local = (list: string[]) => list.map((iso) => new Date(iso).toISOString().slice(11, 16));

    it("busy 10:00 to 10:30 removes only 10:00", () => {
      assert.deepEqual(local(starts({ availability: MONDAY_MORNING, busy, nowMs: JAN_NOW, displayTimezone: "UTC" })), [
        "14:00",
        "14:30",
        "15:30",
        "16:00",
        "16:30"
      ]);
    });

    it("buffer after 15 also removes 09:30", () => {
      const result = starts({ availability: { ...MONDAY_MORNING, buffer_after_minutes: 15 }, busy, nowMs: JAN_NOW, displayTimezone: "UTC" });
      assert.deepEqual(local(result), ["14:00", "15:30", "16:00", "16:30"]);
    });

    it("buffer before 15 also removes 10:30", () => {
      const result = starts({ availability: { ...MONDAY_MORNING, buffer_before_minutes: 15 }, busy, nowMs: JAN_NOW, displayTimezone: "UTC" });
      assert.deepEqual(local(result), ["14:00", "14:30", "16:00", "16:30"]);
    });

    it("busy ending exactly at a start keeps it", () => {
      const touching: BusyInterval[] = [{ startMs: ms("2026-01-12T13:30:00Z"), endMs: ms("2026-01-12T14:00:00Z") }];
      const result = starts({ availability: MONDAY_MORNING, busy: touching, nowMs: JAN_NOW, displayTimezone: "UTC" });
      assert.equal(result.length, 6);
      assert.equal(result[0], "2026-01-12T14:00:00.000Z");
    });
  });

  it("minimum notice: now 08:50, notice 60 gives a first slot at 10:00", () => {
    const result = starts({
      availability: { ...MONDAY_MORNING, min_notice_minutes: 60 },
      busy: [],
      nowMs: ms("2026-01-12T13:50:00Z"),
      displayTimezone: "UTC"
    });
    assert.equal(result[0], "2026-01-12T15:00:00.000Z");
  });

  it("days ahead limit", () => {
    const weekdays = availability({
      timezone: "America/Toronto",
      weekly: { mon: [{ start: "09:00", end: "12:00" }], tue: [{ start: "09:00", end: "12:00" }] },
      max_days_ahead: 1
    });
    const result = starts({ availability: weekdays, busy: [], nowMs: ms("2026-01-12T13:50:00Z"), displayTimezone: "UTC" });
    assert.ok(result.length > 0);
    assert.ok(result.every((iso) => iso.startsWith("2026-01-12")));
  });

  it("start interval 15 with 30-minute meetings, exact fit, 24:00 end, three ranges, cap, duplicates", () => {
    const base = { timezone: "UTC", slot_minutes: 30, start_interval_minutes: 15 } as const;
    const nowMs = ms("2026-01-11T00:00:00Z");
    assert.deepEqual(
      starts({ availability: availability({ ...base, weekly: { mon: [{ start: "09:00", end: "10:00" }] } }), busy: [], nowMs, displayTimezone: "UTC" }),
      ["2026-01-12T09:00:00.000Z", "2026-01-12T09:15:00.000Z", "2026-01-12T09:30:00.000Z"]
    );
    assert.deepEqual(
      starts({
        availability: availability({ timezone: "UTC", slot_minutes: 60, start_interval_minutes: 60, weekly: { mon: [{ start: "09:00", end: "10:00" }] } }),
        busy: [],
        nowMs,
        displayTimezone: "UTC"
      }),
      ["2026-01-12T09:00:00.000Z"]
    );
    const lateSlots = generateSlots({
      availability: availability({ timezone: "UTC", slot_minutes: 60, start_interval_minutes: 60, weekly: { mon: [{ start: "23:00", end: "24:00" }] } }),
      busy: [],
      nowMs,
      displayTimezone: "UTC"
    });
    assert.deepEqual(lateSlots, [{ startTime: "2026-01-12T23:00:00.000Z", endTime: "2026-01-13T00:00:00.000Z", timezone: "UTC" }]);
    const threeRanges = availability({
      timezone: "UTC",
      slot_minutes: 30,
      start_interval_minutes: 30,
      weekly: {
        mon: [
          { start: "08:00", end: "09:00" },
          { start: "12:00", end: "12:30" },
          { start: "16:00", end: "17:00" }
        ]
      }
    });
    assert.equal(starts({ availability: threeRanges, busy: [], nowMs, displayTimezone: "UTC" }).length, 5);
    assert.equal(starts({ availability: threeRanges, busy: [], nowMs, displayTimezone: "UTC", maxSlots: 2 }).length, 2);
    const duplicated = availability({
      timezone: "UTC",
      slot_minutes: 30,
      start_interval_minutes: 30,
      weekly: { mon: [{ start: "09:00", end: "10:00" }, { start: "09:00", end: "10:00" }] }
    });
    assert.deepEqual(starts({ availability: duplicated, busy: [], nowMs, displayTimezone: "UTC" }), [
      "2026-01-12T09:00:00.000Z",
      "2026-01-12T09:30:00.000Z"
    ]);
  });

  it("is sorted across days", () => {
    const result = starts({ availability: { ...DEFAULT_AVAILABILITY, min_notice_minutes: 0 }, busy: [], nowMs: JAN_NOW, displayTimezone: "UTC" });
    const sorted = [...result].sort();
    assert.deepEqual(result, sorted);
    assert.ok(result.length > 0);
  });
});

describe("isGeneratedSlot", () => {
  const input = { availability: MONDAY_MORNING, busy: [] as BusyInterval[], nowMs: JAN_NOW, displayTimezone: "UTC" };

  it("accepts a returned slot, refuses a shifted or busy one", () => {
    const slot = generateSlots(input)[1];
    assert.equal(isGeneratedSlot({ ...input, startIso: slot.startTime, endIso: slot.endTime }), true);
    assert.equal(isGeneratedSlot({ ...input, startIso: "2026-01-12T09:30:00-05:00", endIso: "2026-01-12T10:00:00-05:00" }), true);
    assert.equal(
      isGeneratedSlot({ ...input, startIso: "2026-01-12T14:31:00.000Z", endIso: "2026-01-12T15:01:00.000Z" }),
      false
    );
    assert.equal(
      isGeneratedSlot({
        ...input,
        busy: [{ startMs: ms(slot.startTime), endMs: ms(slot.endTime) }],
        startIso: slot.startTime,
        endIso: slot.endTime
      }),
      false
    );
    assert.equal(isGeneratedSlot({ ...input, startIso: "not a date", endIso: slot.endTime }), false);
  });
});

describe("freeBusyWindow", () => {
  it("covers buffers and the days-ahead limit plus a day", () => {
    const window = freeBusyWindow({ ...MONDAY_MORNING, buffer_before_minutes: 15, max_days_ahead: 14 }, JAN_NOW);
    assert.equal(window.timeMinMs, JAN_NOW - 15 * 60_000);
    assert.equal(window.timeMaxMs, JAN_NOW + 15 * 86_400_000);
  });
});

describe("availabilitySchema", () => {
  const valid = { ...DEFAULT_AVAILABILITY };
  const messageFor = (value: unknown) => availabilityErrorMessage(value);

  it("accepts the default and sorts ranges", () => {
    assert.deepEqual(parseAvailability(valid), DEFAULT_AVAILABILITY);
    const parsed = availabilitySchema.parse({
      ...valid,
      weekly: { ...emptyWeek(), mon: [{ start: "13:00", end: "14:00" }, { start: "09:00", end: "10:00" }] }
    });
    assert.deepEqual(parsed.weekly.mon, [{ start: "09:00", end: "10:00" }, { start: "13:00", end: "14:00" }]);
    assert.equal(parseAvailability({ ...valid, weekly: { mon: [{ start: "09:00", end: "24:00" }] } })?.weekly.tue.length, 0);
  });

  it("returns every message", () => {
    assert.equal(messageFor({ ...valid, timezone: "Mars/Olympus" }), AVAILABILITY_MESSAGES.timezone);
    assert.equal(messageFor({ ...valid, weekly: { ...emptyWeek(), mon: [{ start: "9am", end: "10:00" }] } }), AVAILABILITY_MESSAGES.timeFormat);
    assert.equal(messageFor({ ...valid, weekly: { ...emptyWeek(), mon: [{ start: "24:00", end: "24:00" }] } }), AVAILABILITY_MESSAGES.timeFormat);
    assert.equal(messageFor({ ...valid, weekly: { ...emptyWeek(), mon: [{ start: "10:00", end: "09:00" }] } }), AVAILABILITY_MESSAGES.endAfterStart);
    assert.equal(
      messageFor({ ...valid, weekly: { ...emptyWeek(), mon: [{ start: "09:00", end: "11:00" }, { start: "10:00", end: "12:00" }] } }),
      AVAILABILITY_MESSAGES.overlap
    );
    assert.equal(
      messageFor({
        ...valid,
        weekly: {
          ...emptyWeek(),
          mon: [
            { start: "08:00", end: "09:00" },
            { start: "10:00", end: "11:00" },
            { start: "12:00", end: "13:00" },
            { start: "14:00", end: "15:00" }
          ]
        }
      }),
      AVAILABILITY_MESSAGES.tooMany
    );
    assert.equal(messageFor({ ...valid, slot_minutes: 10 }), AVAILABILITY_MESSAGES.slotMinutes);
    assert.equal(messageFor({ ...valid, slot_minutes: 241 }), AVAILABILITY_MESSAGES.slotMinutes);
    assert.equal(messageFor({ ...valid, start_interval_minutes: 7 }), AVAILABILITY_MESSAGES.startInterval);
    assert.equal(messageFor({ ...valid, start_interval_minutes: 0 }), AVAILABILITY_MESSAGES.startInterval);
    assert.equal(messageFor({ ...valid, buffer_before_minutes: -5 }), AVAILABILITY_MESSAGES.buffers);
    assert.equal(messageFor({ ...valid, buffer_after_minutes: 300 }), AVAILABILITY_MESSAGES.buffers);
    assert.equal(messageFor({ ...valid, min_notice_minutes: 20_161 }), AVAILABILITY_MESSAGES.notice);
    assert.equal(messageFor({ ...valid, max_days_ahead: 0 }), AVAILABILITY_MESSAGES.daysAhead);
    assert.equal(messageFor({ ...valid, max_days_ahead: 61 }), AVAILABILITY_MESSAGES.daysAhead);
    assert.equal(messageFor({ ...valid, weekly: emptyWeek() }), AVAILABILITY_MESSAGES.noDays);
    assert.equal(parseAvailability(null), null);
  });
});

describe("Google copy", () => {
  it("has no em dash", () => {
    const texts = [
      ...Object.values(AVAILABILITY_MESSAGES),
      ...(Object.values(GOOGLE_COPY) as unknown[]).map((value) => (typeof value === "function" ? value("someone@example.com") : value))
    ] as string[];
    for (const text of texts) assert.ok(!text.includes(EM_DASH), text);
  });

  it("relative time", () => {
    const now = ms("2026-01-12T12:00:00Z");
    assert.equal(relativeTime("2026-01-12T11:59:30Z", now), "just now");
    assert.equal(relativeTime("2026-01-12T11:55:00Z", now), "5 minutes ago");
    assert.equal(relativeTime("2026-01-12T10:00:00Z", now), "2 hours ago");
    assert.equal(relativeTime("2026-01-11T12:00:00Z", now), "1 day ago");
    assert.equal(relativeTime(null, now), "at an unknown time");
  });
});
