"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { PROVIDERS, parsePickerValue } from "@/lib/connections/registry";
import type { CalendarKind, CrmKind } from "@/lib/connections/types";

type PickerOption<Kind extends string> = { value: string; label: string; provider: Kind; note: string | null };

type Props = {
  calendarOptions: Array<PickerOption<CalendarKind>>;
  crmOptions: Array<PickerOption<CrmKind>>;
  /** pickerValue(...) of the saved form, or "". */
  calendarValue: string;
  crmValue: string;
  savedCalendarValue: string;
  savedCrmValue: string;
  /** Server-rendered provider fields, keyed by provider. */
  panels: Partial<Record<CalendarKind | CrmKind, ReactNode>>;
  /** Providers whose panel needs option lists loaded for the saved connection. */
  panelsNeedingSave?: Array<CalendarKind | CrmKind>;
};

const selectClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function groupByProvider<Kind extends string>(options: Array<PickerOption<Kind>>) {
  const groups = new Map<Kind, Array<PickerOption<Kind>>>();
  for (const option of options) {
    const list = groups.get(option.provider) ?? [];
    list.push(option);
    groups.set(option.provider, list);
  }
  return Array.from(groups.entries());
}

function kindOf(value: string): CalendarKind | CrmKind | null {
  return parsePickerValue(value)?.kind ?? null;
}

export function ConnectionPickers({
  calendarOptions,
  crmOptions,
  calendarValue,
  crmValue,
  savedCalendarValue,
  savedCrmValue,
  panels,
  panelsNeedingSave = []
}: Props) {
  const [calendar, setCalendar] = useState(calendarValue);
  const [crm, setCrm] = useState(crmValue);
  const rootRef = useRef<HTMLDivElement>(null);

  const calendarKind = kindOf(calendar) as CalendarKind | null;
  const calendarIsGhl = calendarKind === "ghl";
  const crmKind: CrmKind | null = calendarIsGhl ? "ghl" : (kindOf(crm) as CrmKind | null);
  const calendarGroups = useMemo(() => groupByProvider(calendarOptions), [calendarOptions]);
  const crmGroups = useMemo(() => groupByProvider(crmOptions), [crmOptions]);

  // GoHighLevel-only fields elsewhere in the form follow the chosen CRM.
  useEffect(() => {
    const form = rootRef.current?.closest("form");
    // No calendar or no CRM chosen resolves to GoHighLevel (resolvePickerChoices).
    if (form) form.setAttribute("data-crm", crmKind ?? "ghl");
  }, [crmKind]);

  const calendarChanged = calendar !== savedCalendarValue;
  const crmChanged = (calendarIsGhl ? "" : crm) !== savedCrmValue;

  function panelFor(kind: CalendarKind | CrmKind, selected: boolean, changed: boolean) {
    const panel = panels[kind];
    if (!panel) return null;
    const needsSave = selected && changed && panelsNeedingSave.includes(kind);
    return (
      <fieldset key={kind} disabled={!selected} hidden={!selected} className="space-y-4">
        {needsSave ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {CONNECTIONS_COPY.saveToLoad}
          </p>
        ) : (
          panel
        )}
      </fieldset>
    );
  }

  return (
    <div ref={rootRef} className="space-y-5">
      <style>{`form[data-crm]:not([data-crm="ghl"]) .ghl-only { display: none; }`}</style>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="calendar_choice" className="text-sm font-medium leading-none text-slate-950">
            {CONNECTIONS_COPY.calendarLabel}
          </label>
          <Link href="/admin/connections" className="text-xs font-medium text-slate-600 underline underline-offset-2 hover:text-slate-950">
            {CONNECTIONS_COPY.manageConnections}
          </Link>
        </div>
        <select
          id="calendar_choice"
          name="calendar_choice"
          className={selectClass}
          value={calendar}
          onChange={(event) => setCalendar(event.target.value)}
        >
          <option value="">{CONNECTIONS_COPY.calendarPlaceholder}</option>
          {calendarGroups.map(([provider, options]) => (
            <optgroup key={provider} label={PROVIDERS[provider]?.label ?? provider}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                  {option.note ?? ""}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {(Object.keys(PROVIDERS) as Array<CalendarKind | CrmKind>)
        .filter((kind) => PROVIDERS[kind].roles.includes("calendar"))
        .map((kind) => panelFor(kind, calendarKind === kind, calendarChanged))}

      <div className="space-y-2">
        <label htmlFor="crm_choice" className="text-sm font-medium leading-none text-slate-950">
          {CONNECTIONS_COPY.crmLabel}
        </label>
        {calendarIsGhl ? (
          <>
            <input type="hidden" name="crm_choice" value="" />
            <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {CONNECTIONS_COPY.sameGhlConnection}
            </p>
          </>
        ) : (
          <select
            id="crm_choice"
            name="crm_choice"
            className={selectClass}
            value={crm}
            onChange={(event) => setCrm(event.target.value)}
          >
            <option value="">{CONNECTIONS_COPY.crmPlaceholder}</option>
            {crmGroups.map(([provider, options]) => (
              <optgroup key={provider} label={PROVIDERS[provider]?.label ?? provider}>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                    {option.note ?? ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>

      {(Object.keys(PROVIDERS) as Array<CalendarKind | CrmKind>)
        .filter((kind) => kind !== "ghl" && PROVIDERS[kind].roles.includes("crm"))
        .map((kind) => panelFor(kind, !calendarIsGhl && crmKind === kind, crmChanged))}
    </div>
  );
}
