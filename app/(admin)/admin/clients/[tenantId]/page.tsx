import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import {
  restoreClientAction,
  restoreFormAction,
  setClientBadgeAction,
  setClientPlanAction,
  suspendClientAction,
  takeDownFormAction
} from "@/app/(admin)/admin/clients/actions";
import { OwnerNotices, PlanPill, ownerInputClass } from "@/app/(admin)/admin/clients/notices";
import { requirePlatformOwner } from "@/lib/auth/owner-server";
import { PLANS, PLAN_IDS, formatPlanPrice, shouldShowBadge } from "@/lib/billing/plans";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { clientFormStatus, formatOwnerDate, planDowngradeWarning } from "@/lib/owner/format";
import { getClientDetail } from "@/lib/owner/service";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export const metadata = { title: "Client | FormBook", robots: { index: false } };

const SIGNUP_SOURCE_LABELS: Record<string, string> = {
  legacy: "Before self-serve signup",
  provisioned: "Provisioned from GoHighLevel",
  self_serve: "Self-serve signup"
};

function safeWebsiteHref(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function ClientDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ tenantId: string }>;
  searchParams?: Promise<{ saved?: string; error?: string }>;
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

  const { tenantId } = await params;
  const detail = await getClientDetail(tenantId);
  if (!detail) notFound();

  const { client, tenant, forms } = detail;
  const query = searchParams ? await searchParams : {};
  const returnTo = `/admin/clients/${client.tenantId}`;
  const isSuspended = client.plan === "suspended";
  const currentPlanId = isSuspended ? (tenant.plan_before_suspension ?? "free") : client.plan === "scaling" ? "scaling" : "free";
  const planWarnings = PLAN_IDS.map((id) => planDowngradeWarning(id, client.activeForms)).filter(
    (warning): warning is string => Boolean(warning)
  );
  const websiteHref = safeWebsiteHref(tenant.website);
  const badgeVisible = shouldShowBadge(client.plan, client.badgeEnabled);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin/clients" className="inline-flex items-center gap-1 text-sm text-slate-600 hover:text-slate-950">
          <ArrowLeft className="h-4 w-4" />
          Client Management
        </Link>
        <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight text-slate-950">
          {client.businessName || client.tenantName}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <PlanPill state={client.plan} />
          <span>
            {client.activeForms} active, {client.draftForms} drafts, {client.leads30d} leads in the last 30 days
          </span>
        </div>
      </div>

      <OwnerNotices
        saved={typeof query.saved === "string" ? query.saved : undefined}
        error={typeof query.error === "string" ? query.error : undefined}
      />

      <Section title="Profile">
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <ProfileItem label="Business name" value={tenant.business_name || tenant.name} />
          <ProfileItem label="Contact name" value={tenant.contact_name} />
          <ProfileItem label="Owner email" value={client.ownerEmail ?? tenant.contact_email} />
          <ProfileItem label="Phone" value={tenant.contact_phone} />
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Website</dt>
            <dd className="mt-0.5 break-all text-slate-900">
              {websiteHref ? (
                <a href={websiteHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                  {tenant.website}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                </a>
              ) : (
                tenant.website || "None"
              )}
            </dd>
          </div>
          <ProfileItem label="Signup source" value={SIGNUP_SOURCE_LABELS[tenant.signup_source] ?? tenant.signup_source} />
          <ProfileItem label="Created" value={formatOwnerDate(tenant.created_at)} />
          <ProfileItem label="Last activity" value={formatOwnerDate(client.lastActivityAt)} />
        </dl>
      </Section>

      <Section title="Plan">
        <form action={setClientPlanAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="tenant_id" value={client.tenantId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <label className="flex-1 text-sm font-medium text-slate-700">
            Plan
            <select name="plan" defaultValue={currentPlanId} className={`${ownerInputClass} mt-1`}>
              {PLAN_IDS.map((id) => (
                <option key={id} value={id}>
                  {PLANS[id].name} ({id === "free" ? "free" : formatPlanPrice(PLANS[id])})
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Save plan</Button>
        </form>
        {isSuspended ? (
          <p className="mt-3 text-sm text-slate-600">Saving a plan also restores this suspended account.</p>
        ) : null}
        {planWarnings.map((warning) => (
          <p key={warning} className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {warning}
          </p>
        ))}
      </Section>

      <Section title={'Show "Powered by FormBook" badge'}>
        <p className="text-sm text-slate-600">Only applies to the Bootstrapping plan. Scaling forms never show the badge.</p>
        <p className="mt-2 text-sm text-slate-900">
          Badge switch: <span className="font-semibold">{client.badgeEnabled ? "On" : "Off"}</span>. Public forms{" "}
          {badgeVisible ? "show" : "do not show"} the badge right now.
        </p>
        <form action={setClientBadgeAction} className="mt-3">
          <input type="hidden" name="tenant_id" value={client.tenantId} />
          <input type="hidden" name="return_to" value={returnTo} />
          <input type="hidden" name="badge" value={client.badgeEnabled ? "off" : "on"} />
          <Button type="submit" variant="outline">
            {client.badgeEnabled ? "Turn badge off" : "Turn badge on"}
          </Button>
        </form>
      </Section>

      <Section title="Suspension">
        {isSuspended ? (
          <div className="space-y-3 text-sm">
            <p className="text-slate-700">
              Suspended on {formatOwnerDate(tenant.suspended_at)}.
              {tenant.suspension_reason ? ` Reason: ${tenant.suspension_reason}` : " No reason was recorded."}
            </p>
            <form action={restoreClientAction}>
              <input type="hidden" name="tenant_id" value={client.tenantId} />
              <input type="hidden" name="return_to" value={returnTo} />
              <Button type="submit">Restore account</Button>
            </form>
            <p className="text-xs text-slate-500">
              Restores the previous plan ({PLANS[tenant.plan_before_suspension ?? "free"].name}).
            </p>
          </div>
        ) : (
          <form action={suspendClientAction} className="space-y-3">
            <input type="hidden" name="tenant_id" value={client.tenantId} />
            <input type="hidden" name="return_to" value={returnTo} />
            <p className="text-sm text-slate-600">
              Suspended accounts cannot create or activate forms, and their public forms stop loading.
            </p>
            <label className="block text-sm font-medium text-slate-700">
              Reason (optional)
              <input name="reason" maxLength={500} className={`${ownerInputClass} mt-1`} />
            </label>
            <Button type="submit" variant="destructive">
              Suspend account
            </Button>
          </form>
        )}
      </Section>

      <Section title={`Forms (${forms.length})`}>
        {forms.length === 0 ? (
          <p className="text-sm text-slate-600">This client has no forms yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {forms.map((form) => {
              const status = clientFormStatus(form);
              return (
                <li key={form.id} className="flex flex-col gap-3 py-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-950">{form.name}</p>
                    <a
                      href={`/book/${encodeURIComponent(form.slug)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="break-all text-xs text-emerald-700 hover:underline"
                    >
                      /book/{form.slug}
                    </a>
                    <p className="mt-1 text-xs text-slate-500">
                      <FormStatusBadge status={status} /> Last updated {formatOwnerDate(form.updated_at)}
                    </p>
                    {form.taken_down_reason ? (
                      <p className="mt-1 text-xs text-red-700">Takedown reason: {form.taken_down_reason}</p>
                    ) : null}
                  </div>
                  {form.taken_down_at ? (
                    <form action={restoreFormAction}>
                      <input type="hidden" name="funnel_id" value={form.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <Button type="submit" variant="outline" size="sm">
                        Restore
                      </Button>
                    </form>
                  ) : (
                    <form action={takeDownFormAction} className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-end">
                      <input type="hidden" name="funnel_id" value={form.id} />
                      <input type="hidden" name="return_to" value={returnTo} />
                      <label className="text-xs font-medium text-slate-600">
                        Reason
                        <input name="reason" required maxLength={500} className={`${ownerInputClass} mt-1 md:w-64`} />
                      </label>
                      <Button type="submit" variant="destructive" size="sm">
                        Take down
                      </Button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-slate-950">{title}</h2>
      {children}
    </section>
  );
}

function ProfileItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-900">{value || "None"}</dd>
    </div>
  );
}

function FormStatusBadge({ status }: { status: ReturnType<typeof clientFormStatus> }) {
  const tone =
    status === "Taken down"
      ? "bg-red-100 text-red-800"
      : status === "Active"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-100 text-slate-700";
  return <span className={`mr-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{status}</span>;
}
