import type { Funnel } from "@/lib/types/database";

export function isDemoSlotModeEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.LEADDER_DEMO_SLOT_MODE === "true";
}

export function createDemoGhlId(prefix: string, id: string) {
  return `demo_${prefix}_${id.replaceAll("-", "").slice(0, 16)}`;
}

export function getDemoCalendarId(funnel: Funnel) {
  return funnel.calendar_id ?? "demo-calendar";
}

export function createDemoSlots(timezone: string, slotDurationMinutes: number, availabilityWindowDays = 14) {
  const now = new Date();
  const earliest = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  const boundedWindowDays = Math.min(Math.max(availabilityWindowDays, 1), 60);
  const slotTimes = [
    [9, 0],
    [10, 30],
    [13, 0],
    [15, 30]
  ];
  const slots: Array<{ startTime: string; endTime: string; timezone: string }> = [];

  for (let dayOffset = 0; slots.length < 12 && dayOffset < boundedWindowDays; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);

    const dayOfWeek = day.getDay();
    if (dayOfWeek === 0 || dayOfWeek === 6) continue;

    for (const [hour, minute] of slotTimes) {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute, 0, 0);
      if (start <= earliest) continue;

      const end = new Date(start.getTime() + slotDurationMinutes * 60 * 1000);
      slots.push({
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone
      });
    }
  }

  return slots;
}
