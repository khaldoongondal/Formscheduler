import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarCheck, PlugZap } from "lucide-react";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getTenantPlanSummary } from "@/lib/billing/plan-service";
import { PLANS } from "@/lib/billing/plans";
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
  const summary = await getTenantPlanSummary(tenantId);
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

      <div className="flex flex-wrap items-center gap-4">
        <Button asChild>
          <Link href="/admin/funnels?create=1#create-funnel">
            Create your first form
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
        <Link
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 underline underline-offset-2 hover:text-slate-950"
          href="/admin/ghl-connections"
        >
          <PlugZap className="h-4 w-4 text-primary" />
          Connect GoHighLevel
        </Link>
      </div>
    </div>
  );
}
