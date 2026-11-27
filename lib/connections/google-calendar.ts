/**
 * Google Calendar as a CalendarProvider (P2.6): slots from working hours
 * minus free/busy, booking re-checks free/busy right before the insert.
 */
import { ProviderHttpError } from "@/lib/connections/http";
import { markConnectionStatus, type ConnectionRow } from "@/lib/connections/service";
import { ProviderAuthError, SlotTakenError, type CalendarProvider } from "@/lib/connections/types";
import {
  DEFAULT_AVAILABILITY,
  freeBusyWindow,
  generateSlots,
  isGeneratedSlot,
  parseAvailability,
  type Availability
} from "@/lib/google/availability";
import { insertEvent, queryFreeBusy } from "@/lib/google/client";
import { GOOGLE_COPY } from "@/lib/google/copy";
import { buildGoogleEventBody } from "@/lib/google/event-mapping";
import { getGoogleAccessToken } from "@/lib/google/oauth";
import type { Funnel } from "@/lib/types/database";

export type GoogleCalendarCtx = {
  connectionId: string;
  tenantId: string;
  /** A valid access token; `force` refreshes it. */
  token: (force?: boolean) => Promise<string>;
  onAuthFailure: () => Promise<void>;
  calendarId: string;
  availability: Availability;
  meet: boolean;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** Null when working hours were never saved or are invalid (the form cannot offer times). */
export function googleCalendarContext(row: ConnectionRow, funnel: Funnel): GoogleCalendarCtx | null {
  if (row.provider !== "google_calendar" || !row.availability_confirmed_at) return null;
  const availability = parseAvailability(row.availability);
  if (!availability) return null;
  const settings = asRecord(row.settings);
  const calendarId = typeof settings.calendar_id === "string" && settings.calendar_id ? settings.calendar_id : "primary";
  let current = row;
  return {
    connectionId: row.id,
    tenantId: row.tenant_id,
    async token(force) {
      return getGoogleAccessToken(current, { force });
    },
    async onAuthFailure() {
      try {
        await markConnectionStatus(current.id, "needs_attention", GOOGLE_COPY.accessRemoved);
      } catch {
        console.error("[google] status update failed");
      }
      current = { ...current, token_expires_at: null };
    },
    calendarId,
    availability,
    meet: asRecord(funnel.calendar_settings).google_meet === true
  };
}

/** Runs a call with the token; on 401 refreshes once and retries; a second 401 marks the connection. */
export async function withGoogleToken<T>(ctx: GoogleCalendarCtx, run: (token: string) => Promise<T>): Promise<T> {
  try {
    return await run(await ctx.token());
  } catch (error) {
    if (!(error instanceof ProviderHttpError) || error.status !== 401) throw error;
  }
  try {
    return await run(await ctx.token(true));
  } catch (error) {
    if (error instanceof ProviderHttpError && error.status === 401) {
      await ctx.onAuthFailure();
      throw new ProviderAuthError("google");
    }
    throw error;
  }
}

async function busyNow(ctx: GoogleCalendarCtx, nowMs: number) {
  const window = freeBusyWindow(ctx.availability, nowMs);
  return withGoogleToken(ctx, (token) =>
    queryFreeBusy(token, {
      calendarId: ctx.calendarId,
      timeMinIso: new Date(window.timeMinMs).toISOString(),
      timeMaxIso: new Date(window.timeMaxMs).toISOString()
    })
  );
}

export const googleCalendarProvider: CalendarProvider<GoogleCalendarCtx> = {
  kind: "google_calendar",
  mode: "slots",
  async listSlots(ctx, request) {
    const busy = await busyNow(ctx, request.nowMs);
    return generateSlots({ availability: ctx.availability, busy, nowMs: request.nowMs, displayTimezone: request.timezone });
  },
  async book(ctx, request) {
    // Decision C13: free/busy again right before the insert; the start must still be offered.
    const nowMs = Date.now();
    const busy = await busyNow(ctx, nowMs);
    const stillFree = isGeneratedSlot({
      availability: ctx.availability,
      busy,
      nowMs,
      displayTimezone: request.timezone,
      startIso: request.slotStart,
      endIso: request.slotEnd
    });
    if (!stillFree) throw new SlotTakenError();
    const slotStart = new Date(request.slotStart).toISOString();
    const slotEnd = new Date(request.slotEnd).toISOString();
    const body = buildGoogleEventBody({
      attemptId: request.attemptId,
      slotStart,
      slotEnd,
      timezone: ctx.availability.timezone,
      lead: request.lead,
      title: request.title,
      description: request.description,
      meet: ctx.meet
    }) as Record<string, unknown> & { id: string };
    return withGoogleToken(ctx, (token) =>
      insertEvent(token, ctx.calendarId, body, ctx.meet, request.lead.externalRef, { slotStart, slotEnd })
    );
  }
};

/** "Check connection": a token and one hour of free/busy. */
export async function checkGoogleConnection(row: ConnectionRow): Promise<{ ok: boolean; summary: string }> {
  const nowMs = Date.now();
  let current = row;
  const ctx: GoogleCalendarCtx = {
    connectionId: row.id,
    tenantId: row.tenant_id,
    token: (force) => getGoogleAccessToken(current, { force }),
    async onAuthFailure() {
      await markConnectionStatus(current.id, "needs_attention", GOOGLE_COPY.accessRemoved).catch(() => undefined);
      current = { ...current, token_expires_at: null };
    },
    calendarId: "primary",
    // Not used by the check; only free/busy is read.
    availability: parseAvailability(row.availability) ?? DEFAULT_AVAILABILITY,
    meet: false
  };
  const settings = asRecord(row.settings);
  if (typeof settings.calendar_id === "string" && settings.calendar_id) ctx.calendarId = settings.calendar_id;
  try {
    await withGoogleToken(ctx, (token) =>
      queryFreeBusy(token, {
        calendarId: ctx.calendarId,
        timeMinIso: new Date(nowMs).toISOString(),
        timeMaxIso: new Date(nowMs + 3_600_000).toISOString()
      })
    );
    return { ok: true, summary: GOOGLE_COPY.checkOk };
  } catch (error) {
    if (error instanceof ProviderAuthError) return { ok: false, summary: GOOGLE_COPY.accessRemoved };
    return { ok: false, summary: GOOGLE_COPY.checkFailed };
  }
}
