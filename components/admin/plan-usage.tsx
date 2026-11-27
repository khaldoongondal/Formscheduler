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
    <section className="workspace-plan">
      <div className="workspace-plan-heading">
        <h2>{plan.name} plan</h2>
        <p>{formatPlanPrice(plan)}</p>
      </div>
      <div className="workspace-meters">
        <UsageMeter label="Active forms" used={usage.activeForms} max={plan.maxActiveForms} />
        <UsageMeter label="Drafts" used={usage.draftForms} max={plan.maxDraftForms} />
        {pixelCount === null ? null : <UsageMeter label="Meta pixels" used={pixelCount} max={plan.maxPixels} />}
      </div>
      {activeFull || draftsFull || anyFrozen ? (
        <div className="workspace-plan-notes mt-4 space-y-1 text-sm leading-6">
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
      <p className="workspace-meter-label">
        <span>{label}</span><span><b>{used}</b> of {max}</span>
      </p>
      <div
        className="workspace-meter-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={used}
      >
        <div
          className={full ? "workspace-meter-fill is-full" : "workspace-meter-fill"}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
