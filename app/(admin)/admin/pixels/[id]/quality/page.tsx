import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { TestResultAlert } from "@/app/(admin)/admin/pixels/delivery-ui";
import { DateRangeFilter } from "@/components/admin/date-range-filter";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resolveAnalyticsDateRange } from "@/lib/analytics/service";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { getMatchCoverage } from "@/lib/meta/controls";
import {
  COVERAGE_COLUMNS,
  LOW_COVERAGE_SHARE,
  MATCH_GUIDANCE,
  META_CONTROLS_COPY,
  coverageShares,
  eventKeyLabel,
  formatShare,
  sortCoverageRows,
  totalCoverage,
  type CoverageRow
} from "@/lib/meta/log-format";
import { getPixel } from "@/lib/meta/pixels";

export const dynamic = "force-dynamic";

function CoverageTableRow({ label, row, strong }: { label: string; row: CoverageRow; strong?: boolean }) {
  const shares = coverageShares(row);
  return (
    <tr className="align-top">
      <th scope="row" className={`whitespace-nowrap px-3 py-2 text-left ${strong ? "font-semibold text-slate-950" : "font-medium text-slate-800"}`}>
        {label}
      </th>
      <td className="px-3 py-2 text-slate-700">{row.events.toLocaleString("en")}</td>
      {COVERAGE_COLUMNS.map((column) => {
        const share = shares[column.key];
        const low = row.events > 0 && share < LOW_COVERAGE_SHARE;
        return (
          <td key={column.key} className={`px-3 py-2 ${low ? "bg-amber-50 text-amber-900" : "text-slate-700"}`}>
            {formatShare(share)}
          </td>
        );
      })}
    </tr>
  );
}

export default async function PixelMatchQualityPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ preset?: string; from?: string; to?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for Meta pixels."
        description="Meta pixels and their event log are stored in Supabase. Add the database environment variables before opening this page."
        missingEnv={missingEnv}
      />
    );
  }

  const { id } = await params;
  const tenantId = await getAdminTenantId();
  const pixel = await getPixel(tenantId, id).catch(() => null);
  if (!pixel) notFound();

  const query = searchParams ? await searchParams : {};
  const range = resolveAnalyticsDateRange({ preset: query.preset, from: query.from, to: query.to });
  let rows: CoverageRow[] = [];
  let loadError: string | null = null;
  try {
    // The RPC range end is exclusive; the resolver's end is the last millisecond of the day.
    rows = sortCoverageRows(await getMatchCoverage(tenantId, pixel.id, { from: range.from, to: new Date(range.to.getTime() + 1) }));
  } catch (error) {
    console.error("[meta] match coverage failed", error instanceof Error ? error.message : "unknown error");
    loadError = "Match quality could not load. Refresh the page to try again.";
  }
  const total = totalCoverage(rows);

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
          <Link href={`/admin/pixels/${pixel.id}`}>
            <ArrowLeft className="h-4 w-4" />
            {pixel.name}
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{META_CONTROLS_COPY.qualityHeading}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{META_CONTROLS_COPY.qualitySubheading}</p>
        <DateRangeFilter range={range} />
      </div>

      {loadError ? (
        <TestResultAlert message={loadError} />
      ) : total.events === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          {META_CONTROLS_COPY.qualityEmpty}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Event</th>
                  <th className="px-3 py-2 text-left font-semibold">Events</th>
                  {COVERAGE_COLUMNS.map((column) => (
                    <th key={column.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold">
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <CoverageTableRow label={META_CONTROLS_COPY.qualityAllEvents} row={total} strong />
                {rows.map((row) => (
                  <CoverageTableRow key={row.event_key} label={eventKeyLabel(row.event_key)} row={row} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-5 text-slate-500">{META_CONTROLS_COPY.qualityPreLeadNote}</p>
        </div>
      )}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>{META_CONTROLS_COPY.qualityHowTo}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
            {MATCH_GUIDANCE.map((item) => (
              <li key={item.key}>{item.text}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
