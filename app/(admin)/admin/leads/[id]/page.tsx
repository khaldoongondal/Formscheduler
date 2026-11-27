import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fireLeadHeldAction } from "@/app/(admin)/admin/leads/actions";
import { DeliveryTable, StatusLegend, TestResultAlert, formatEventTime } from "@/app/(admin)/admin/pixels/delivery-ui";
import { ActionError, ActionSuccess } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listLeadDeliveries, type DeliveryListRow } from "@/lib/meta/controls";
import { META_CONTROLS_COPY } from "@/lib/meta/log-format";
import { isUuid } from "@/lib/meta/pixels";
import { createServiceClient } from "@/lib/supabase/server";
import type { CrmEventDelivery, LeadSession, LeadSessionStatus } from "@/lib/types/database";
import type { CalendarKind } from "@/lib/connections/types";
import { providerLabel } from "@/lib/connections/registry";
import { DELIVERIES_COPY, LEAD_DETAIL_COPY } from "@/lib/crm/copy";

export const dynamic = "force-dynamic";

const LEAD_STATUS_LABELS: Record<LeadSessionStatus, string> = {
  started: "Started",
  potential: "Lead",
  qualified: "Qualified",
  slots_shown: "Calendar shown",
  booked: "Booked",
  disqualified: "Disqualified",
  abandoned: "Abandoned",
  error: "Error"
};

type LeadRow = Pick<
  LeadSession,
  | "id"
  | "funnel_id"
  | "status"
  | "first_name"
  | "last_name"
  | "full_name"
  | "email"
  | "phone"
  | "created_at"
  | "split_test_id"
  | "meta_consent"
  | "meta_released_at"
  | "meta_released_by"
>;

async function loadLead(tenantId: string, leadSessionId: string) {
  if (!isUuid(leadSessionId)) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("lead_sessions")
    .select(
      "id,funnel_id,status,first_name,last_name,full_name,email,phone,created_at,split_test_id,meta_consent,meta_released_at,meta_released_by"
    )
    .eq("tenant_id", tenantId)
    .eq("id", leadSessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const lead = data as unknown as LeadRow;

  const [funnel, test] = await Promise.all([
    supabase
      .from("funnels")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .eq("id", lead.funnel_id)
      .maybeSingle(),
    lead.split_test_id
      ? supabase.from("split_tests").select("id,name").eq("tenant_id", tenantId).eq("id", lead.split_test_id).maybeSingle()
      : Promise.resolve({ data: null, error: null })
  ]);
  if (funnel.error) throw new Error(funnel.error.message);
  return {
    lead,
    funnel: (funnel.data as { id: string; name: string } | null) ?? null,
    test: (test.data as { id: string; name: string } | null) ?? null
  };
}

type LeadDeliveryRow = {
  id: string;
  event_type: CrmEventDelivery["event_type"];
  status: CrmEventDelivery["status"];
  status_reason: string | null;
  response_status: number | null;
  response_summary: string | null;
  last_error: string | null;
  connection_id: string | null;
  ghl_connection_id: string | null;
  created_at: string;
};

type LeadBookingRow = {
  id: string;
  status: string;
  slot_start: string | null;
  timezone: string | null;
  created_at: string;
  provider?: CalendarKind | null;
  meeting_url?: string | null;
};

/** This lead's CRM delivery rows with connection names, tenant scoped. Empty before migration 0031. */
async function loadLeadCrmDeliveries(tenantId: string, leadSessionId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("crm_event_deliveries")
    .select("id,event_type,status,status_reason,response_status,response_summary,last_error,connection_id,ghl_connection_id,created_at")
    .eq("tenant_id", tenantId)
    .eq("lead_session_id", leadSessionId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { rows: [] as LeadDeliveryRow[], names: new Map<string, string>() };
  const rows = (data ?? []) as LeadDeliveryRow[];
  const genericIds = [...new Set(rows.map((row) => row.connection_id).filter((id): id is string => Boolean(id)))];
  const ghlIds = [...new Set(rows.map((row) => row.ghl_connection_id).filter((id): id is string => Boolean(id)))];
  const [generic, ghl] = await Promise.all([
    genericIds.length
      ? supabase.from("connections").select("id,name").eq("tenant_id", tenantId).in("id", genericIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    ghlIds.length
      ? supabase.from("ghl_connections").select("id,name").eq("tenant_id", tenantId).in("id", ghlIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null })
  ]);
  const names = new Map<string, string>();
  for (const row of [...(generic.data ?? []), ...(ghl.data ?? [])] as Array<{ id: string; name: string }>) names.set(row.id, row.name);
  return { rows, names };
}

/** This lead's booking attempts, tenant scoped. Before migration 0029 there is no provider or meeting link. */
async function loadLeadBookings(tenantId: string, leadSessionId: string): Promise<LeadBookingRow[]> {
  const supabase = createServiceClient();
  const base = "id,status,slot_start,timezone,created_at";
  const query = (columns: string) =>
    supabase
      .from("booking_attempts")
      .select(columns)
      .eq("tenant_id", tenantId)
      .eq("lead_session_id", leadSessionId)
      .order("created_at", { ascending: false })
      .limit(20);
  const { data, error } = await query(`${base},provider,meeting_url`);
  if (!error) return (data ?? []) as unknown as LeadBookingRow[];
  if (error.code !== "42703") throw new Error(error.message);
  const legacy = await query(base);
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []) as unknown as LeadBookingRow[];
}

function deliveryResult(row: LeadDeliveryRow) {
  const reason = row.status_reason ? DELIVERIES_COPY.reasons[row.status_reason] ?? null : null;
  return [row.response_status ? `HTTP ${row.response_status}` : null, row.response_summary ?? row.last_error, reason]
    .filter(Boolean)
    .join(" ");
}

/** Only an https meeting link is rendered as a link. */
function safeMeetingUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 break-words text-sm text-slate-900">{children}</dd>
    </div>
  );
}

export default async function LeadPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; saved?: string; n?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for leads."
        description="Leads are stored in Supabase. Add the database environment variables before opening this page."
        missingEnv={missingEnv}
      />
    );
  }

  const { id } = await params;
  const tenantId = await getAdminTenantId();
  const loaded = await loadLead(tenantId, id);
  if (!loaded) notFound();
  const { lead, funnel, test } = loaded;

  let rows: DeliveryListRow[] = [];
  let loadError: string | null = null;
  try {
    rows = await listLeadDeliveries(tenantId, lead.id);
  } catch (error) {
    console.error("[meta] lead events failed", error instanceof Error ? error.message : "unknown error");
    loadError = "Meta events could not load. Refresh the page to try again.";
  }
  const hasHeld = rows.some((row) => row.status === "held");
  const [crmDeliveries, bookings] = await Promise.all([
    loadLeadCrmDeliveries(tenantId, lead.id).catch((error: unknown) => {
      console.error("[crm] lead deliveries failed", error instanceof Error ? error.message : "unknown error");
      return { rows: [] as LeadDeliveryRow[], names: new Map<string, string>() };
    }),
    loadLeadBookings(tenantId, lead.id).catch((error: unknown): LeadBookingRow[] => {
      console.error("[bookings] lead bookings failed", error instanceof Error ? error.message : "unknown error");
      return [];
    })
  ]);

  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const firedCount = Math.max(0, Math.floor(Number(query.n ?? 0)) || 0);
  const actionSuccess =
    query.saved === "fired"
      ? META_CONTROLS_COPY.leadSendSaved(firedCount)
      : query.saved === "nothing-held"
        ? META_CONTROLS_COPY.nothingHeld
        : null;

  const name =
    lead.full_name?.trim() || [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() || lead.email || "Lead";
  // meta_consent is stored only when the form showed the consent checkbox (decision M11).
  const consentLine =
    lead.meta_consent === false
      ? META_CONTROLS_COPY.leadConsentDeclined
      : lead.meta_consent === true
        ? META_CONTROLS_COPY.leadConsentGiven
        : META_CONTROLS_COPY.leadConsentCovered;

  return (
    <div className="space-y-8">
      <div>
        {funnel ? (
          <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
            <Link href={`/admin/funnels/${funnel.id}`}>
              <ArrowLeft className="h-4 w-4" />
              {funnel.name}
            </Link>
          </Button>
        ) : null}
        <h1 className="break-words text-3xl font-semibold tracking-tight text-slate-950">{name}</h1>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Detail label="Email">{lead.email || "Not given"}</Detail>
            <Detail label="Phone">{lead.phone || "Not given"}</Detail>
            <Detail label="Form">
              {funnel ? (
                <Link href={`/admin/funnels/${funnel.id}`} className="font-medium hover:underline">
                  {funnel.name}
                </Link>
              ) : (
                "Deleted form"
              )}
            </Detail>
            <Detail label="Created">{formatEventTime(lead.created_at)}</Detail>
            <Detail label="Lead session status">{LEAD_STATUS_LABELS[lead.status] ?? lead.status}</Detail>
            {test ? (
              <Detail label="Split test">
                <Link href={`/admin/split-tests/${test.id}`} className="font-medium hover:underline">
                  {test.name}
                </Link>
              </Detail>
            ) : null}
          </dl>
          <p className="text-sm text-slate-700">{consentLine}</p>
          {lead.meta_released_at ? (
            <p className="text-sm text-slate-700">
              {META_CONTROLS_COPY.leadReleased(lead.meta_released_by || "you", formatEventTime(lead.meta_released_at))}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-950">{LEAD_DETAIL_COPY.bookingsHeading}</h2>
        {bookings.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">{LEAD_DETAIL_COPY.bookingsEmpty}</p>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{LEAD_DETAIL_COPY.bookingColumns.time}</th>
                    <th className="px-4 py-3">{LEAD_DETAIL_COPY.bookingColumns.calendar}</th>
                    <th className="px-4 py-3">{LEAD_DETAIL_COPY.bookingColumns.status}</th>
                    <th className="px-4 py-3">{LEAD_DETAIL_COPY.bookingColumns.meeting}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {bookings.map((booking) => {
                    const meetingUrl = safeMeetingUrl(booking.meeting_url);
                    return (
                      <tr key={booking.id} className="align-top">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-700">
                          {booking.slot_start ? formatEventTime(booking.slot_start) : LEAD_DETAIL_COPY.notScheduled}
                        </td>
                        <td className="px-4 py-3 text-slate-900">{providerLabel(booking.provider ?? "ghl")}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {LEAD_DETAIL_COPY.bookingStatusLabels[booking.status] ?? booking.status}
                        </td>
                        <td className="px-4 py-3">
                          {meetingUrl ? (
                            <a
                              href={meetingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-medium text-slate-900 underline underline-offset-2"
                            >
                              {LEAD_DETAIL_COPY.openMeeting}
                            </a>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-slate-950">{LEAD_DETAIL_COPY.deliveriesHeading}</h2>
        {crmDeliveries.rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            {LEAD_DETAIL_COPY.deliveriesEmpty} {LEAD_DETAIL_COPY.deliveriesNote}
          </p>
        ) : (
          <Card>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">{DELIVERIES_COPY.columns.time}</th>
                    <th className="px-4 py-3">{DELIVERIES_COPY.columns.event}</th>
                    <th className="px-4 py-3">{LEAD_DETAIL_COPY.connectionColumn}</th>
                    <th className="px-4 py-3">{DELIVERIES_COPY.columns.status}</th>
                    <th className="px-4 py-3">{DELIVERIES_COPY.columns.result}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {crmDeliveries.rows.map((row) => {
                    const connectionId = row.connection_id ?? row.ghl_connection_id;
                    const connectionName = connectionId ? crmDeliveries.names.get(connectionId) ?? null : null;
                    return (
                      <tr key={row.id} className="align-top">
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">{formatEventTime(row.created_at)}</td>
                        <td className="px-4 py-3 text-slate-900">{DELIVERIES_COPY.eventLabels[row.event_type] ?? row.event_type}</td>
                        <td className="px-4 py-3">
                          {connectionId && connectionName ? (
                            <Link
                              href={`/admin/connections/${connectionId}/deliveries`}
                              className="font-medium text-slate-900 underline underline-offset-2"
                            >
                              {connectionName}
                            </Link>
                          ) : (
                            <span className="text-slate-500">{LEAD_DETAIL_COPY.removedConnection}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-700">{DELIVERIES_COPY.statusLabels[row.status] ?? row.status}</td>
                        <td className="max-w-[320px] break-words px-4 py-3 text-slate-600">{deliveryResult(row)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-xl font-semibold text-slate-950">Meta events</h2>
          {hasHeld ? (
            <form action={fireLeadHeldAction}>
              <input type="hidden" name="lead_session_id" value={lead.id} />
              <ConfirmSubmitButton
                label={META_CONTROLS_COPY.leadSendHeld}
                title={META_CONTROLS_COPY.leadSendHeld}
                description={META_CONTROLS_COPY.leadSendConfirm}
              />
            </form>
          ) : null}
        </div>
        {loadError ? (
          <TestResultAlert message={loadError} />
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            {META_CONTROLS_COPY.leadNoEvents}
          </p>
        ) : (
          <DeliveryTable rows={rows} />
        )}
        {rows.length > 0 ? <StatusLegend /> : null}
      </section>
    </div>
  );
}
