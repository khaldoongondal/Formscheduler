/**
 * Cal.com as a CalendarProvider (P2.7): slots and booking through its v2 API.
 * Cal.com sends its own confirmation emails.
 */
import { CALCOM_COPY } from "@/lib/calcom/constants";
import { createBooking, getMe, getSlots, listEventTypes } from "@/lib/calcom/client";
import {
  buildCalcomBookingBody,
  isSlotUnavailableError,
  parseCalcomSlots,
  type CalcomEventType
} from "@/lib/calcom/mapping";
import { ProviderHttpError } from "@/lib/connections/http";
import { getConnectionRowForTenant, markConnectionStatus, type ConnectionRow } from "@/lib/connections/service";
import { ProviderAuthError, SlotTakenError, type CalendarProvider } from "@/lib/connections/types";
import { decryptSecret } from "@/lib/security/encryption";
import type { Funnel } from "@/lib/types/database";

export type CalcomCtx = {
  connectionId: string;
  apiKey: string;
  eventTypeId: number;
  lengthMinutes: number;
  windowDays: number;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function calcomWindowDays(value: unknown): number {
  const days = Number(value);
  if (!Number.isInteger(days)) return 14;
  return Math.min(60, Math.max(1, days));
}

/** Null when no key is stored or the form has no event type. */
export function calcomContext(row: ConnectionRow, funnel: Funnel): CalcomCtx | null {
  if (row.provider !== "calcom" || !row.secret_ciphertext) return null;
  const settings = asRecord(funnel.calendar_settings);
  const eventTypeId = Number(settings.event_type_id);
  if (!Number.isInteger(eventTypeId) || eventTypeId <= 0) return null;
  const length = Number(settings.length_minutes);
  return {
    connectionId: row.id,
    apiKey: decryptSecret(row.secret_ciphertext),
    eventTypeId,
    lengthMinutes: Number.isFinite(length) && length > 0 ? length : funnel.slot_duration_minutes || 30,
    windowDays: calcomWindowDays(funnel.availability_window_days ?? 14)
  };
}

async function onUnauthorized(ctx: CalcomCtx, error: unknown): Promise<never> {
  if (error instanceof ProviderHttpError && (error.status === 401 || error.status === 403)) {
    await markConnectionStatus(ctx.connectionId, "needs_attention", CALCOM_COPY.keyNoLongerAccepted).catch(() => {
      console.error("[calcom] status update failed");
    });
    throw new ProviderAuthError("calcom");
  }
  throw error;
}

export const calcomProvider: CalendarProvider<CalcomCtx> = {
  kind: "calcom",
  mode: "slots",
  async listSlots(ctx, request) {
    try {
      const body = await getSlots(ctx.apiKey, {
        eventTypeId: ctx.eventTypeId,
        startIso: new Date(request.nowMs).toISOString(),
        endIso: new Date(request.nowMs + ctx.windowDays * 86_400_000).toISOString(),
        timeZone: request.timezone
      });
      return parseCalcomSlots(body, request.timezone, ctx.lengthMinutes);
    } catch (error) {
      return onUnauthorized(ctx, error);
    }
  },
  async book(ctx, request) {
    try {
      const booking = await createBooking(
        ctx.apiKey,
        buildCalcomBookingBody({
          eventTypeId: ctx.eventTypeId,
          slotStartIso: request.slotStart,
          lead: request.lead,
          timezone: request.timezone
        })
      );
      return {
        externalBookingId: booking.uid,
        meetingUrl: booking.location && /^https:\/\//i.test(booking.location) ? booking.location : null,
        startTime: booking.start,
        endTime: booking.end,
        raw: { uid: booking.uid, status: booking.status },
        ...(booking.status === "pending" ? { confirmationRequired: true } : {})
      };
    } catch (error) {
      if (error instanceof ProviderHttpError && error.status !== null && isSlotUnavailableError(error.status, error.message)) {
        throw new SlotTakenError();
      }
      return onUnauthorized(ctx, error);
    }
  }
};

export async function checkCalcomConnection(row: ConnectionRow): Promise<{ ok: boolean; summary: string }> {
  if (!row.secret_ciphertext) return { ok: false, summary: CALCOM_COPY.keyNoLongerAccepted };
  try {
    await getMe(decryptSecret(row.secret_ciphertext));
    return { ok: true, summary: CALCOM_COPY.checkOk };
  } catch (error) {
    if (error instanceof ProviderHttpError && (error.status === 401 || error.status === 403)) {
      await markConnectionStatus(row.id, "needs_attention", CALCOM_COPY.keyNoLongerAccepted).catch(() => undefined);
      return { ok: false, summary: CALCOM_COPY.keyNoLongerAccepted };
    }
    return { ok: false, summary: CALCOM_COPY.checkFailed };
  }
}

export type CalcomEventTypesResult =
  | { ok: true; eventTypes: CalcomEventType[] }
  | { ok: false };

/** Event types of a tenant's own Cal.com connection (editor picker and save re-validation, C23). */
export async function loadCalcomEventTypes(tenantId: string, connectionId: string): Promise<CalcomEventTypesResult> {
  try {
    const row = await getConnectionRowForTenant(tenantId, connectionId);
    if (!row || row.provider !== "calcom" || !row.secret_ciphertext) return { ok: false };
    const settings = asRecord(row.settings);
    const username = typeof settings.username === "string" ? settings.username : row.account_label;
    if (!username) return { ok: false };
    return { ok: true, eventTypes: await listEventTypes(decryptSecret(row.secret_ciphertext), username) };
  } catch (error) {
    console.error("[calcom] event types failed", error instanceof ProviderHttpError ? error.status : "unknown");
    return { ok: false };
  }
}
