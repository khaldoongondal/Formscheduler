import Link from "next/link";
import { ChevronRight, ExternalLink } from "lucide-react";
import { dismissReportAction, sendLifecycleTestAction, takeDownFormAction } from "@/app/(admin)/admin/clients/actions";
import { OwnerNotices, PlanPill, ownerInputClass } from "@/app/(admin)/admin/clients/notices";
import { requirePlatformOwner } from "@/lib/auth/owner-server";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import {
  defaultTakedownReason,
  formatOwnerDate,
  isOverActiveLimit,
  parsePlanChangeParams,
  planLimitsFor
} from "@/lib/owner/format";
import { LIFECYCLE_COPY, lifecycleConfig } from "@/lib/lifecycle/events";
import type { LifecycleStatus } from "@/lib/lifecycle/queue";
import {
  ACTIVATION_COPY,
  activationFunnel,
  clientStage,
  formatPct,
  parsePeriod,
  type ActivationRow,
  type ActivationStep,
  type Period
} from "@/lib/owner/activation";
import {
  getLifecycleStatus,
  listActivationRows,
  listClients,
  listOpenReports,
  listPendingSignupDates,
  type ClientRow,
  type OpenReport
} from "@/lib/owner/service";
import { REPORT_REASON_LABELS, type ReportReason } from "@/lib/validation/form-reports";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Client Management", robots: { index: false } };

export default async function ClientsPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformOwner();

  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for Client Management."
        description="Client Management reads every account from Supabase."
        missingEnv={missingEnv}
      />
    );
  }

  const [clients, reports, activationRows, pendingSignups, lifecycleStatus] = await Promise.all([
    listClients(),
    listOpenReports(),
    listActivationRows(),
    listPendingSignupDates(),
    getLifecycleStatus()
  ]);
  const query = searchParams ? await searchParams : {};
  const period = parsePeriod(query.period);
  const funnel = activationFunnel(activationRows, pendingSignups, period, new Date());
  const activationByTenant = new Map(activationRows.map((row) => [row.tenantId, row]));
  const lifecycleOn = lifecycleConfig(process.env) !== null;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-emerald-700">Owner</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Client Management</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Every FormBook account, its plan and usage.</p>
      </div>

      <OwnerNotices
        saved={typeof query.saved === "string" ? query.saved : undefined}
        error={typeof query.error === "string" ? query.error : undefined}
        counts={parsePlanChangeParams(query)}
      />

      <ActivationFunnel steps={funnel.steps} excludedLegacy={funnel.excludedLegacy} period={period} />

      <LifecycleCard on={lifecycleOn} status={lifecycleStatus} />

      {reports.length > 0 ? <OpenReports reports={reports} /> : null}

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-950">Clients ({clients.length})</h2>
        {clients.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white px-4 py-6 text-sm text-slate-600">No accounts yet.</p>
        ) : (
          <>
            <ClientsTable clients={clients} activation={activationByTenant} />
            <ClientCards clients={clients} activation={activationByTenant} />
          </>
        )}
      </section>
    </div>
  );
}

const PERIODS: Period[] = ["all", "90", "30"];

function stepPercent(step: ActivationStep) {
  if (step.key === "signed_up") return "";
  if (step.key === "upgraded") {
    return step.pctOfBase === null ? ACTIVATION_COPY.none : `${step.pctOfBase}% ${ACTIVATION_COPY.upgradedBase}`;
  }
  return formatPct(step.pctOfBase);
}

function ActivationFunnel({ steps, excludedLegacy, period }: { steps: ActivationStep[]; excludedLegacy: number; period: Period }) {
  return (
    <section className="space-y-3" aria-labelledby="activation-funnel-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h2 id="activation-funnel-title" className="text-lg font-semibold text-slate-950">
          {ACTIVATION_COPY.title}
        </h2>
        <nav aria-label="Period" className="flex flex-wrap gap-3 text-sm">
          {PERIODS.map((value) => (
            <Link
              key={value}
              href={`/admin/clients?period=${value}`}
              aria-current={value === period ? "page" : undefined}
              className={value === period ? "font-semibold text-slate-950" : "text-emerald-700 hover:underline"}
            >
              {ACTIVATION_COPY.periods[value]}
            </Link>
          ))}
        </nav>
      </div>
      <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">{ACTIVATION_COPY.columns.step}</th>
              <th className="px-4 py-3 font-semibold">{ACTIVATION_COPY.columns.accounts}</th>
              <th className="px-4 py-3 font-semibold">{ACTIVATION_COPY.columns.ofSignups}</th>
              <th className="px-4 py-3 font-semibold">{ACTIVATION_COPY.columns.fromBase}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {steps.map((step) => (
              <tr key={step.key}>
                <td className="px-4 py-3 font-medium text-slate-950">{step.label}</td>
                <td className="px-4 py-3">{step.count}</td>
                <td className="px-4 py-3 text-slate-700">{formatPct(step.pctOfSignups)}</td>
                <td className="px-4 py-3 text-slate-700">{stepPercent(step)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {steps.map((step) => (
          <li key={step.key} className="rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-slate-950">{step.label}</span>
              <span className="font-semibold text-slate-950">{step.count}</span>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              {ACTIVATION_COPY.columns.ofSignups}: {formatPct(step.pctOfSignups)}
              {step.key !== "signed_up" ? ` | ${ACTIVATION_COPY.columns.fromBase}: ${stepPercent(step)}` : ""}
            </p>
          </li>
        ))}
      </ul>
      {excludedLegacy > 0 ? <p className="text-xs text-slate-500">{ACTIVATION_COPY.legacyNote(excludedLegacy)}</p> : null}
      <p className="text-xs text-slate-500">{ACTIVATION_COPY.backfillNote}</p>
    </section>
  );
}

function LifecycleCard({ on, status }: { on: boolean; status: LifecycleStatus | null }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">{LIFECYCLE_COPY.title}</h2>
      <p className="mt-2 text-sm text-slate-700">{on ? LIFECYCLE_COPY.on : LIFECYCLE_COPY.off}</p>
      {status ? (
        <ul className="mt-3 space-y-1 text-sm text-slate-700">
          <li>{LIFECYCLE_COPY.pending(status.pending)}</li>
          <li>{LIFECYCLE_COPY.failed(status.failed7d)}</li>
          <li>{status.lastSentAt ? LIFECYCLE_COPY.lastSent(formatOwnerDate(status.lastSentAt)) : LIFECYCLE_COPY.neverSent}</li>
          {status.lastError ? <li className="break-words text-xs text-amber-800">{status.lastError.slice(0, 200)}</li> : null}
        </ul>
      ) : null}
      <form action={sendLifecycleTestAction} className="mt-4">
        <input type="hidden" name="return_to" value="/admin/clients" />
        <Button type="submit" variant="outline" size="sm" disabled={!on} title={on ? undefined : LIFECYCLE_COPY.testOff}>
          {LIFECYCLE_COPY.test}
        </Button>
      </form>
    </section>
  );
}

function StageCell({ row }: { row: ActivationRow | undefined }) {
  if (!row) return <span className="text-slate-400">-</span>;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>{ACTIVATION_COPY.stages[clientStage(row)]}</span>
      {row.everScaling ? (
        <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
          {ACTIVATION_COPY.upgradedPill}
        </span>
      ) : null}
    </span>
  );
}

function reasonLabel(reason: string) {
  return REPORT_REASON_LABELS[reason as ReportReason] ?? reason;
}

function OpenReports({ reports }: { reports: OpenReport[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-950">Open reports ({reports.length})</h2>
      <ul className="space-y-3">
        {reports.map((report) => (
          <li key={report.id} className="rounded-lg border border-red-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-1 text-sm text-slate-700 md:flex-row md:flex-wrap md:items-baseline md:gap-x-4">
              <span className="text-slate-500">{formatOwnerDate(report.created_at)}</span>
              <span className="font-semibold text-slate-950">{report.funnel_name ?? "Unknown form"}</span>
              <a
                href={`/book/${encodeURIComponent(report.funnel_slug)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 break-all text-emerald-700 hover:underline"
              >
                /book/{report.funnel_slug}
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
              <span>
                Client:{" "}
                {report.tenant_id ? (
                  <Link href={`/admin/clients/${report.tenant_id}`} className="text-emerald-700 hover:underline">
                    {report.tenant_name ?? "Unknown"}
                  </Link>
                ) : (
                  "Unknown"
                )}
              </span>
              <span className="font-medium text-red-700">{reasonLabel(report.reason)}</span>
            </div>
            {report.details ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{report.details}</p> : null}
            {report.reporter_email ? (
              <p className="mt-1 break-all text-xs text-slate-500">Reporter: {report.reporter_email}</p>
            ) : null}
            <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end">
              {report.funnel_id ? (
                <form action={takeDownFormAction} className="flex flex-1 flex-col gap-2 md:flex-row md:items-end">
                  <input type="hidden" name="funnel_id" value={report.funnel_id} />
                  <input type="hidden" name="return_to" value="/admin/clients" />
                  <label className="flex-1 text-xs font-medium text-slate-600">
                    Takedown reason
                    <input
                      name="reason"
                      required
                      maxLength={500}
                      defaultValue={defaultTakedownReason(reasonLabel(report.reason))}
                      className={`${ownerInputClass} mt-1`}
                    />
                  </label>
                  <Button type="submit" variant="destructive" size="sm">
                    Take form down
                  </Button>
                </form>
              ) : null}
              <form action={dismissReportAction}>
                <input type="hidden" name="report_id" value={report.id} />
                <input type="hidden" name="return_to" value="/admin/clients" />
                <Button type="submit" variant="outline" size="sm">
                  Dismiss
                </Button>
              </form>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function UsageCell({ used, max, warn }: { used: number; max: number; warn?: boolean }) {
  return (
    <span className={warn ? "font-semibold text-amber-700" : undefined}>
      {used} of {max}
    </span>
  );
}

function ClientsTable({ clients, activation }: { clients: ClientRow[]; activation: Map<string, ActivationRow> }) {
  return (
    <div className="hidden overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:block">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-3 font-semibold">Name</th>
            <th className="px-4 py-3 font-semibold">Email</th>
            <th className="px-4 py-3 font-semibold">Plan</th>
            <th className="px-4 py-3 font-semibold">{ACTIVATION_COPY.stageColumn}</th>
            <th className="px-4 py-3 font-semibold">Active forms</th>
            <th className="px-4 py-3 font-semibold">Drafts</th>
            <th className="px-4 py-3 font-semibold">Leads (30 days)</th>
            <th className="px-4 py-3 font-semibold">Last activity</th>
            <th className="px-4 py-3 font-semibold">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {clients.map((client) => {
            const limits = planLimitsFor(client.plan);
            return (
              <tr key={client.tenantId} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link href={`/admin/clients/${client.tenantId}`} className="font-medium text-slate-950 hover:underline">
                    {client.contactName || client.tenantName}
                  </Link>
                  <p className="text-xs text-slate-500">{client.businessName || client.tenantName}</p>
                  {client.openReports > 0 ? (
                    <p className="text-xs font-medium text-red-700">{client.openReports} open report(s)</p>
                  ) : null}
                </td>
                <td className="break-all px-4 py-3 text-slate-700">{client.ownerEmail ?? client.contactEmail ?? "None"}</td>
                <td className="px-4 py-3">
                  <PlanPill state={client.plan} />
                </td>
                <td className="px-4 py-3">
                  <StageCell row={activation.get(client.tenantId)} />
                </td>
                <td className="px-4 py-3">
                  <UsageCell used={client.activeForms} max={limits.maxActiveForms} warn={isOverActiveLimit(client.plan, client.activeForms)} />
                </td>
                <td className="px-4 py-3">
                  <UsageCell used={client.draftForms} max={limits.maxDraftForms} warn={client.draftForms > limits.maxDraftForms} />
                </td>
                <td className="px-4 py-3">{client.leads30d}</td>
                <td className="px-4 py-3 text-slate-600">{formatOwnerDate(client.lastActivityAt)}</td>
                <td className="px-4 py-3 text-slate-600">{formatOwnerDate(client.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ClientCards({ clients, activation }: { clients: ClientRow[]; activation: Map<string, ActivationRow> }) {
  return (
    <ul className="space-y-3 lg:hidden">
      {clients.map((client) => {
        const limits = planLimitsFor(client.plan);
        return (
          <li key={client.tenantId}>
            <Link
              href={`/admin/clients/${client.tenantId}`}
              className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm hover:border-emerald-300"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-950">{client.contactName || client.tenantName}</p>
                  <p className="text-xs text-slate-500">{client.businessName || client.tenantName}</p>
                  <p className="mt-1 break-all text-xs text-slate-600">{client.ownerEmail ?? client.contactEmail ?? "None"}</p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
                <dt>Plan</dt>
                <dd>
                  <PlanPill state={client.plan} />
                </dd>
                <dt>{ACTIVATION_COPY.stageColumn}</dt>
                <dd>
                  <StageCell row={activation.get(client.tenantId)} />
                </dd>
                <dt>Active forms</dt>
                <dd>
                  <UsageCell used={client.activeForms} max={limits.maxActiveForms} warn={isOverActiveLimit(client.plan, client.activeForms)} />
                </dd>
                <dt>Drafts</dt>
                <dd>
                  <UsageCell used={client.draftForms} max={limits.maxDraftForms} warn={client.draftForms > limits.maxDraftForms} />
                </dd>
                <dt>Leads (30 days)</dt>
                <dd>{client.leads30d}</dd>
                <dt>Last activity</dt>
                <dd>{formatOwnerDate(client.lastActivityAt)}</dd>
                <dt>Created</dt>
                <dd>{formatOwnerDate(client.createdAt)}</dd>
                {client.openReports > 0 ? (
                  <>
                    <dt className="text-red-700">Open reports</dt>
                    <dd className="font-medium text-red-700">{client.openReports}</dd>
                  </>
                ) : null}
              </dl>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
