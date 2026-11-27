import { BarChart3, Wallet } from "lucide-react";
import { clearTestSpendAction, saveTestSpendAction } from "@/app/(admin)/admin/split-tests/actions";
import { selectClass } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { DropOffTable } from "@/components/admin/drop-off-table";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SplitTestResults } from "@/lib/split-tests/results-service";
import { SPLIT_CALL_RULE, splitCallMessage, type ArmResult } from "@/lib/split-tests/results";
import { CURRENCIES, centsToInput, formatMoney } from "@/lib/spend/money";
import type { AdSpendEntry } from "@/lib/types/database";

export const RESULTS_COPY = {
  empty: "No visits recorded for this test in this date range yet.",
  costNote: "Cost figures use every lead and booking since the test started, because spend covers the whole test.",
  callNote: "The call above uses every lead and booking since the test started.",
  filtersNote:
    "These results include all traffic to the test link. Country and traffic source filters set on each form do not apply here.",
  spendHelper:
    "Enter what you spent on ads for each form during the whole test. We use it for cost per lead and cost per booked call.",
  spendIncomplete: "Enter spend for every form",
  notEntered: "Not entered",
  mixed: "Mixed currencies",
  draft: "Results appear here after the test starts.",
  spendUnavailable: "Ad spend is not available yet. Please try again later."
} as const;

function formatRate(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function money(cents: number | null, currency: string | null, fallback: string = RESULTS_COPY.notEntered) {
  if (currency === "mixed") return RESULTS_COPY.mixed;
  if (cents === null || !currency) return fallback;
  return formatMoney(cents, currency);
}

const CALL_STYLES = {
  too_early: "border-amber-200 bg-amber-50 text-amber-950",
  no_clear_leader: "border-slate-200 bg-slate-50 text-slate-900",
  leader: "border-emerald-200 bg-emerald-50 text-emerald-950"
} as const;

type Row = { label: string; cell: (arm: ArmResult) => string; total: string };

export function SplitResultsCard({
  results,
  range
}: {
  results: SplitTestResults;
  range: { from: Date; to: Date; preset: string };
}) {
  const { arms, totals, call } = results;
  const hasData = totals.counts.visitors > 0 || totals.counts.leads > 0;
  const costTotal = (cents: number | null) =>
    totals.currency === "mixed"
      ? RESULTS_COPY.mixed
      : totals.spendCents === null
        ? RESULTS_COPY.notEntered
        : !totals.spendComplete
          ? RESULTS_COPY.spendIncomplete
          : money(cents, totals.currency, "Not available");

  const rows: Row[] = [
    { label: "Unique visitors", cell: (arm) => String(arm.counts.visitors), total: String(totals.counts.visitors) },
    { label: "Form starts", cell: (arm) => String(arm.counts.starts), total: String(totals.counts.starts) },
    { label: "Leads", cell: (arm) => String(arm.counts.leads), total: String(totals.counts.leads) },
    { label: "Qualified", cell: (arm) => String(arm.counts.qualified), total: String(totals.counts.qualified) },
    { label: "Disqualified", cell: (arm) => String(arm.counts.disqualified), total: String(totals.counts.disqualified) },
    { label: "Calendar shown", cell: (arm) => String(arm.counts.calendarShown), total: String(totals.counts.calendarShown) },
    { label: "Bookings", cell: (arm) => String(arm.counts.bookings), total: String(totals.counts.bookings) },
    { label: "Visitor to start", cell: (arm) => formatRate(arm.rates.visitorToStart), total: formatRate(totals.rates.visitorToStart) },
    { label: "Start to lead", cell: (arm) => formatRate(arm.rates.startToLead), total: formatRate(totals.rates.startToLead) },
    { label: "Lead to booking", cell: (arm) => formatRate(arm.rates.leadToBooking), total: formatRate(totals.rates.leadToBooking) },
    {
      label: "Visitor to booking",
      cell: (arm) => formatRate(arm.rates.visitorToBooking),
      total: formatRate(totals.rates.visitorToBooking)
    },
    {
      label: "Ad spend",
      cell: (arm) => money(arm.cost.spendCents, arm.cost.currency),
      total: money(totals.spendCents, totals.currency)
    },
    {
      label: "Cost per lead",
      cell: (arm) =>
        arm.cost.spendCents === null ? RESULTS_COPY.notEntered : money(arm.cost.costPerLeadCents, arm.cost.currency, "No leads yet"),
      total: costTotal(totals.costPerLeadCents)
    },
    {
      label: "Cost per booked call",
      cell: (arm) =>
        arm.cost.spendCents === null
          ? RESULTS_COPY.notEntered
          : money(arm.cost.costPerBookingCents, arm.cost.currency, "No bookings yet"),
      total: costTotal(totals.costPerBookingCents)
    }
  ];

  return (
    <Card id="results" className="scroll-mt-24 overflow-hidden">
      <CardHeader className="border-b border-slate-100">
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Results
        </CardTitle>
        <CardDescription>Whole test: {results.fullPeriodLabel}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 p-5">
        <section className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date range</p>
          <DateRangeFilter range={range} extraPresets={[{ value: "test", label: "Whole test" }]} />
        </section>

        <section className={`rounded-xl border p-4 ${CALL_STYLES[call.state]}`} role="status">
          <p className="text-sm font-semibold leading-6">{splitCallMessage(call)}</p>
          <p className="mt-2 text-xs leading-5 opacity-80">{SPLIT_CALL_RULE}</p>
          {!results.filteredMatchesFullPeriod ? (
            <p className="mt-1 text-xs leading-5 opacity-80">{RESULTS_COPY.callNote}</p>
          ) : null}
        </section>

        {!hasData ? (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">{RESULTS_COPY.empty}</p>
        ) : (
          <>
            <section className={`grid gap-3 ${arms.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              {arms.map((arm) => (
                <div key={arm.funnelId} className="rounded-xl border border-slate-200 bg-white p-4">
                  <p className="truncate text-sm font-semibold text-slate-800">
                    Form {arm.label}: {arm.name}
                  </p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Lead-to-booking rate</p>
                  <p className="mt-1 text-4xl font-semibold tabular-nums text-slate-950">{formatRate(arm.rates.leadToBooking)}</p>
                  <p className="mt-2 text-sm text-slate-600">
                    {arm.counts.bookings} {arm.counts.bookings === 1 ? "booking" : "bookings"} from {arm.counts.leads}{" "}
                    {arm.counts.leads === 1 ? "lead" : "leads"}
                  </p>
                  {arm.counts.leads > 0 && arm.leadToBookingInterval ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Likely range {formatRate(arm.leadToBookingInterval.low)} to {formatRate(arm.leadToBookingInterval.high)}
                    </p>
                  ) : null}
                </div>
              ))}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">
                        <span className="sr-only">Measure</span>
                      </th>
                      {arms.map((arm) => (
                        <th key={arm.funnelId} className="whitespace-nowrap px-4 py-3 text-right font-semibold">
                          Form {arm.label}
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right font-semibold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.label} className="border-t border-slate-100">
                        <td className="whitespace-nowrap px-4 py-3 font-semibold text-slate-950">{row.label}</td>
                        {arms.map((arm) => (
                          <td key={arm.funnelId} className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-800">
                            {row.cell(arm)}
                          </td>
                        ))}
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums text-slate-950">
                          {row.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <div className="space-y-1 text-sm leading-6 text-slate-500">
          {!results.filteredMatchesFullPeriod ? <p>{RESULTS_COPY.costNote}</p> : null}
          <p>{RESULTS_COPY.filtersNote}</p>
        </div>

        {hasData
          ? arms.map((arm) => (
              <DropOffTable key={arm.funnelId} rows={arm.dropOff} title={`Step drop-off: Form ${arm.label}`} />
            ))
          : null}
      </CardContent>
    </Card>
  );
}

export function TestSpendCard({
  testId,
  arms,
  saved
}: {
  testId: string;
  arms: Array<{ funnelId: string; label: string; name: string }>;
  saved: Map<string, AdSpendEntry> | null;
}) {
  return (
    <Card id="ad-spend" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-primary" />
          Ad spend for this test
        </CardTitle>
        <CardDescription>{RESULTS_COPY.spendHelper}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {saved === null ? <p className="text-sm text-slate-500">{RESULTS_COPY.spendUnavailable}</p> : null}
        {saved !== null
          ? arms.map((arm) => {
              const entry = saved.get(arm.funnelId);
              const prefix = `spend-${arm.label}`;
              return (
                <div key={arm.funnelId} className="rounded-lg border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-950">
                    Form {arm.label}: {arm.name}
                  </p>
                  <form
                    action={saveTestSpendAction}
                    className="mt-3 grid gap-3 sm:grid-cols-[150px_110px_minmax(160px,1fr)_auto] sm:items-end"
                  >
                    <input type="hidden" name="id" value={testId} />
                    <input type="hidden" name="funnel_id" value={arm.funnelId} />
                    <div className="space-y-1.5">
                      <Label htmlFor={`${prefix}-amount`} className="text-xs text-slate-500">
                        Amount
                      </Label>
                      <Input
                        id={`${prefix}-amount`}
                        name="amount"
                        inputMode="decimal"
                        placeholder="1250.00"
                        required
                        defaultValue={entry ? centsToInput(Number(entry.amount_cents)) : ""}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${prefix}-currency`} className="text-xs text-slate-500">
                        Currency
                      </Label>
                      <select
                        id={`${prefix}-currency`}
                        name="currency"
                        className={selectClass}
                        defaultValue={entry?.currency ?? "USD"}
                      >
                        {CURRENCIES.map((currency) => (
                          <option key={currency} value={currency}>
                            {currency}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`${prefix}-note`} className="text-xs text-slate-500">
                        Note (optional)
                      </Label>
                      <Input id={`${prefix}-note`} name="note" maxLength={200} defaultValue={entry?.note ?? ""} />
                    </div>
                    <SaveSubmitButton label="Save" />
                  </form>
                  {entry ? (
                    <form action={clearTestSpendAction} className="mt-2">
                      <input type="hidden" name="id" value={testId} />
                      <input type="hidden" name="funnel_id" value={arm.funnelId} />
                      <Button type="submit" variant="ghost" size="sm">
                        Clear
                      </Button>
                    </form>
                  ) : null}
                </div>
              );
            })
          : null}
      </CardContent>
    </Card>
  );
}
