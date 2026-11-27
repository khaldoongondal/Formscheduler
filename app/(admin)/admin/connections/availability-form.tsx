"use client";

import { useEffect, useMemo, useState } from "react";
import { GOOGLE_COPY } from "@/lib/google/copy";
import type { Availability, Interval, Weekday } from "@/lib/google/availability";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";

const DAYS: Array<{ key: Weekday; label: string }> = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" }
];

const MEETING_LENGTHS = [15, 20, 30, 45, 60, 90, 120];
const START_STEPS = [15, 30, 60];
const BUFFERS = [0, 5, 10, 15, 30, 45, 60];
const NOTICE_HOURS = [0, 1, 2, 4, 8, 12, 24, 48];
const DAYS_AHEAD = [7, 14, 21, 30, 45, 60];

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const timeClass =
  "h-9 rounded-md border border-input bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function withValue(options: number[], value: number) {
  return options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
}

type DayState = { on: boolean; intervals: Interval[] };

export function AvailabilityForm({
  action,
  connectionId,
  initial,
  confirmed,
  defaultTimezone
}: {
  action: (formData: FormData) => Promise<void>;
  connectionId: string;
  initial: Availability;
  confirmed: boolean;
  defaultTimezone: string;
}) {
  const [timezone, setTimezone] = useState(initial.timezone);
  const [days, setDays] = useState<Record<Weekday, DayState>>(() => {
    const state = {} as Record<Weekday, DayState>;
    for (const { key } of DAYS) {
      const intervals = initial.weekly[key] ?? [];
      state[key] = { on: intervals.length > 0, intervals: intervals.length ? intervals : [{ start: "09:00", end: "17:00" }] };
    }
    return state;
  });
  const [slotMinutes, setSlotMinutes] = useState(initial.slot_minutes);
  const [startEvery, setStartEvery] = useState<number | "same">(
    initial.start_interval_minutes === initial.slot_minutes ? "same" : initial.start_interval_minutes
  );
  const [bufferBefore, setBufferBefore] = useState(initial.buffer_before_minutes);
  const [bufferAfter, setBufferAfter] = useState(initial.buffer_after_minutes);
  const [noticeMinutes, setNoticeMinutes] = useState(initial.min_notice_minutes);
  const [daysAhead, setDaysAhead] = useState(initial.max_days_ahead);

  const zones = useMemo(() => {
    try {
      const list = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
      return list.includes(timezone) ? list : [timezone, ...list];
    } catch {
      return [timezone];
    }
  }, [timezone]);

  // First setup: suggest the browser's own zone instead of the default.
  useEffect(() => {
    if (confirmed || initial.timezone !== defaultTimezone) return;
    try {
      const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (browserZone) setTimezone(browserZone);
    } catch {
      // Keep the stored zone.
    }
  }, [confirmed, initial.timezone, defaultTimezone]);

  const payload = useMemo(() => {
    const weekly = {} as Record<Weekday, Interval[]>;
    for (const { key } of DAYS) {
      weekly[key] = days[key].on
        ? days[key].intervals.map((interval) => ({
            start: interval.start,
            // A time input cannot show 24:00; midnight as an end time means the end of the day.
            end: interval.end === "00:00" ? "24:00" : interval.end
          }))
        : [];
    }
    return JSON.stringify({
      version: 1,
      timezone,
      weekly,
      slot_minutes: slotMinutes,
      start_interval_minutes: startEvery === "same" ? slotMinutes : startEvery,
      buffer_before_minutes: bufferBefore,
      buffer_after_minutes: bufferAfter,
      min_notice_minutes: noticeMinutes,
      max_days_ahead: daysAhead
    });
  }, [days, timezone, slotMinutes, startEvery, bufferBefore, bufferAfter, noticeMinutes, daysAhead]);

  function updateDay(key: Weekday, change: (day: DayState) => DayState) {
    setDays((current) => ({ ...current, [key]: change(current[key]) }));
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="id" value={connectionId} />
      <input type="hidden" name="availability_json" value={payload} />

      <div className="space-y-2">
        <label htmlFor="availability_timezone" className="text-sm font-medium text-slate-950">
          {GOOGLE_COPY.timezoneLabel}
        </label>
        <select id="availability_timezone" className={selectClass} value={timezone} onChange={(event) => setTimezone(event.target.value)}>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
            </option>
          ))}
        </select>
      </div>

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {DAYS.map(({ key, label }) => {
          const day = days[key];
          return (
            <div key={key} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start">
              <label className="flex w-40 shrink-0 items-center gap-2 pt-1.5 text-sm font-medium text-slate-900">
                <input
                  type="checkbox"
                  checked={day.on}
                  onChange={(event) => updateDay(key, (current) => ({ ...current, on: event.target.checked }))}
                  aria-label={`${GOOGLE_COPY.availableLabel} ${label}`}
                />
                {label}
              </label>
              {day.on ? (
                <div className="flex flex-1 flex-col gap-2">
                  {day.intervals.map((interval, index) => (
                    <div key={index} className="flex flex-wrap items-center gap-2">
                      <input
                        type="time"
                        className={timeClass}
                        value={interval.start}
                        aria-label={`${label} start`}
                        onChange={(event) =>
                          updateDay(key, (current) => ({
                            ...current,
                            intervals: current.intervals.map((item, i) => (i === index ? { ...item, start: event.target.value } : item))
                          }))
                        }
                      />
                      <span className="text-sm text-slate-500">to</span>
                      <input
                        type="time"
                        className={timeClass}
                        value={interval.end === "24:00" ? "00:00" : interval.end}
                        aria-label={`${label} end`}
                        onChange={(event) =>
                          updateDay(key, (current) => ({
                            ...current,
                            intervals: current.intervals.map((item, i) => (i === index ? { ...item, end: event.target.value } : item))
                          }))
                        }
                      />
                      {day.intervals.length > 1 ? (
                        <button
                          type="button"
                          className="text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-950"
                          onClick={() =>
                            updateDay(key, (current) => ({ ...current, intervals: current.intervals.filter((_, i) => i !== index) }))
                          }
                        >
                          {GOOGLE_COPY.removeHours}
                        </button>
                      ) : null}
                    </div>
                  ))}
                  {day.intervals.length < 3 ? (
                    <button
                      type="button"
                      className="w-fit text-sm font-medium text-slate-600 underline underline-offset-2 hover:text-slate-950"
                      onClick={() =>
                        updateDay(key, (current) => ({
                          ...current,
                          intervals: [...current.intervals, { start: "13:00", end: "17:00" }]
                        }))
                      }
                    >
                      {GOOGLE_COPY.addHours}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberSelect label={GOOGLE_COPY.meetingLength} value={slotMinutes} onChange={setSlotMinutes} options={withValue(MEETING_LENGTHS, slotMinutes)} format={(v) => `${v} minutes`} />
        <div className="space-y-2">
          <label className="text-sm font-medium text-slate-950" htmlFor="availability_step">
            {GOOGLE_COPY.startEvery}
          </label>
          <select
            id="availability_step"
            className={selectClass}
            value={startEvery === "same" ? "same" : String(startEvery)}
            onChange={(event) => setStartEvery(event.target.value === "same" ? "same" : Number(event.target.value))}
          >
            <option value="same">{GOOGLE_COPY.sameAsLength}</option>
            {(startEvery === "same" ? START_STEPS : withValue(START_STEPS, startEvery)).map((step) => (
              <option key={step} value={step}>
                {step} minutes
              </option>
            ))}
          </select>
        </div>
        <NumberSelect label={GOOGLE_COPY.bufferBefore} value={bufferBefore} onChange={setBufferBefore} options={withValue(BUFFERS, bufferBefore)} format={(v) => `${v} minutes`} />
        <NumberSelect label={GOOGLE_COPY.bufferAfter} value={bufferAfter} onChange={setBufferAfter} options={withValue(BUFFERS, bufferAfter)} format={(v) => `${v} minutes`} />
        <NumberSelect
          label={GOOGLE_COPY.minNotice}
          value={noticeMinutes}
          onChange={setNoticeMinutes}
          options={withValue(
            NOTICE_HOURS.map((hours) => hours * 60),
            noticeMinutes
          )}
          format={(v) => (v === 0 ? GOOGLE_COPY.noNotice : v % 60 === 0 ? `${v / 60} ${v === 60 ? "hour" : "hours"}` : `${v} minutes`)}
        />
        <NumberSelect label={GOOGLE_COPY.daysAhead} value={daysAhead} onChange={setDaysAhead} options={withValue(DAYS_AHEAD, daysAhead)} format={(v) => `${v} days`} />
      </div>

      <div className="flex justify-end">
        <SaveSubmitButton label={GOOGLE_COPY.saveAvailability} />
      </div>
    </form>
  );
}

function NumberSelect({
  label,
  value,
  onChange,
  options,
  format
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  options: number[];
  format: (value: number) => string;
}) {
  const id = `availability_${label.toLowerCase().replace(/[^a-z]+/g, "_")}`;
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-slate-950" htmlFor={id}>
        {label}
      </label>
      <select id={id} className={selectClass} value={String(value)} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => (
          <option key={option} value={option}>
            {format(option)}
          </option>
        ))}
      </select>
    </div>
  );
}
