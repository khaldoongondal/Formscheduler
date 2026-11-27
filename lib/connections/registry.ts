/**
 * Provider metadata and the form editor's calendar and CRM picker values.
 * Pure: no Next.js, Supabase or I/O imports.
 */
import type { CalendarKind, CrmKind } from "@/lib/connections/types";

export type ProviderRole = "calendar" | "crm";
export type ProviderKind = CalendarKind | CrmKind;

export type ProviderMeta = {
  label: string;
  roles: readonly ProviderRole[];
  /** Shown on "Add" buttons and in pickers. Existing rows always render. */
  available: boolean;
  helpAnchor: string;
  /** Where the "Add" button on the Connections page goes. GoHighLevel has its own form. */
  addHref: string | null;
};

export const PROVIDERS: Record<ProviderKind, ProviderMeta> = {
  ghl: { label: "GoHighLevel", roles: ["calendar", "crm"], available: true, helpAnchor: "gohighlevel", addHref: null },
  google_calendar: {
    label: "Google Calendar",
    roles: ["calendar"],
    available: true,
    helpAnchor: "google-calendar",
    addHref: "/api/connect/google/start"
  },
  calcom: { label: "Cal.com", roles: ["calendar"], available: true, helpAnchor: "cal-com", addHref: "/admin/connections/new/calcom" },
  calendly: {
    label: "Calendly",
    roles: ["calendar"],
    available: false,
    helpAnchor: "calendly",
    addHref: "/admin/connections/new/calendly"
  },
  hubspot: { label: "HubSpot", roles: ["crm"], available: false, helpAnchor: "hubspot", addHref: "/admin/connections/new/hubspot" },
  webhook: { label: "Webhook", roles: ["crm"], available: false, helpAnchor: "webhook", addHref: "/admin/connections/new/webhook" }
};

export const PICKER_INVALID_MESSAGE = "Choose a calendar and a CRM from the lists.";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function providerLabel(kind: ProviderKind): string {
  return PROVIDERS[kind]?.label ?? kind;
}

export function providerHasRole(kind: ProviderKind, role: ProviderRole): boolean {
  return PROVIDERS[kind]?.roles.includes(role) ?? false;
}

/** "google_calendar:<uuid>" */
export function pickerValue(kind: CalendarKind | CrmKind, id: string): string {
  return `${kind}:${id}`;
}

export function parsePickerValue(value: string | null | undefined): { kind: CalendarKind | CrmKind; id: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const separator = trimmed.indexOf(":");
  if (separator <= 0) return null;
  const kind = trimmed.slice(0, separator);
  const id = trimmed.slice(separator + 1);
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, kind)) return null;
  if (!isUuid(id)) return null;
  return { kind: kind as CalendarKind | CrmKind, id: id.toLowerCase() };
}

export type PickerResolution = {
  calendar_provider: CalendarKind;
  calendar_connection_id: string | null;
  crm_provider: CrmKind;
  crm_connection_id: string | null;
  ghl_connection_id: string | null;
};

type PickerResult = { ok: true; value: PickerResolution } | { ok: false; message: string };

const invalid: PickerResult = { ok: false, message: PICKER_INVALID_MESSAGE };

/**
 * Turns the editor's two picker values into the funnel columns (P1.4).
 * A GoHighLevel calendar always uses the same GoHighLevel connection as CRM
 * (decision C3), so the CRM choice is ignored then.
 */
export function resolvePickerChoices(calendarChoice: string, crmChoice: string): PickerResult {
  const calendarRaw = (calendarChoice ?? "").trim();
  const crmRaw = (crmChoice ?? "").trim();

  if (!calendarRaw) {
    return {
      ok: true,
      value: {
        calendar_provider: "ghl",
        calendar_connection_id: null,
        crm_provider: "ghl",
        crm_connection_id: null,
        ghl_connection_id: null
      }
    };
  }

  const calendar = parsePickerValue(calendarRaw);
  if (!calendar || !providerHasRole(calendar.kind, "calendar")) return invalid;

  if (calendar.kind === "ghl") {
    return {
      ok: true,
      value: {
        calendar_provider: "ghl",
        calendar_connection_id: null,
        crm_provider: "ghl",
        crm_connection_id: null,
        ghl_connection_id: calendar.id
      }
    };
  }

  const base = { calendar_provider: calendar.kind as CalendarKind, calendar_connection_id: calendar.id };

  if (!crmRaw) {
    return { ok: true, value: { ...base, crm_provider: "ghl", crm_connection_id: null, ghl_connection_id: null } };
  }

  const crm = parsePickerValue(crmRaw);
  if (!crm || !providerHasRole(crm.kind, "crm")) return invalid;

  if (crm.kind === "ghl") {
    return { ok: true, value: { ...base, crm_provider: "ghl", crm_connection_id: null, ghl_connection_id: crm.id } };
  }

  return {
    ok: true,
    value: { ...base, crm_provider: crm.kind as CrmKind, crm_connection_id: crm.id, ghl_connection_id: null }
  };
}
