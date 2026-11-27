/**
 * Wall-clock time in an IANA time zone, with daylight saving handled exactly.
 * Pure: no Next.js, Supabase or I/O imports.
 */

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type LocalDate = { y: number; m: number; d: number };

const WEEKDAYS_FROM_SUNDAY: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const HOUR_MS = 3_600_000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(tz);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
    formatterCache.set(tz, formatter);
  }
  return formatter;
}

type WallTime = { y: number; m: number; d: number; h: number; mi: number; s: number };

function wallTime(utcMs: number, tz: string): WallTime {
  const parts = formatterFor(tz).formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/** Minutes the zone is ahead of UTC at this instant (Toronto in winter: -300). */
export function zoneOffsetMinutes(utcMs: number, tz: string): number {
  const wall = wallTime(utcMs, tz);
  const asUtc = Date.UTC(wall.y, wall.m - 1, wall.d, wall.h, wall.mi, wall.s);
  const flooredInstant = Math.floor(utcMs / 1000) * 1000;
  return Math.round((asUtc - flooredInstant) / 60_000);
}

/**
 * The UTC instant of a wall time in `tz`. A wall time inside a daylight
 * saving gap returns null; a repeated wall time returns the earlier instant.
 */
export function zonedWallTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number | null {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const t1 = guess - zoneOffsetMinutes(guess, tz) * 60_000;
  const t2 = guess - zoneOffsetMinutes(t1, tz) * 60_000;
  // Normalise (handles h = 24 and day overflow) for the comparison.
  const target = new Date(guess);
  const want = {
    y: target.getUTCFullYear(),
    m: target.getUTCMonth() + 1,
    d: target.getUTCDate(),
    h: target.getUTCHours(),
    mi: target.getUTCMinutes()
  };
  // The offsets a day before and after cover changes that are not one hour
  // (Lord Howe moves by 30 minutes), so the earlier instant of a repeated wall
  // time is always among the candidates.
  const before = guess - zoneOffsetMinutes(guess - 24 * HOUR_MS, tz) * 60_000;
  const after = guess - zoneOffsetMinutes(guess + 24 * HOUR_MS, tz) * 60_000;
  const matches = [t1, t2, t1 - HOUR_MS, t1 + HOUR_MS, before, after].filter((candidate) => {
    const wall = wallTime(candidate, tz);
    return wall.y === want.y && wall.m === want.m && wall.d === want.d && wall.h === want.h && wall.mi === want.mi;
  });
  if (!matches.length) return null;
  return Math.min(...matches);
}

export function zonedDate(utcMs: number, tz: string): LocalDate {
  const wall = wallTime(utcMs, tz);
  return { y: wall.y, m: wall.m, d: wall.d };
}

export function addDays(date: LocalDate, n: number): LocalDate {
  const next = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

export function weekdayOf(date: LocalDate): Weekday {
  return WEEKDAYS_FROM_SUNDAY[new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay()];
}

export function isValidTimeZone(tz: string): boolean {
  if (typeof tz !== "string" || !tz || tz.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
