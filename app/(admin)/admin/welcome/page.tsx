import type { Metadata } from "next";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getTenantPlanSummary } from "@/lib/billing/plan-service";
import { PLANS } from "@/lib/billing/plans";
import { getOnboardingState } from "@/lib/onboarding/service";
import { SetupCallCard } from "@/components/admin/setup-call-card";
import { SetupChecklist } from "@/components/admin/setup-checklist";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Welcome"
};

export default async function WelcomePage() {
  const tenantId = await getAdminTenantId();
  const [summary, onboarding] = await Promise.all([getTenantPlanSummary(tenantId), getOnboardingState(tenantId)]);

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

      <SetupCallCard moment={onboarding.setupCall.moment} url={onboarding.setupCall.url} returnTo="/admin/welcome" />
      <SetupChecklist state={onboarding} returnTo="/admin/welcome" />
    </div>
  );
}
