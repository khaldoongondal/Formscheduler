/**
 * Per-provider calendar settings posted by the form editor (P2.7, decision C23).
 * Chosen ids are re-validated against a fresh list from the provider.
 */
import { CALCOM_COPY } from "@/lib/calcom/constants";
import { loadCalcomEventTypes } from "@/lib/connections/calcom";
import type { CalendarKind } from "@/lib/connections/types";

/** Hidden inputs the editor panels post so the action knows the panel was shown. */
export const GOOGLE_PANEL_MARKER = "google_panel";
export const CALCOM_PANEL_MARKER = "calcom_panel";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * The calendar_settings to save, or undefined to keep the stored value.
 * A changed calendar connection without its panel (the editor asked to save
 * first) resets the settings, since ids of another account mean nothing.
 */
export async function calendarSettingsFromForm(input: {
  formData: FormData;
  tenantId: string;
  calendarProvider: CalendarKind;
  calendarConnectionId: string | null;
  saved: { calendarProvider: CalendarKind; calendarConnectionId: string | null; calendarSettings: unknown };
}): Promise<Record<string, unknown> | undefined> {
  const { formData, calendarProvider, calendarConnectionId, saved } = input;
  const connectionChanged =
    calendarProvider !== saved.calendarProvider || (calendarConnectionId ?? null) !== (saved.calendarConnectionId ?? null);

  if (calendarProvider === "google_calendar" && formData.has(GOOGLE_PANEL_MARKER)) {
    return { google_meet: formData.get("google_meet") === "on" };
  }

  if (calendarProvider === "calcom" && formData.has(CALCOM_PANEL_MARKER) && calendarConnectionId && !connectionChanged) {
    const chosen = String(formData.get("calcom_event_type_id") ?? "").trim();
    if (!chosen) return {};
    const eventTypeId = Number(chosen);
    if (!Number.isInteger(eventTypeId) || eventTypeId <= 0) throw new Error(CALCOM_COPY.chooseEventType);
    const current = asRecord(saved.calendarSettings);
    // Unchanged choice: no provider call needed on every save.
    if (Number(current.event_type_id) === eventTypeId) return undefined;
    const result = await loadCalcomEventTypes(input.tenantId, calendarConnectionId);
    if (!result.ok) throw new Error(CALCOM_COPY.eventTypesLoadFailed);
    const eventType = result.eventTypes.find((item) => item.id === eventTypeId);
    if (!eventType) throw new Error(CALCOM_COPY.chooseEventType);
    return { event_type_id: eventType.id, event_type_title: eventType.title, length_minutes: eventType.lengthInMinutes };
  }

  if (connectionChanged) return {};
  return undefined;
}
