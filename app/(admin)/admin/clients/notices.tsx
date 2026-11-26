import { CheckCircle2 } from "lucide-react";
import type { PlanState } from "@/lib/billing/plans";
import { planStateLabel } from "@/lib/owner/format";

const SAVED_MESSAGES: Record<string, string> = {
  plan: "Plan saved.",
  badge: "Badge setting saved.",
  suspended: "Account suspended.",
  restored: "Account restored.",
  "form-taken-down": "Form taken down.",
  "form-restored": "Form restored as a draft. The client can activate it again.",
  "report-dismissed": "Report dismissed."
};

/** Success or error line for the owner pages, from ?saved= or ?error=. */
export function OwnerNotices({ saved, error }: { saved?: string; error?: string }) {
  const savedMessage = saved ? SAVED_MESSAGES[saved] : undefined;
  return (
    <>
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
          <p className="font-semibold">This change was not saved.</p>
          <p>{error}</p>
        </div>
      ) : null}
      {savedMessage ? (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <p className="font-semibold">{savedMessage}</p>
        </div>
      ) : null}
    </>
  );
}

export const ownerInputClass =
  "flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PlanPill({ state }: { state: PlanState }) {
  const tone =
    state === "suspended"
      ? "bg-amber-100 text-amber-800"
      : state === "scaling"
        ? "bg-emerald-100 text-emerald-800"
        : "bg-slate-100 text-slate-700";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>{planStateLabel(state)}</span>;
}
