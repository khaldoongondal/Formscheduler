import Link from "next/link";
import type { ReactNode } from "react";
import type { DeliveryListRow } from "@/lib/meta/controls";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  eventKeyLabel,
  isDeliveryStatus,
  matchKeyChips,
  metaResponseText,
  reasonLabel,
  statusLabel,
  type StatusTone
} from "@/lib/meta/log-format";

const TONE_CLASSES: Record<StatusTone, string> = {
  slate: "bg-slate-100 text-slate-700",
  amber: "bg-amber-50 text-amber-800",
  emerald: "bg-emerald-50 text-emerald-700",
  red: "bg-red-50 text-red-700",
  blue: "bg-blue-50 text-blue-700"
};

export function formatEventTime(value: string) {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

export function DeliveryStatusBadge({ status, reason }: { status: string; reason: string | null }) {
  const tone = isDeliveryStatus(status) ? DELIVERY_STATUS_LABELS[status].tone : "slate";
  const reasonText = reasonLabel(reason);
  return (
    <div className="space-y-1">
      <span className={`inline-block rounded-md px-2 py-1 text-xs font-semibold ${TONE_CLASSES[tone]}`}>
        {statusLabel(status)}
      </span>
      {reasonText ? <p className="text-xs leading-5 text-slate-500">{reasonText}</p> : null}
    </div>
  );
}

function MatchChips({ keys }: { keys: string[] }) {
  const chips = matchKeyChips(keys);
  if (!chips.length) return <span className="text-xs text-slate-400">None</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {chips.map((chip) => (
        <span key={chip} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-700">
          {chip}
        </span>
      ))}
    </div>
  );
}

function ErrorCell({ error }: { error: string | null }) {
  if (!error) return <span className="text-xs text-slate-400">None</span>;
  if (error.length <= 80) return <span className="break-words text-xs text-red-700">{error}</span>;
  return (
    <details className="text-xs text-red-700">
      <summary className="cursor-pointer break-words">{error.slice(0, 80)}...</summary>
      <p className="mt-1 break-words">{error}</p>
    </details>
  );
}

function LeadCell({ row }: { row: DeliveryListRow }) {
  if (!row.lead_session_id) return <span>Visitor</span>;
  return (
    <Link href={`/admin/leads/${row.lead_session_id}`} className="font-medium text-slate-950 hover:underline">
      {row.lead_label}
    </Link>
  );
}

/**
 * The event log table (stacked cards below lg). Never shows payloads or tokens.
 * `renderAction` adds a control to a row (the "Send" button on held rows).
 */
export function DeliveryTable({
  rows,
  renderAction
}: {
  rows: DeliveryListRow[];
  renderAction?: (row: DeliveryListRow) => ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 lg:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Time</th>
              <th className="px-3 py-2 font-semibold">Event</th>
              <th className="px-3 py-2 font-semibold">Form</th>
              <th className="px-3 py-2 font-semibold">Lead</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Match keys</th>
              <th className="px-3 py-2 font-semibold">Meta response</th>
              <th className="px-3 py-2 font-semibold">Attempts</th>
              <th className="px-3 py-2 font-semibold">Error</th>
              {renderAction ? <th className="px-3 py-2 font-semibold"><span className="sr-only">Action</span></th> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-3 text-slate-700">{formatEventTime(row.event_time)}</td>
                <td className="px-3 py-3">
                  <p className="font-medium text-slate-950">{eventKeyLabel(row.event_key)}</p>
                  <p className="text-xs text-slate-500">{row.event_name}</p>
                </td>
                <td className="px-3 py-3 text-slate-700">{row.funnel_name ?? "None"}</td>
                <td className="px-3 py-3 text-slate-700">
                  <LeadCell row={row} />
                </td>
                <td className="px-3 py-3">
                  <DeliveryStatusBadge status={row.status} reason={row.status_reason} />
                </td>
                <td className="px-3 py-3">
                  <MatchChips keys={row.match_keys} />
                </td>
                <td className="max-w-[220px] break-words px-3 py-3 text-xs text-slate-700">
                  {metaResponseText(row.status, row.meta_response, row.last_error)}
                </td>
                <td className="px-3 py-3 text-slate-700">{row.attempts}</td>
                <td className="max-w-[220px] px-3 py-3">
                  <ErrorCell error={row.status === "failed" || row.status === "pending" ? row.last_error : null} />
                </td>
                {renderAction ? <td className="px-3 py-3">{renderAction(row)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 lg:hidden">
        {rows.map((row) => (
          <li key={row.id} className="space-y-2 rounded-lg border border-slate-200 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-medium text-slate-950">{eventKeyLabel(row.event_key)}</p>
                <p className="text-xs text-slate-500">
                  {row.event_name} | {formatEventTime(row.event_time)}
                </p>
              </div>
              <DeliveryStatusBadge status={row.status} reason={row.status_reason} />
            </div>
            <p className="text-xs text-slate-600">
              Form: {row.funnel_name ?? "None"} | Lead: <LeadCell row={row} /> | Attempts: {row.attempts}
            </p>
            <MatchChips keys={row.match_keys} />
            <p className="break-words text-xs text-slate-700">
              {metaResponseText(row.status, row.meta_response, row.last_error)}
            </p>
            {row.status === "failed" && row.last_error ? <ErrorCell error={row.last_error} /> : null}
            {renderAction ? <div>{renderAction(row)}</div> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatusLegend() {
  return (
    <div className="rounded-lg border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">What the statuses mean</p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        {DELIVERY_STATUSES.map((status) => (
          <div key={status}>
            <dt className="font-medium text-slate-900">{DELIVERY_STATUS_LABELS[status].label}</dt>
            <dd className="text-slate-600">{DELIVERY_STATUS_LABELS[status].help}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function TestResultAlert({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900" role="alert">
      <p>{message}</p>
    </div>
  );
}
