import Link from "next/link";
import { FREEZE_COPY } from "@/lib/billing/freeze";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import {
  SUSPENDED_MESSAGE,
  formatPlanPrice,
  type FormUsage,
  type PlanDefinition,
  type PlanState
} from "@/lib/billing/plans";

export function PlanUsage({
  state,
  plan,
  usage,
  pixelCount = null,
  frozenForms = 0,
  frozenPixels = 0
}: {
  state: PlanState;
  plan: PlanDefinition | null;
  usage: FormUsage;
  /** Meta pixels counted against the limit (not frozen); the meter is hidden when null (table not there yet). */
  pixelCount?: number | null;
  frozenForms?: number;
  frozenPixels?: number;
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
  const anyFrozen = frozenForms > 0 || frozenPixels > 0;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-950">{plan.name} plan</h2>
        <p className="text-sm font-medium text-slate-600">{formatPlanPrice(plan)}</p>
      </div>
      <div className={pixelCount === null ? "mt-4 grid gap-4 md:grid-cols-2" : "mt-4 grid gap-4 md:grid-cols-3"}>
        <UsageMeter label="Active forms" used={usage.activeForms} max={plan.maxActiveForms} />
        <UsageMeter label="Drafts" used={usage.draftForms} max={plan.maxDraftForms} />
        {pixelCount === null ? null : <UsageMeter label="Meta pixels" used={pixelCount} max={plan.maxPixels} />}
      </div>
      {activeFull || draftsFull || anyFrozen ? (
        <div className="mt-4 space-y-1 text-sm leading-6 text-amber-900">
          {activeFull ? (
            <p>
              {PLAN_COPY.usageActiveFull(plan.maxActiveForms)}
              {plan.id === "free" ? (
                <>
                  {" "}
                  <Link href="/admin/plan" className="font-semibold text-emerald-700 hover:underline">
                    {PLAN_COPY.usageNeedMore}
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}
          {draftsFull ? <p>{PLAN_COPY.usageDraftsFull(plan.maxDraftForms)}</p> : null}
          {anyFrozen ? (
            <p>
              {FREEZE_COPY.listBanner(frozenForms, frozenPixels)}{" "}
              <Link href="/admin/plan" className="font-semibold text-emerald-700 hover:underline">
                {FREEZE_COPY.listBannerLink}
              </Link>
            </p>
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
