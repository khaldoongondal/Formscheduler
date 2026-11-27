/**
 * Can this form be Active? One rule for every calendar and CRM pairing
 * (decision C7). Pure: no Next.js, Supabase or I/O imports.
 *
 * A GoHighLevel calendar keeps the existing publishReadinessError messages
 * and behaviour unchanged.
 */
import { publishReadinessError } from "@/lib/funnels/publish-readiness";
import type { CalendarKind, ConnectionStatus, CrmKind, GenericProvider } from "@/lib/connections/types";

export const READINESS_COPY = {
  needsCalendar: "Choose a calendar for this form before activating it. Connect one under Connections first.",
  needsCrm: "Choose where this form sends leads (a CRM) before activating it. Connect one under Connections first.",
  calendarNeedsAttention:
    "The calendar connection for this form needs attention. Open Connections to fix it, then activate the form.",
  crmNeedsAttention: "The CRM connection for this form needs attention. Open Connections to fix it, then activate the form.",
  calendarDisabled: "The calendar connection for this form is switched off. Switch it on under Connections first.",
  crmDisabled: "The CRM connection for this form is switched off. Switch it on under Connections first.",
  ghlCrmInactive: "The GoHighLevel connection this form sends leads to is inactive. Turn it on under Connections first.",
  googleHours: "Set your working hours on this Google Calendar connection before activating a form that uses it.",
  calcomEventType: "Choose a Cal.com event type for this form before activating it.",
  calendlyEventType: "Choose a Calendly event type for this form before activating it.",
  calendlyConfirmations:
    "Calendly booking confirmations are not set up for this connection. Open Connections and choose Set up confirmations.",
  hubspotStages: "Choose the HubSpot pipeline and the stages for new and booked leads, or turn off deals for this form."
} as const;

export type ReadinessConnection = {
  provider: GenericProvider;
  status: ConnectionStatus;
  /** Google only. */
  availabilityConfirmed: boolean;
  /** Calendly only: settings.webhook_subscription_uri present. */
  webhookReady: boolean;
} | null;

export type FormReadinessInput = {
  calendarProvider: CalendarKind;
  ghl: {
    connectionId: string | null;
    calendarId: string | null;
    connectionCalendarId: string | null;
    connectionActive: boolean | null;
  };
  calendarConnection: ReadinessConnection;
  calendarSettings: Record<string, unknown>;
  crmProvider: CrmKind;
  crmConnection: ReadinessConnection;
  crmSettings: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** A connection summary (or a row mapped to one) as readiness sees it. */
export function readinessConnectionFrom(
  connection: {
    provider: GenericProvider;
    status: ConnectionStatus;
    availabilityConfirmedAt: string | null;
    settings: Record<string, unknown>;
  } | null
): ReadinessConnection {
  if (!connection) return null;
  const subscription = connection.settings.webhook_subscription_uri;
  return {
    provider: connection.provider,
    status: connection.status,
    availabilityConfirmed: Boolean(connection.availabilityConfirmedAt),
    webhookReady: typeof subscription === "string" && subscription.trim().length > 0
  };
}

/** The form's columns plus its loaded connections, as formReadinessError input. */
export function funnelReadinessInput(
  funnel: {
    calendar_provider?: CalendarKind | null;
    crm_provider?: CrmKind | null;
    calendar_settings?: unknown;
    crm_settings?: unknown;
    ghl_connection_id: string | null;
    calendar_id: string | null;
  },
  ghlConnection: { id: string; calendar_id: string | null; is_active: boolean } | null,
  calendarConnection: ReadinessConnection,
  crmConnection: ReadinessConnection
): FormReadinessInput {
  return {
    calendarProvider: funnel.calendar_provider ?? "ghl",
    ghl: {
      connectionId: ghlConnection ? ghlConnection.id : null,
      calendarId: funnel.calendar_id,
      connectionCalendarId: ghlConnection?.calendar_id ?? null,
      connectionActive: ghlConnection ? ghlConnection.is_active : null
    },
    calendarConnection,
    calendarSettings: asRecord(funnel.calendar_settings),
    crmProvider: funnel.crm_provider ?? "ghl",
    crmConnection,
    crmSettings: asRecord(funnel.crm_settings)
  };
}

const CALENDLY_EVENT_TYPE_PREFIX = "https://api.calendly.com/event_types/";

function isPositiveInteger(value: unknown): boolean {
  const number = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0;
}

function nonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** Returns the message to show when the form cannot be Active, or null when it can. */
export function formReadinessError(input: FormReadinessInput): string | null {
  // 1. GoHighLevel calendar: the existing rule, unchanged.
  if (input.calendarProvider === "ghl") {
    return publishReadinessError({
      ghlConnectionId: input.ghl.connectionId,
      calendarId: input.ghl.calendarId,
      connectionCalendarId: input.ghl.connectionCalendarId
    });
  }

  // 2. The calendar connection.
  const calendar = input.calendarConnection;
  if (!calendar || calendar.provider !== input.calendarProvider) return READINESS_COPY.needsCalendar;
  if (calendar.status === "disabled") return READINESS_COPY.calendarDisabled;
  if (calendar.provider === "calendly" && !calendar.webhookReady) return READINESS_COPY.calendlyConfirmations;
  if (calendar.status === "needs_attention") return READINESS_COPY.calendarNeedsAttention;

  // 3. Provider settings.
  if (calendar.provider === "google_calendar" && !calendar.availabilityConfirmed) return READINESS_COPY.googleHours;
  if (calendar.provider === "calcom" && !isPositiveInteger(input.calendarSettings.event_type_id)) {
    return READINESS_COPY.calcomEventType;
  }
  if (calendar.provider === "calendly") {
    const uri = input.calendarSettings.event_type_uri;
    if (typeof uri !== "string" || !uri.startsWith(CALENDLY_EVENT_TYPE_PREFIX) || uri.length <= CALENDLY_EVENT_TYPE_PREFIX.length) {
      return READINESS_COPY.calendlyEventType;
    }
  }

  // 4. The CRM.
  if (input.crmProvider === "ghl") {
    if (!input.ghl.connectionId?.trim()) return READINESS_COPY.needsCrm;
    if (input.ghl.connectionActive === false) return READINESS_COPY.ghlCrmInactive;
    return null;
  }

  const crm = input.crmConnection;
  if (!crm || crm.provider !== input.crmProvider) return READINESS_COPY.needsCrm;
  if (crm.status === "disabled") return READINESS_COPY.crmDisabled;
  if (crm.status === "needs_attention") return READINESS_COPY.crmNeedsAttention;

  // 5. HubSpot deal stages.
  if (crm.provider === "hubspot") {
    const settings = input.crmSettings;
    const needsLead = settings.deal_on_lead === true;
    const needsBooked = settings.deal_on_booked === true;
    const pipelineOk = nonEmptyString(settings.pipeline_id);
    if (needsLead && !(pipelineOk && nonEmptyString(settings.lead_stage_id))) return READINESS_COPY.hubspotStages;
    if (needsBooked && !(pipelineOk && nonEmptyString(settings.booked_stage_id))) return READINESS_COPY.hubspotStages;
  }

  return null;
}
