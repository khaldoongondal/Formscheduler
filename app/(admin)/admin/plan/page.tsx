import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import {
  reactivateFrozenFormAction,
  reactivateFrozenPixelAction,
  swapFrozenFormAction
} from "@/app/(admin)/admin/plan/actions";
import { ActionError, ActionSuccess } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { PlanUsage } from "@/components/admin/plan-usage";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { planLinks } from "@/lib/billing/account-ref";
import {
  FREEZE_COPY,
  canReactivateForm,
  canReactivatePixel,
  isActiveForm,
  isFrozenForm,
  rankRestorableForms,
  type FormActivity,
  type PixelActivity
} from "@/lib/billing/freeze";
import {
  loadFormActivity,
  loadFormSlugs,
  loadPixelActivity,
  readyFrozenFormIds
} from "@/lib/billing/plan-change-service";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import { getTenantPlanSummary } from "@/lib/billing/plan-service";
import { SUSPENDED_MESSAGE } from "@/lib/billing/plans";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { SETUP_CALL_COPY } from "@/lib/onboarding/checklist";
import { getSetupCallUrl } from "@/lib/onboarding/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: PLAN_COPY.pageTitle
};

const SAVED_MESSAGES: Record<string, string> = {
  reactivated: FREEZE_COPY.reactivated,
  swapped: FREEZE_COPY.swapped,
  pixel: FREEZE_COPY.pixelReactivated
};

export default async function PlanPage({
  searchParams
}: {
  searchParams?: Promise<{ saved?: string; error?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for the Plan page."
        description="Your plan and its usage are stored in Supabase. Add the database environment variables before opening this page."
        missingEnv={missingEnv}
      />
    );
  }

  const tenantId = await getAdminTenantId();
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = typeof query.saved === "string" ? SAVED_MESSAGES[query.saved] ?? null : null;

  const [summary, forms, pixels] = await Promise.all([
    getTenantPlanSummary(tenantId),
    loadFormActivity(tenantId),
    loadPixelActivity(tenantId)
  ]);
  const frozenForms = forms.filter(isFrozenForm);
  const frozenPixels = pixels.filter((pixel) => Boolean(pixel.frozenAt));
  const [readyIds, slugs] = await Promise.all([
    readyFrozenFormIds(tenantId, forms),
    loadFormSlugs(
      tenantId,
      frozenForms.map((form) => form.id)
    )
  ]);
  const { upgradeUrl, billingPortalUrl } = planLinks(process.env, summary.accountRef);
  const setupCallUrl = getSetupCallUrl();

  const header = (
    <div>
      <p className="text-sm font-semibold text-emerald-700">{PLAN_COPY.eyebrow}</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{PLAN_COPY.heading}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{PLAN_COPY.intro}</p>
    </div>
  );

  if (summary.state === "suspended") {
    return (
      <div className="space-y-8">
        {header}
        {actionError ? <ActionError message={actionError} /> : null}
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          {SUSPENDED_MESSAGE}
        </p>
      </div>
    );
  }

  const isFree = summary.state === "free";
  const anyFrozen = frozenForms.length > 0 || frozenPixels.length > 0;

  return (
    <div className="space-y-8">
      {header}
      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      <PlanUsage
        state={summary.state}
        plan={summary.plan}
        usage={summary.usage}
        pixelCount={summary.unfrozenPixelCount}
        frozenForms={summary.frozen.forms}
        frozenPixels={summary.frozen.pixels}
      />

      {isFree ? <UpgradeCard upgradeUrl={upgradeUrl} /> : <BillingCard billingPortalUrl={billingPortalUrl} />}

      {setupCallUrl ? (
        <p className="text-sm">
          <a
            href={setupCallUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-emerald-700 hover:underline"
          >
            {SETUP_CALL_COPY.planPageLine}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      ) : null}

      {anyFrozen ? (
        <FrozenSection
          state={summary.state}
          forms={forms}
          frozenForms={frozenForms}
          frozenPixels={frozenPixels}
          unfrozenPixelCount={pixels.length - frozenPixels.length}
          readyIds={readyIds}
          slugs={slugs}
          upgradeUrl={isFree ? upgradeUrl : null}
          billingPortalUrl={billingPortalUrl}
        />
      ) : null}
    </div>
  );
}

function UpgradeButton({ href }: { href: string }) {
  return (
    <Button asChild>
      <a href={href} target="_blank" rel="noopener noreferrer">
        {PLAN_COPY.upgradeButton}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </Button>
  );
}

function ManageBillingButton({ href }: { href: string }) {
  return (
    <Button asChild variant="outline">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {PLAN_COPY.manageBilling}
        <ExternalLink className="h-4 w-4" aria-hidden="true" />
      </a>
    </Button>
  );
}

function EmailLine({ lead }: { lead: string }) {
  return (
    <p className="text-sm leading-6 text-slate-700">
      {lead}{" "}
      <a href={`mailto:${PLAN_COPY.contactEmail}`} className="font-semibold text-emerald-700 hover:underline">
        {PLAN_COPY.contactEmail}
      </a>
      .
    </p>
  );
}

function UpgradeCard({ upgradeUrl }: { upgradeUrl: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{PLAN_COPY.upgradeTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-slate-700">{PLAN_COPY.upgradePrice}</p>
        <div>
          <h2 className="text-sm font-semibold text-slate-950">{PLAN_COPY.addsHeading}</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
            {PLAN_COPY.addsItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        {upgradeUrl ? (
          <div className="space-y-2">
            <UpgradeButton href={upgradeUrl} />
            <p className="max-w-2xl text-sm leading-6 text-slate-600">{PLAN_COPY.upgradeNote}</p>
          </div>
        ) : (
          <EmailLine lead={PLAN_COPY.upgradeByEmail} />
        )}
      </CardContent>
    </Card>
  );
}

function BillingCard({ billingPortalUrl }: { billingPortalUrl: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{PLAN_COPY.billingTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm leading-6 text-slate-700">{PLAN_COPY.onScaling}</p>
        {billingPortalUrl ? (
          <div className="space-y-2">
            <ManageBillingButton href={billingPortalUrl} />
            <p className="text-sm leading-6 text-slate-600">{PLAN_COPY.manageBillingNote}</p>
          </div>
        ) : (
          <EmailLine lead={PLAN_COPY.billingByEmail} />
        )}
        <p className="max-w-2xl text-sm leading-6 text-slate-600">{PLAN_COPY.downgradeNote}</p>
      </CardContent>
    </Card>
  );
}

function FrozenBadge() {
  return (
    <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700" title={FREEZE_COPY.badgeTitle}>
      {FREEZE_COPY.badge}
    </span>
  );
}

function FrozenSection({
  state,
  forms,
  frozenForms,
  frozenPixels,
  unfrozenPixelCount,
  readyIds,
  slugs,
  upgradeUrl,
  billingPortalUrl
}: {
  state: "free" | "scaling";
  forms: FormActivity[];
  frozenForms: FormActivity[];
  frozenPixels: PixelActivity[];
  unfrozenPixelCount: number;
  readyIds: Set<string>;
  slugs: Map<string, string>;
  upgradeUrl: string | null;
  billingPortalUrl: string | null;
}) {
  const activeForms = forms.filter(isActiveForm);
  const formSlot = canReactivateForm(state, activeForms.length).allowed;
  const pixelSlot = canReactivatePixel(state, unfrozenPixelCount).allowed;
  // Ready forms in restore order first, then the ones that need setup.
  const readyOrder = rankRestorableForms(frozenForms, readyIds);
  const byId = new Map(frozenForms.map((form) => [form.id, form]));
  const ordered = [
    ...readyOrder.map((id) => byId.get(id)).filter((form): form is FormActivity => Boolean(form)),
    ...frozenForms.filter((form) => !readyOrder.includes(form.id))
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{PLAN_COPY.frozenHeading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm leading-6 text-slate-600">{PLAN_COPY.frozenIntro}</p>

        {ordered.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {ordered.map((form) => {
              const slug = slugs.get(form.id);
              const ready = readyIds.has(form.id) && !form.takenDownAt;
              return (
                <li key={form.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{form.name}</p>
                      <FrozenBadge />
                    </div>
                    {slug ? <p className="break-all text-sm text-slate-600">/{slug}</p> : null}
                  </div>
                  <div className="shrink-0">
                    {!ready ? (
                      <p className="text-sm text-amber-900">
                        {FREEZE_COPY.needsSetup}{" "}
                        <Link href={`/admin/funnels/${form.id}`} className="font-semibold text-emerald-700 hover:underline">
                          {PLAN_COPY.openForm}
                        </Link>
                      </p>
                    ) : formSlot ? (
                      <form action={reactivateFrozenFormAction}>
                        <input type="hidden" name="funnel_id" value={form.id} />
                        <Button type="submit" size="sm">
                          {FREEZE_COPY.reactivate}
                        </Button>
                      </form>
                    ) : activeForms.length > 0 ? (
                      <form action={swapFrozenFormAction} className="space-y-2">
                        <input type="hidden" name="restore_id" value={form.id} />
                        <label htmlFor={`swap-${form.id}`} className="block text-sm font-medium text-slate-800">
                          {FREEZE_COPY.swapLabel}
                        </label>
                        <div className="flex flex-wrap items-center gap-2">
                          <select
                            id={`swap-${form.id}`}
                            name="freeze_id"
                            required
                            className="h-9 max-w-full rounded-md border border-input bg-background px-3 text-sm"
                          >
                            {activeForms.map((active) => (
                              <option key={active.id} value={active.id}>
                                {active.name}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" size="sm" variant="outline">
                            {FREEZE_COPY.swap}
                          </Button>
                        </div>
                        <p className="text-xs leading-5 text-slate-600">{FREEZE_COPY.swapHelp}</p>
                      </form>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        {frozenPixels.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {frozenPixels.map((pixel) => (
              <li key={pixel.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="font-semibold text-slate-950">{pixel.name}</p>
                  <FrozenBadge />
                </div>
                {pixelSlot ? (
                  <form action={reactivateFrozenPixelAction} className="shrink-0">
                    <input type="hidden" name="pixel_id" value={pixel.id} />
                    <Button type="submit" size="sm">
                      {FREEZE_COPY.reactivate}
                    </Button>
                  </form>
                ) : (
                  <p className="text-sm text-slate-600">{FREEZE_COPY.pixelNoSlot}</p>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        {upgradeUrl || billingPortalUrl ? (
          <div className="flex flex-wrap items-center gap-3">
            {upgradeUrl ? <UpgradeButton href={upgradeUrl} /> : null}
            {billingPortalUrl ? <ManageBillingButton href={billingPortalUrl} /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
