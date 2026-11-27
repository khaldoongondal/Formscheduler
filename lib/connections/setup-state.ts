/**
 * Setup states shown on the welcome page, the forms list, the Connections
 * page and the form editor (P4.2, P4.3). Pure: no Next.js, Supabase or I/O
 * imports, and no provider API calls: everything comes from rows already
 * loaded.
 */
import { PUBLISH_NEEDS_CALENDAR_MESSAGE, PUBLISH_NEEDS_CONNECTION_MESSAGE } from "@/lib/funnels/publish-readiness";
import {
  READINESS_COPY,
  formReadinessError,
  funnelReadinessInput,
  readinessConnectionFrom
} from "@/lib/connections/readiness";
import { PROVIDERS, type ProviderKind } from "@/lib/connections/registry";
import type { CalendarKind, ConnectionStatus, CrmKind, GenericProvider } from "@/lib/connections/types";

export const SETUP_COPY = {
  calendarStepTitle: "Connect a calendar",
  calendarStepBody: "Google Calendar, Cal.com, Calendly or GoHighLevel. Visitors book straight into it.",
  calendarStepButton: "Connect a calendar",
  crmStepTitle: "Connect a CRM",
  crmStepBody: "HubSpot, GoHighLevel, or a webhook for n8n, Zapier, Make and other tools. Every lead is sent there.",
  crmStepButton: "Connect a CRM",
  formStepTitle: "Create your first form",
  formStepButton: "Create your first form",
  formStepNote: "You can activate a form once it has a calendar and a CRM.",
  done: "Done",
  ready: "Ready to take bookings.",
  fixThis: "Fix this",
  needsSetup: "Needs setup",
  helpLink: "How to set this up",
  usedBy: (count: number) => (count === 1 ? "Used by 1 form" : `Used by ${count} forms`)
} as const;

export const HELP_PAGE_PATH = "/help/connections";

/** "/help/connections#google-calendar" */
export function helpHref(kind: ProviderKind): string {
  return `${HELP_PAGE_PATH}#${PROVIDERS[kind]?.helpAnchor ?? ""}`;
}

type GhlConnectionLite = { id: string; calendar_id: string | null; is_active: boolean };
type GenericConnectionLite = {
  id: string;
  provider: GenericProvider;
  status: ConnectionStatus;
  availabilityConfirmedAt: string | null;
  settings: Record<string, unknown>;
};

/** Welcome page steps 1 and 2: an active GoHighLevel connection counts for both roles. */
export function welcomeSetupState(
  ghlConnections: Array<Pick<GhlConnectionLite, "is_active">>,
  connections: Array<Pick<GenericConnectionLite, "provider" | "status">>
): { calendarDone: boolean; crmDone: boolean } {
  const ghlActive = ghlConnections.some((connection) => connection.is_active);
  const connectedWithRole = (role: "calendar" | "crm") =>
    connections.some((connection) => connection.status === "connected" && PROVIDERS[connection.provider]?.roles.includes(role));
  return {
    calendarDone: ghlActive || connectedWithRole("calendar"),
    crmDone: ghlActive || connectedWithRole("crm")
  };
}

export type FormConnectionColumns = {
  ghl_connection_id: string | null;
  calendar_id: string | null;
  calendar_provider?: CalendarKind | null;
  calendar_connection_id?: string | null;
  crm_provider?: CrmKind | null;
  crm_connection_id?: string | null;
  calendar_settings?: unknown;
  crm_settings?: unknown;
};

/** The connection ids a form uses, GoHighLevel included, each once. */
export function connectionIdsOfForm(form: FormConnectionColumns): string[] {
  const calendarKind = form.calendar_provider ?? "ghl";
  const crmKind = form.crm_provider ?? "ghl";
  const ids = new Set<string>();
  // The GoHighLevel connection serves the calendar, the CRM or both.
  if (form.ghl_connection_id && (calendarKind === "ghl" || crmKind === "ghl")) ids.add(form.ghl_connection_id);
  if (calendarKind !== "ghl" && form.calendar_connection_id) ids.add(form.calendar_connection_id);
  if (crmKind !== "ghl" && form.crm_connection_id) ids.add(form.crm_connection_id);
  return [...ids];
}

/** "Used by {n} forms" on the Connections page: connection id to number of forms. */
export function countFormsByConnection(forms: FormConnectionColumns[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const form of forms) {
    for (const id of connectionIdsOfForm(form)) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/**
 * The activation message for a form from rows already loaded, or null when
 * the form is ready. Same rule as activation (formReadinessError).
 */
export function formSetupError(
  form: FormConnectionColumns,
  ghlConnections: GhlConnectionLite[],
  connections: GenericConnectionLite[]
): string | null {
  const calendarKind = form.calendar_provider ?? "ghl";
  const crmKind = form.crm_provider ?? "ghl";
  const ghl = form.ghl_connection_id ? ghlConnections.find((connection) => connection.id === form.ghl_connection_id) ?? null : null;
  const find = (id: string | null | undefined) => (id ? connections.find((connection) => connection.id === id) ?? null : null);
  const calendar = calendarKind !== "ghl" ? find(form.calendar_connection_id) : null;
  const crm = crmKind !== "ghl" ? find(form.crm_connection_id) : null;
  return formReadinessError(
    funnelReadinessInput(
      {
        calendar_provider: calendarKind,
        crm_provider: crmKind,
        calendar_settings: form.calendar_settings,
        crm_settings: form.crm_settings,
        ghl_connection_id: form.ghl_connection_id,
        calendar_id: form.calendar_id
      },
      ghl,
      readinessConnectionFrom(calendar),
      readinessConnectionFrom(crm)
    )
  );
}

/**
 * Where the editor's "Fix this" link goes for a readiness message: the
 * connection to repair, the Connections page section to add one, or the
 * picker on this page for a form setting.
 */
export function readinessFixHref(
  message: string,
  form: Pick<FormConnectionColumns, "calendar_connection_id" | "crm_connection_id">,
  options: { hasCalendarChoices: boolean; hasCrmChoices: boolean }
): string {
  const picker = "#calendar_choice";
  const connectionPage = (id: string | null | undefined, fallback: string) => (id ? `/admin/connections/${id}` : fallback);
  switch (message) {
    case READINESS_COPY.needsCalendar:
    case PUBLISH_NEEDS_CONNECTION_MESSAGE:
      return options.hasCalendarChoices ? picker : "/admin/connections#calendars";
    case READINESS_COPY.needsCrm:
      return options.hasCrmChoices ? "#crm_choice" : "/admin/connections#crms";
    case READINESS_COPY.calendarNeedsAttention:
    case READINESS_COPY.calendarDisabled:
    case READINESS_COPY.calendlyConfirmations:
    case READINESS_COPY.googleHours:
      return connectionPage(form.calendar_connection_id, "/admin/connections#calendars");
    case READINESS_COPY.crmNeedsAttention:
    case READINESS_COPY.crmDisabled:
      return connectionPage(form.crm_connection_id, "/admin/connections#crms");
    case READINESS_COPY.ghlCrmInactive:
      return "/admin/connections#calendars";
    case READINESS_COPY.hubspotStages:
      return "#crm_choice";
    case PUBLISH_NEEDS_CALENDAR_MESSAGE:
    case READINESS_COPY.calcomEventType:
    case READINESS_COPY.calendlyEventType:
    default:
      return picker;
  }
}
