/**
 * Provider kind to adapter and context factory (P1.8). P1 registers
 * GoHighLevel; P2 adds Google Calendar and Cal.com; P3 adds Calendly,
 * HubSpot and Webhook.
 */
import type { ConnectionRow } from "@/lib/connections/service";
import { calcomContext, calcomProvider } from "@/lib/connections/calcom";
import { ghlCalendarProvider, type GhlCalendarCtx } from "@/lib/connections/ghl-calendar";
import { googleCalendarContext, googleCalendarProvider } from "@/lib/connections/google-calendar";
import { ghlCrmProvider, type GhlCrmCtx } from "@/lib/connections/ghl-crm";
import type { CalendarKind, CalendarProvider, CrmKind, CrmProvider } from "@/lib/connections/types";
import { resolveGhlRuntimeConfig } from "@/lib/ghl/connections";
import { createServiceClient } from "@/lib/supabase/server";
import type { Funnel, GhlConnection, Question } from "@/lib/types/database";

export type AdapterEntry = {
  calendar?: CalendarProvider<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  crm?: CrmProvider<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Null when the connection cannot be used right now. */
  calendarContext?(row: ConnectionRow | GhlConnection | null, funnel: Funnel): Promise<unknown | null>;
  crmContext?(row: ConnectionRow | GhlConnection, funnel: Funnel): Promise<unknown | null>;
};

function isGhlConnection(row: ConnectionRow | GhlConnection | null): row is GhlConnection {
  return Boolean(row && "location_id" in row);
}

async function loadFormQuestions(funnel: Funnel): Promise<Question[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("questions")
    .select("*")
    .eq("funnel_id", funnel.id)
    .eq("tenant_id", funnel.tenant_id)
    .order("display_order", { ascending: true });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export const ADAPTERS: Partial<Record<CalendarKind | CrmKind, AdapterEntry>> = {
  ghl: {
    calendar: ghlCalendarProvider,
    crm: ghlCrmProvider,
    async calendarContext(row, funnel): Promise<GhlCalendarCtx | null> {
      if (!isGhlConnection(row) || !row.is_active) return null;
      const calendarId = funnel.calendar_id ?? row.calendar_id;
      if (!calendarId) return null;
      return {
        config: await resolveGhlRuntimeConfig(row),
        calendarId,
        slotDurationMinutes: funnel.slot_duration_minutes,
        availabilityWindowDays: funnel.availability_window_days ?? 14
      };
    },
    async crmContext(row, funnel): Promise<GhlCrmCtx | null> {
      if (!isGhlConnection(row) || !row.is_active) return null;
      return {
        config: await resolveGhlRuntimeConfig(row),
        funnel,
        connectionId: row.id,
        questions: await loadFormQuestions(funnel)
      };
    }
  },
  google_calendar: {
    calendar: googleCalendarProvider,
    async calendarContext(row, funnel) {
      if (!row || isGhlConnection(row)) return null;
      return googleCalendarContext(row, funnel);
    }
  },
  calcom: {
    calendar: calcomProvider,
    async calendarContext(row, funnel) {
      if (!row || isGhlConnection(row)) return null;
      return calcomContext(row, funnel);
    }
  }
};
