import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, CalendarCheck, CheckCircle2 } from "lucide-react";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getTenantPlanSummary } from "@/lib/billing/plan-service";
import { PLANS } from "@/lib/billing/plans";
import { listConnections, type ConnectionSummary } from "@/lib/connections/service";
import { SETUP_COPY, welcomeSetupState } from "@/lib/connections/setup-state";
import { listGhlConnections } from "@/lib/ghl/connections";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Welcome | FormBook"
};

function getSetupCallUrl(): string | null {
  const raw = process.env.FORMBOOK_SETUP_CALL_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export default async function WelcomePage() {
  const tenantId = await getAdminTenantId();
  const [summary, ghlConnections, connections] = await Promise.all([
    getTenantPlanSummary(tenantId),
    listGhlConnections(tenantId).catch((): Array<{ is_active: boolean }> => []),
    // Empty before migration 0029.
    listConnections(tenantId).catch((): ConnectionSummary[] => [])
  ]);
  const setup = welcomeSetupState(ghlConnections, connections);
  const setupCallUrl = getSetupCallUrl();

  // New self-serve accounts start on Bootstrapping; show the real plan for anyone else.
  const plan = summary.plan ?? PLANS.free;
  const planLine =
    summary.state === "suspended"
      ? null
      : summary.state === "free"
        ? `Your account is ready on the free ${plan.name} plan: ${plan.maxActiveForms} active forms and up to ${plan.maxDraftForms} drafts.`
        : `Your account is ready on the ${plan.name} plan: ${plan.maxActiveForms} active forms and up to ${plan.maxDraftForms} drafts.`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Welcome to FormBook</h1>
        {planLine ? <p className="text-slate-600">{planLine}</p> : null}
      </div>

      {setupCallUrl ? (
        <Card>
          <CardHeader>
            <div className="mb-1 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CalendarCheck className="h-5 w-5" />
            </div>
            <CardTitle>Book your free setup call</CardTitle>
            <CardDescription>
              A free call with the founder of Gondal Tech. We set up your first form with you and talk through your
              booking funnel.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <a href={setupCallUrl} target="_blank" rel="noopener noreferrer">
                Book a setup call
              </a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <ol className="space-y-4">
        <SetupStep
          number={1}
          title={SETUP_COPY.calendarStepTitle}
          body={SETUP_COPY.calendarStepBody}
          done={setup.calendarDone}
          action={
            <Button asChild variant={setup.calendarDone ? "outline" : "default"}>
              <Link href="/admin/connections#calendars">{SETUP_COPY.calendarStepButton}</Link>
            </Button>
          }
        />
        <SetupStep
          number={2}
          title={SETUP_COPY.crmStepTitle}
          body={SETUP_COPY.crmStepBody}
          done={setup.crmDone}
          action={
            <Button asChild variant={setup.crmDone ? "outline" : "default"}>
              <Link href="/admin/connections#crms">{SETUP_COPY.crmStepButton}</Link>
            </Button>
          }
        />
        <SetupStep
          number={3}
          title={SETUP_COPY.formStepTitle}
          body={SETUP_COPY.formStepNote}
          done={false}
          action={
            <Button asChild>
              <Link href="/admin/funnels?create=1#create-funnel">
                {SETUP_COPY.formStepButton}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          }
        />
      </ol>
    </div>
  );
}

function SetupStep({
  number,
  title,
  body,
  done,
  action
}: {
  number: number;
  title: string;
  body: string;
  done: boolean;
  action: ReactNode;
}) {
  return (
    <li>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
              {number}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-semibold text-slate-950">{title}</h2>
                {done ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {SETUP_COPY.done}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-slate-600">{body}</p>
            </div>
          </div>
          <div className="shrink-0">{action}</div>
        </CardContent>
      </Card>
    </li>
  );
}
