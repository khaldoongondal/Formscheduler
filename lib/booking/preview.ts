/**
 * In-editor form preview (Sprint 4 P2, decision D18): sample slots, the
 * same-origin theme message and the preview copy. Pure and client-safe: no
 * Next.js, Supabase, Node or I/O imports.
 */
import { addDays, weekdayOf, zonedDate, zonedWallTimeToUtc, type LocalDate } from "@/lib/time/zoned";

export const PREVIEW_THEME_MESSAGE = "formbook:preview-theme";
export const PREVIEW_READY_MESSAGE = "formbook:preview-ready";
export const PREVIEW_OPEN_STORAGE_KEY = "formbook:preview-open";

export type PreviewTheme = { primary_color: string; accent_color: string; button_color: string; border_radius: number };

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const THEME_KEYS = ["primary_color", "accent_color", "button_color", "border_radius"] as const;

export function isPreviewTheme(value: unknown): value is PreviewTheme {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const theme = value as Record<string, unknown>;
  if (Object.keys(theme).some((key) => !(THEME_KEYS as readonly string[]).includes(key))) return false;
  return (
    typeof theme.primary_color === "string" &&
    HEX_COLOR.test(theme.primary_color) &&
    typeof theme.accent_color === "string" &&
    HEX_COLOR.test(theme.accent_color) &&
    typeof theme.button_color === "string" &&
    HEX_COLOR.test(theme.button_color) &&
    typeof theme.border_radius === "number" &&
    Number.isInteger(theme.border_radius) &&
    theme.border_radius >= 0 &&
    theme.border_radius <= 32
  );
}

/** Exactly `{ type: "formbook:preview-theme", theme: PreviewTheme }`; nothing else passes. */
export function isPreviewThemeMessage(data: unknown): data is { type: typeof PREVIEW_THEME_MESSAGE; theme: PreviewTheme } {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const message = data as Record<string, unknown>;
  if (Object.keys(message).some((key) => key !== "type" && key !== "theme")) return false;
  return message.type === PREVIEW_THEME_MESSAGE && isPreviewTheme(message.theme);
}

/** Theme from raw form values (strings from inputs); null when any value is invalid. */
export function previewThemeFromValues(values: {
  primary_color: unknown;
  accent_color: unknown;
  button_color: unknown;
  border_radius: unknown;
}): PreviewTheme | null {
  const radiusText = typeof values.border_radius === "number" ? String(values.border_radius) : values.border_radius;
  if (typeof radiusText !== "string" || !/^\d{1,2}$/.test(radiusText.trim())) return null;
  const theme = {
    primary_color: values.primary_color,
    accent_color: values.accent_color,
    button_color: values.button_color,
    border_radius: Number(radiusText.trim())
  };
  return isPreviewTheme(theme) ? theme : null;
}

export type PreviewSlot = { startTime: string; endTime: string; timezone: string };

const SAMPLE_TIMES: ReadonlyArray<[number, number]> = [
  [9, 0],
  [10, 30],
  [13, 0],
  [15, 30]
];
export const PREVIEW_SLOT_DAYS = 3;

/**
 * Sample slots: the next three weekdays after `now` (Saturday and Sunday skipped
 * in `timeZone`), at 09:00, 10:30, 13:00 and 15:30 local time, each
 * `durationMinutes` long. Same shape as the slots API (startTime, endTime,
 * timezone). An invalid time zone falls back to UTC; a wall time inside a
 * daylight saving gap is skipped.
 */
export function previewSlots(now: Date, timeZone: string, durationMinutes: number): PreviewSlot[] {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const duration = Number.isFinite(durationMinutes) && durationMinutes > 0 ? Math.round(durationMinutes) : 30;
  const days: LocalDate[] = [];
  let cursor = zonedDate(now.getTime(), zone);
  for (let guard = 0; days.length < PREVIEW_SLOT_DAYS && guard < 14; guard += 1) {
    cursor = addDays(cursor, 1);
    const weekday = weekdayOf(cursor);
    if (weekday !== "sat" && weekday !== "sun") days.push(cursor);
  }
  const slots: PreviewSlot[] = [];
  for (const day of days) {
    for (const [hour, minute] of SAMPLE_TIMES) {
      const start = zonedWallTimeToUtc(day.y, day.m, day.d, hour, minute, zone);
      if (start === null) continue;
      slots.push({
        startTime: new Date(start).toISOString(),
        endTime: new Date(start + duration * 60_000).toISOString(),
        timezone: zone
      });
    }
  }
  return slots;
}

export const PREVIEW_COPY = {
  show: "Show preview",
  hide: "Hide preview",
  title: "Preview",
  reload: "Reload",
  note: "Color and corner changes show here as you edit. Other changes show after you save.",
  banner: "Preview. Nothing you enter here is saved or sent.",
  calendlyNote: "On the live form, your Calendly scheduler shows here instead of these sample times.",
  booked: "Preview booking done. On the live form the visitor now sees your confirmation.",
  bookedRedirect: "Preview booking done. On the live form the visitor now goes to your redirect page.",
  frameTitle: "Form preview"
} as const;
