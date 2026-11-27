import Link from "next/link";
import { CheckCircle2, ExternalLink } from "lucide-react";
import { hideChecklistAction, showChecklistAction } from "@/app/(admin)/admin/onboarding-actions";
import { CHECKLIST_COPY, type ChecklistStep } from "@/lib/onboarding/checklist";
import type { OnboardingState } from "@/lib/onboarding/service";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type ReturnPath = "/admin/funnels" | "/admin/welcome";

/** Setup checklist (decision D16). Server component; every button works without JavaScript. */
export function SetupChecklist({ state, returnTo }: { state: OnboardingState; returnTo: ReturnPath }) {
  const { checklist, hidden, setupCall } = state;

  if (hidden) {
    if (returnTo !== "/admin/welcome") return null;
    return (
      <form action={showChecklistAction}>
        <input type="hidden" name="return_to" value={returnTo} />
        <Button type="submit" variant="link" className="h-auto px-0">
          {CHECKLIST_COPY.showAgain}
        </Button>
      </form>
    );
  }

  const required = checklist.steps.filter((step) => !step.optional);
  const optional = checklist.steps.filter((step) => step.optional);
  const footer = (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
      <form action={hideChecklistAction}>
        <input type="hidden" name="return_to" value={returnTo} />
        <Button type="submit" variant="ghost" size="sm">
          {CHECKLIST_COPY.hide}
        </Button>
      </form>
      {setupCall.url ? (
        <a
          href={setupCall.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:underline"
        >
          {CHECKLIST_COPY.callLink}
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );

  if (checklist.complete) {
    return (
      <Card className="border-emerald-200 bg-emerald-50/60">
        <CardContent className="space-y-4 p-5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" aria-hidden="true" />
            <div>
              <h2 className="font-semibold text-slate-950">{CHECKLIST_COPY.completeTitle}</h2>
              <p className="mt-1 text-sm text-slate-600">{CHECKLIST_COPY.completeBody}</p>
            </div>
          </div>
          <OptionalSteps steps={optional} />
          {footer}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card aria-labelledby="setup-checklist-title">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle id="setup-checklist-title">{CHECKLIST_COPY.title}</CardTitle>
          <p className="text-sm font-medium text-slate-600">
            {CHECKLIST_COPY.progress(checklist.requiredDone, checklist.requiredTotal)}
          </p>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <ol className="space-y-3">
          {required.map((step, index) => (
            <StepRow key={step.key} step={step} number={index + 1} primary={step.key === checklist.nextKey} />
          ))}
        </ol>
        <OptionalSteps steps={optional} />
        {footer}
      </CardContent>
    </Card>
  );
}

function OptionalSteps({ steps }: { steps: ChecklistStep[] }) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{CHECKLIST_COPY.optionalHeading}</h3>
      <ul className="space-y-3">
        {steps.map((step) => (
          <StepRow key={step.key} step={step} number={null} primary={false} />
        ))}
      </ul>
    </div>
  );
}

function StepRow({ step, number, primary }: { step: ChecklistStep; number: number | null; primary: boolean }) {
  return (
    <li className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <span
          className={
            step.done
              ? "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700"
              : "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          }
          aria-hidden="true"
        >
          {step.done ? <CheckCircle2 className="h-4 w-4" /> : number ?? "+"}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-950">{step.title}</p>
            {step.done ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                {CHECKLIST_COPY.done}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">{step.body}</p>
        </div>
      </div>
      <div className="shrink-0">
        <Button asChild size="sm" variant={primary ? "default" : "outline"}>
          <Link href={step.href}>{step.cta}</Link>
        </Button>
      </div>
    </li>
  );
}
