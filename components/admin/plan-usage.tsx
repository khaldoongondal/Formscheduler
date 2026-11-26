import {
  CONTACT_EMAIL,
  SUSPENDED_MESSAGE,
  formatPlanPrice,
  type FormUsage,
  type PlanDefinition,
  type PlanState
} from "@/lib/billing/plans";

export function PlanUsage({
  state,
  plan,
  usage
}: {
  state: PlanState;
  plan: PlanDefinition | null;
  usage: FormUsage;
}) {
  if (state === "suspended" || !plan) {
    return (
      <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
        <p className="font-semibold">Account suspended</p>
        <p>{SUSPENDED_MESSAGE}</p>
      </section>
    );
  }

  const activeFull = usage.activeForms >= plan.maxActiveForms;
  const draftsFull = usage.draftForms >= plan.maxDraftForms;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-950">{plan.name} plan</h2>
        <p className="text-sm font-medium text-slate-600">{formatPlanPrice(plan)}</p>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <UsageMeter label="Active forms" used={usage.activeForms} max={plan.maxActiveForms} />
        <UsageMeter label="Drafts" used={usage.draftForms} max={plan.maxDraftForms} />
      </div>
      {activeFull || draftsFull ? (
        <div className="mt-4 space-y-1 text-sm leading-6 text-amber-900">
          {activeFull ? (
            <p>
              You are using all {plan.maxActiveForms} active forms. Switch a form to draft to activate another.
              {plan.id === "free" ? ` Need more? Email ${CONTACT_EMAIL} about the Scaling plan.` : null}
            </p>
          ) : null}
          {draftsFull ? (
            <p>You are using all {plan.maxDraftForms} drafts. Delete a draft to create a new form.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function UsageMeter({ label, used, max }: { label: string; used: number; max: number }) {
  const percent = max > 0 ? Math.min(100, Math.round((used / max) * 100)) : 100;
  const full = used >= max;
  return (
    <div>
      <p className="text-sm text-slate-700">
        {label}: <span className="font-semibold text-slate-950">{used}</span> of {max}
      </p>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div
          className={full ? "h-full rounded-full bg-amber-500" : "h-full rounded-full bg-emerald-500"}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
