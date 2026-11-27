import Link from "next/link";
import { ArrowRight, CheckCircle2, ExternalLink, Plus } from "lucide-react";
import { createFunnelAction } from "@/app/(admin)/admin/funnels/actions";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getTenantPlanSummary } from "@/lib/billing/plan-service";
import { SUSPENDED_MESSAGE, draftLimitMessage } from "@/lib/billing/plans";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listFunnels } from "@/lib/funnels/service";
import { listConnections, type ConnectionSummary } from "@/lib/connections/service";
import { SETUP_COPY, formSetupError } from "@/lib/connections/setup-state";
import { listGhlConnections } from "@/lib/ghl/connections";
import { getRunningTestsByFunnel } from "@/lib/split-tests/service";
import { FREEZE_COPY } from "@/lib/billing/freeze";
import { getOnboardingState } from "@/lib/onboarding/service";
import { PlanUsage } from "@/components/admin/plan-usage";
import { SetupCallCard } from "@/components/admin/setup-call-card";
import { SetupChecklist } from "@/components/admin/setup-checklist";
import { TemplatePicker } from "@/components/admin/template-picker";
import { UpgradeHint } from "@/components/admin/upgrade-hint";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const dynamic = "force-dynamic";

export default async function FunnelsPage({
  searchParams
}: {
  searchParams?: Promise<{ create?: string; error?: string; saved?: string; template?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for the admin dashboard."
        description="The admin dashboard reads tenant membership, funnels, connections, and analytics from Supabase. The static homepage can load without these values, but admin pages cannot."
        missingEnv={missingEnv}
      />
    );
  }

  const tenantId = await getAdminTenantId();
  const [funnels, planSummary, runningTests, ghlConnections, connections, onboarding] = await Promise.all([
    listFunnels(tenantId),
    getTenantPlanSummary(tenantId),
    getRunningTestsByFunnel(tenantId),
    // The two lists feed the "Needs setup" badges only; no provider is called.
    listGhlConnections(tenantId).catch((): Array<{ id: string; calendar_id: string | null; is_active: boolean }> | null => null),
    // Empty before migration 0029.
    listConnections(tenantId).catch((): ConnectionSummary[] => []),
    // Never throws: every read inside degrades to "not done".
    getOnboardingState(tenantId)
  ]);
  const needsSetup = (funnel: (typeof funnels)[number]) =>
    ghlConnections ? formSetupError(funnel, ghlConnections, connections) !== null : false;
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = query.saved === "deleted" ? "Funnel deleted." : null;
  const showCreateForm = query.create === "1" || funnels.length === 0;
  const isSuspended = planSummary.state === "suspended" || !planSummary.plan;
  const draftsFull = planSummary.plan ? planSummary.usage.draftForms >= planSummary.plan.maxDraftForms : false;
  const createBlockedMessage = isSuspended
    ? SUSPENDED_MESSAGE
    : draftsFull && planSummary.plan
      ? draftLimitMessage(planSummary.plan)
      : null;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Funnels</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Booking funnels</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Choose a funnel to manage its questions, calendar and CRM, theme, booking links, and performance.
          </p>
        </div>
        {isSuspended ? null : draftsFull ? (
          <Button type="button" variant="outline" disabled>
            <Plus className="h-4 w-4" />
            New funnel
          </Button>
        ) : (
          <Button asChild variant="outline">
            <Link href="/admin/funnels?create=1#create-funnel">
              <Plus className="h-4 w-4" />
              New funnel
            </Link>
          </Button>
        )}
      </div>

      <SetupChecklist state={onboarding} returnTo="/admin/funnels" />
      <SetupCallCard moment={onboarding.setupCall.moment} url={onboarding.setupCall.url} returnTo="/admin/funnels" />

      <PlanUsage
        state={planSummary.state}
        plan={planSummary.plan}
        usage={planSummary.usage}
        pixelCount={planSummary.unfrozenPixelCount}
        frozenForms={planSummary.frozen.forms}
        frozenPixels={planSummary.frozen.pixels}
      />

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      {showCreateForm ? (
        <CreateFunnelCard
          canCancel={funnels.length > 0}
          blockedMessage={createBlockedMessage}
          template={typeof query.template === "string" ? query.template : null}
        />
      ) : null}

      <section className="grid gap-4">
        {funnels.map((funnel) => (
          <article
            key={funnel.id}
            className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300 hover:shadow-md"
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-slate-950">{funnel.name}</h2>
                  {!funnel.is_published && funnel.frozen_at ? <FrozenBadge /> : <StatusBadge published={funnel.is_published} />}
                  {funnel.taken_down_at ? <TakenDownBadge /> : null}
                  {runningTests.has(funnel.id) ? <SplitTestBadge /> : null}
                  {needsSetup(funnel) ? <NeedsSetupBadge /> : null}
                </div>
                <p className="mt-1 text-sm text-slate-500">/{funnel.slug}</p>
                {funnel.description ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">{funnel.description}</p>
                ) : null}
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {funnel.is_published ? (
                  <Button asChild variant="ghost" size="sm">
                    <Link href={`/book/${funnel.slug}`} target="_blank">
                      <ExternalLink className="h-4 w-4" />
                      Preview
                    </Link>
                  </Button>
                ) : null}
                <Button asChild size="sm">
                  <Link href={`/admin/funnels/${funnel.id}`}>
                    Manage
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </article>
        ))}

        {funnels.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <h2 className="text-lg font-semibold text-slate-950">No funnels yet</h2>
              <p className="mt-2 text-sm text-slate-600">Create your first booking funnel, then choose its calendar and CRM.</p>
            </CardContent>
          </Card>
        ) : null}
      </section>
    </div>
  );
}

function CreateFunnelCard({
  canCancel,
  blockedMessage,
  template
}: {
  canCancel: boolean;
  blockedMessage: string | null;
  template: string | null;
}) {
  return (
    <Card id="create-funnel" className="max-w-3xl scroll-mt-24">
        <CardHeader>
          <CardTitle>Create funnel</CardTitle>
          <CardDescription>Start with the essentials. Theme, calendar and CRM, questions, and analytics live inside the funnel workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          {blockedMessage ? (
            <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
              <p>{blockedMessage}</p>
              <UpgradeHint message={blockedMessage} />
            </div>
          ) : null}
          <form action={createFunnelAction} className="space-y-5">
            <TemplatePicker selected={template} />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Public title</Label>
                <Input id="name" name="name" required placeholder="Growth Strategy Consultation" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">URL slug</Label>
                <Input id="slug" name="slug" required placeholder="growth-strategy-call" />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Top-left description</Label>
              <Textarea
                id="description"
                name="description"
                placeholder="Book your 20-min discovery meeting today."
              />
              <p className="text-xs leading-5 text-slate-500">Leave this empty to use the template&apos;s description.</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={Boolean(blockedMessage)}>
                <Plus className="h-4 w-4" />
                Create draft funnel
              </Button>
              {canCancel ? (
                <Button asChild type="button" variant="ghost">
                  <Link href="/admin/funnels">Cancel</Link>
                </Button>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>
  );
}

function ActionError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
      <p className="font-semibold">This setting was not saved.</p>
      <p>{message}</p>
      <UpgradeHint message={message} />
    </div>
  );
}

function FrozenBadge() {
  return (
    <span className="rounded-md bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700" title={FREEZE_COPY.badgeTitle}>
      {FREEZE_COPY.badge}
    </span>
  );
}

function ActionSuccess({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

function StatusBadge({ published }: { published: boolean }) {
  return (
    <span
      className={
        published
          ? "rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700"
          : "rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600"
      }
    >
      {published ? "Active" : "Draft"}
    </span>
  );
}

function SplitTestBadge() {
  return <span className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-700">In split test</span>;
}

function NeedsSetupBadge() {
  return <span className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">{SETUP_COPY.needsSetup}</span>;
}

function TakenDownBadge() {
  return <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">Taken down</span>;
}
