import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { retryDeliveryAction } from "@/app/(admin)/admin/connections/actions";
import { ActionError, ActionSuccess } from "@/app/(admin)/admin/connections/connection-ui";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { DELIVERIES_COPY } from "@/lib/crm/copy";
import { isUuid } from "@/lib/connections/registry";
import { getConnectionSummary } from "@/lib/connections/service";
import { getGhlConnectionForTenant } from "@/lib/ghl/connections";
import { createServiceClient } from "@/lib/supabase/server";
import type { CrmEventDelivery } from "@/lib/types/database";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Card, CardContent } from "@/components/ui/card";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const STATUSES = ["all", "pending", "sent", "failed", "skipped"] as const;
const EVENTS = ["all", "lead.captured", "lead.qualified", "lead.disqualified", "lead.booked", "test.ping"] as const;

type LogRow = Pick<
  CrmEventDelivery,
  | "id"
  | "event_type"
  | "status"
  | "status_reason"
  | "attempts"
  | "response_status"
  | "response_summary"
  | "last_error"
  | "lead_session_id"
  | "created_at"
> & { has_payload: boolean };

type LeadLabel = { id: string; label: string };

const selectClass =
  "h-9 rounded-md border border-input bg-white px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function statusClass(status: string) {
  if (status === "sent") return "bg-emerald-50 text-emerald-700";
  if (status === "failed") return "bg-red-50 text-red-700";
  if (status === "pending") return "bg-amber-50 text-amber-800";
  return "bg-slate-100 text-slate-600";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

export default async function DeliveryLogPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ status?: string; event?: string; before?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tenantId = await getAdminTenantId();
  const generic = await getConnectionSummary(tenantId, id);
  const ghl = generic ? null : await getGhlConnectionForTenant(id, tenantId).catch(() => null);
  if (!generic && !ghl) notFound();
  const name = generic?.name ?? ghl?.name ?? "";
  const backHref = generic ? `/admin/connections/${id}` : "/admin/connections";

  const query = searchParams ? await searchParams : {};
  const status = (STATUSES as readonly string[]).includes(query.status ?? "") ? (query.status as string) : "all";
  const event = (EVENTS as readonly string[]).includes(query.event ?? "") ? (query.event as string) : "all";
  const before = query.before && !Number.isNaN(Date.parse(query.before)) ? new Date(query.before).toISOString() : null;

  const supabase = createServiceClient();
  let request = supabase
    .from("crm_event_deliveries")
    .select("id,event_type,status,status_reason,attempts,response_status,response_summary,last_error,lead_session_id,created_at,payload")
    .eq("tenant_id", tenantId)
    .eq(generic ? "connection_id" : "ghl_connection_id", id);
  if (status !== "all") request = request.eq("status", status as CrmEventDelivery["status"]);
  if (event !== "all") request = request.eq("event_type", event as CrmEventDelivery["event_type"]);
  if (before) request = request.lt("created_at", before);
  const { data, error } = await request.order("created_at", { ascending: false }).limit(PAGE_SIZE + 1);
  // Before migration 0031 the table is missing: show the empty log.
  const raw = error ? [] : ((data ?? []) as Array<CrmEventDelivery>);
  const rows: LogRow[] = raw.slice(0, PAGE_SIZE).map(({ payload, ...row }) => ({ ...row, has_payload: payload !== null }));
  const nextBefore = raw.length > PAGE_SIZE ? rows[rows.length - 1]?.created_at ?? null : null;

  const leadIds = [...new Set(rows.map((row) => row.lead_session_id).filter((value): value is string => Boolean(value)))];
  const leads = new Map<string, LeadLabel>();
  if (leadIds.length) {
    const { data: sessions } = await supabase
      .from("lead_sessions")
      .select("id,full_name,first_name,last_name,email,external_ref")
      .eq("tenant_id", tenantId)
      .in("id", leadIds);
    for (const session of sessions ?? []) {
      const nameText = session.full_name?.trim() || [session.first_name, session.last_name].filter(Boolean).join(" ").trim();
      const label =
        nameText || session.email?.trim() || DELIVERIES_COPY.leadFallback(String(session.external_ref ?? session.id).slice(0, 8));
      leads.set(session.id, { id: session.id, label });
    }
  }

  const filterQuery = (extra: Record<string, string>) => {
    const params = new URLSearchParams();
    if (status !== "all") params.set("status", status);
    if (event !== "all") params.set("event", event);
    for (const [key, value] of Object.entries(extra)) params.set(key, value);
    const text = params.toString();
    return text ? `?${text}` : "";
  };

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <Link href={backHref} className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          {DELIVERIES_COPY.backToConnection}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{DELIVERIES_COPY.heading(name)}</h1>
        <p className="mt-1 text-sm text-slate-600">{DELIVERIES_COPY.intro(name)}</p>
      </div>

      {query.saved === "resent" ? <ActionSuccess message={DELIVERIES_COPY.resent} /> : null}
      {query.error ? <ActionError message={query.error} /> : null}

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="space-y-1 text-sm font-medium text-slate-700">
          <span className="block">{DELIVERIES_COPY.statusFilter}</span>
          <select name="status" defaultValue={status} className={selectClass}>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {DELIVERIES_COPY.statusLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium text-slate-700">
          <span className="block">{DELIVERIES_COPY.eventFilter}</span>
          <select name="event" defaultValue={event} className={selectClass}>
            {EVENTS.map((value) => (
              <option key={value} value={value}>
                {DELIVERIES_COPY.eventLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 hover:bg-slate-50">
          {DELIVERIES_COPY.filterButton}
        </button>
      </form>

      <Card>
        <CardContent className="overflow-x-auto p-0">
          {rows.length ? (
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">{DELIVERIES_COPY.columns.time}</th>
                  <th className="px-4 py-3">{DELIVERIES_COPY.columns.event}</th>
                  <th className="px-4 py-3">{DELIVERIES_COPY.columns.lead}</th>
                  <th className="px-4 py-3">{DELIVERIES_COPY.columns.status}</th>
                  <th className="px-4 py-3">{DELIVERIES_COPY.columns.attempts}</th>
                  <th className="px-4 py-3">{DELIVERIES_COPY.columns.result}</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const lead = row.lead_session_id ? leads.get(row.lead_session_id) : null;
                  const reason = row.status_reason ? DELIVERIES_COPY.reasons[row.status_reason] ?? null : null;
                  const result =
                    [row.response_status ? `HTTP ${row.response_status}` : null, row.response_summary ?? row.last_error, reason]
                      .filter(Boolean)
                      .join(" ") || "";
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatTime(row.created_at)}</td>
                      <td className="px-4 py-3 text-slate-900">{DELIVERIES_COPY.eventLabels[row.event_type]}</td>
                      <td className="px-4 py-3">
                        {lead ? (
                          <Link href={`/admin/leads/${lead.id}`} className="font-medium text-slate-900 underline underline-offset-2">
                            {lead.label}
                          </Link>
                        ) : row.event_type === "test.ping" ? (
                          <span className="text-slate-500">{DELIVERIES_COPY.testLead}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${statusClass(row.status)}`}>
                          {DELIVERIES_COPY.statusLabels[row.status] ?? row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.attempts}</td>
                      <td className="max-w-[320px] break-words px-4 py-3 text-slate-600">{result}</td>
                      <td className="px-4 py-3">
                        {row.status === "failed" && row.has_payload && row.event_type !== "test.ping" ? (
                          <form action={retryDeliveryAction}>
                            <input type="hidden" name="connection_id" value={id} />
                            <input type="hidden" name="delivery_id" value={row.id} />
                            <SaveSubmitButton label={DELIVERIES_COPY.sendAgain} variant="outline" size="sm" pendingLabel="Sending..." />
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="p-5 text-sm text-slate-600">{DELIVERIES_COPY.empty}</p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-between text-sm">
        {before ? (
          <Link href={`/admin/connections/${id}/deliveries${filterQuery({})}`} className="font-medium underline underline-offset-2">
            {DELIVERIES_COPY.newest}
          </Link>
        ) : (
          <span />
        )}
        {nextBefore ? (
          <Link
            href={`/admin/connections/${id}/deliveries${filterQuery({ before: nextBefore })}`}
            className="font-medium underline underline-offset-2"
          >
            {DELIVERIES_COPY.older}
          </Link>
        ) : null}
      </div>
    </div>
  );
}
