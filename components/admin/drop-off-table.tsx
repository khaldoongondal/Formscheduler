import type { FunnelDropOffStepRow } from "@/lib/analytics/funnel-math";

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatStepType(type: FunnelDropOffStepRow["stepType"]) {
  const labels: Record<FunnelDropOffStepRow["stepType"], string> = {
    page_view: "Page",
    contact: "Contact",
    question: "Question",
    calendar: "Calendar"
  };
  return labels[type];
}

export function DropOffTable({
  rows,
  title = "Step drop-off"
}: {
  rows: FunnelDropOffStepRow[];
  title?: string;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 bg-slate-50/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Shows where unique visitors stop as they move through contact fields, questions, and calendar booking. Reached means viewed that step; advanced means moved past it.
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Step</th>
                <th className="px-4 py-3 font-semibold">Type</th>
                <th className="px-4 py-3 text-right font-semibold">Reached</th>
                <th className="px-4 py-3 text-right font-semibold">Advanced</th>
                <th className="px-4 py-3 text-right font-semibold">Dropped</th>
                <th className="px-4 py-3 text-right font-semibold">Drop-off rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.stepKey} className="border-t border-slate-100">
                  <td className="max-w-md px-4 py-3">
                    <span className="block font-semibold text-slate-950">{row.stepLabel}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{formatStepType(row.stepType)}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.uniqueVisitors}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.continuedCount}</td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-slate-800">{row.dropOffCount}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-slate-950">{formatRate(row.dropOffRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-5 text-sm leading-6 text-slate-500">
          No step-level tracking yet. This will start filling after the latest public form update is deployed and visitors move through the funnel.
        </p>
      )}
    </section>
  );
}
