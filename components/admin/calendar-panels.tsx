import Link from "next/link";
import { CALCOM_COPY } from "@/lib/calcom/constants";
import type { CalcomEventType } from "@/lib/calcom/mapping";
import { CALCOM_PANEL_MARKER, GOOGLE_PANEL_MARKER } from "@/lib/connections/calendar-settings";
import { GOOGLE_COPY } from "@/lib/google/copy";

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const inputClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** Google Calendar fields in the form editor (P2.7). Server rendered. */
export function GoogleCalendarPanel({ connectionId, meet }: { connectionId: string | null; meet: boolean }) {
  return (
    <div className="space-y-3">
      <input type="hidden" name={GOOGLE_PANEL_MARKER} value="1" />
      <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
        <input type="checkbox" name="google_meet" defaultChecked={meet} />
        {GOOGLE_COPY.meetLabel}
      </label>
      <p className="text-xs leading-5 text-slate-500">
        {GOOGLE_COPY.editorHoursNote}{" "}
        {connectionId ? (
          <Link href={`/admin/connections/${connectionId}#availability`} className="font-medium underline underline-offset-2">
            {GOOGLE_COPY.editorHoursLink}
          </Link>
        ) : null}
      </p>
      <p className="text-xs leading-5 text-slate-500">{GOOGLE_COPY.editorTitleNote}</p>
    </div>
  );
}

/** Cal.com fields in the form editor (P2.7). Event types were loaded server-side for the saved connection. */
export function CalcomPanel({
  eventTypes,
  selectedId,
  windowDays
}: {
  eventTypes: CalcomEventType[] | null;
  selectedId: number | null;
  windowDays: number;
}) {
  const selected = eventTypes?.find((eventType) => eventType.id === selectedId) ?? null;
  return (
    <div className="space-y-3">
      <input type="hidden" name={CALCOM_PANEL_MARKER} value="1" />
      <div className="grid gap-4 md:grid-cols-[1.5fr_0.75fr]">
        <div className="space-y-2">
          <label htmlFor="calcom_event_type_id" className="text-sm font-medium text-slate-950">
            {CALCOM_COPY.eventTypeLabel}
          </label>
          {eventTypes === null ? (
            <>
              {/* Keeps the saved choice when the list cannot load. */}
              <input type="hidden" name="calcom_event_type_id" value={selectedId ?? ""} />
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {CALCOM_COPY.eventTypesLoadFailed}
              </p>
            </>
          ) : eventTypes.length === 0 ? (
            <>
              <input type="hidden" name="calcom_event_type_id" value="" />
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">{CALCOM_COPY.noEventTypes}</p>
            </>
          ) : (
            <select id="calcom_event_type_id" name="calcom_event_type_id" className={selectClass} defaultValue={selectedId ?? ""}>
              <option value="">{CALCOM_COPY.eventTypePlaceholder}</option>
              {eventTypes.map((eventType) => (
                <option key={eventType.id} value={eventType.id}>
                  {`${eventType.title} (${eventType.lengthInMinutes} min)`}
                  {eventType.hidden ? CALCOM_COPY.hiddenMarker : ""}
                  {eventType.requiresConfirmation ? CALCOM_COPY.confirmationMarker : ""}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="space-y-2">
          <label htmlFor="calcom_availability_window_days" className="text-sm font-medium text-slate-950">
            {CALCOM_COPY.daysLabel}
          </label>
          <input
            id="calcom_availability_window_days"
            name="availability_window_days"
            type="number"
            min={1}
            max={60}
            defaultValue={windowDays}
            className={inputClass}
          />
        </div>
      </div>
      {eventTypes?.some((eventType) => eventType.requiresConfirmation) ? (
        <p className={`text-xs leading-5 ${selected?.requiresConfirmation ? "text-amber-800" : "text-slate-500"}`}>
          {CALCOM_COPY.confirmationNote}
        </p>
      ) : null}
    </div>
  );
}
