import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { fireLogRowAction } from "@/app/(admin)/admin/pixels/actions";
import { DeliveryTable, StatusLegend, TestResultAlert } from "@/app/(admin)/admin/pixels/delivery-ui";
import { PIXEL_SAVED_MESSAGES } from "@/app/(admin)/admin/pixels/pixel-ui";
import { ActionError, ActionSuccess, selectClass } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listDeliveries, type DeliveryListRow } from "@/lib/meta/controls";
import {
  DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  LOG_EVENT_OPTIONS,
  LOG_RANGE_LABELS,
  LOG_RANGE_PRESETS,
  META_CONTROLS_COPY,
  parseLogFilter,
  type LogFilter
} from "@/lib/meta/log-format";
import { getPixel } from "@/lib/meta/pixels";

export const dynamic = "force-dynamic";

function filterHref(pixelId: string, filter: LogFilter, before: string | null) {
  const params = new URLSearchParams();
  if (filter.status !== "all") params.set("status", filter.status);
  if (filter.event !== "all") params.set("event", filter.event);
  params.set("preset", filter.preset);
  if (before) params.set("before", before);
  return `/admin/pixels/${pixelId}/events?${params.toString()}`;
}

export default async function PixelEventLogPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
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
  const single = (key: string) => {
    const value = query[key];
    return typeof value === "string" ? value : undefined;
  };
  const filter = parseLogFilter({
    status: single("status"),
    event: single("event"),
    preset: single("preset"),
    before: single("before")
  });
  const actionError = single("error") ?? null;
  const saved = single("saved");
  const firedCount = Math.max(0, Math.floor(Number(single("n") ?? 0)) || 0);
  const actionSuccess =
    saved === "fired" ? META_CONTROLS_COPY.sendAllSaved(firedCount) : saved ? PIXEL_SAVED_MESSAGES[saved] ?? null : null;

  let rows: DeliveryListRow[] = [];
  let nextBefore: string | null = null;
  let loadError: string | null = null;
  try {
    const result = await listDeliveries(tenantId, pixel.id, filter);
    rows = result.rows;
    nextBefore = result.nextBefore;
  } catch (error) {
    console.error("[meta] event log failed", error instanceof Error ? error.message : "unknown error");
    loadError = "The event log could not load. Refresh the page to try again.";
  }
  const filtered = filter.status !== "all" || filter.event !== "all" || Boolean(filter.before);

  const renderAction = (row: DeliveryListRow) => {
    if (row.status !== "held") return null;
    return (
      <form action={fireLogRowAction}>
        <input type="hidden" name="id" value={pixel.id} />
        {row.lead_session_id ? (
          <>
            <input type="hidden" name="lead_session_id" value={row.lead_session_id} />
            <ConfirmSubmitButton
              label={META_CONTROLS_COPY.sendRow}
              title={META_CONTROLS_COPY.leadSendHeld}
              description={META_CONTROLS_COPY.leadSendConfirm}
              size="sm"
              variant="outline"
            />
          </>
        ) : (
          <ConfirmSubmitButton
            label={META_CONTROLS_COPY.sendRow}
            title={META_CONTROLS_COPY.sendAllHeld}
            description="This event has no lead yet, so this sends every held event of this pixel. Meta counts them as real events and they cannot be taken back."
            size="sm"
            variant="outline"
          />
        )}
      </form>
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
          <Link href={`/admin/pixels/${pixel.id}`}>
            <ArrowLeft className="h-4 w-4" />
            {pixel.name}
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{META_CONTROLS_COPY.logHeading}</h1>
        <p className="mt-2 text-sm text-slate-600">{META_CONTROLS_COPY.logSubheading}</p>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[200px_200px_180px_auto] lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="log-status" className="text-xs text-slate-500">
            Status
          </Label>
          <select id="log-status" name="status" className={selectClass} defaultValue={filter.status}>
            <option value="all">All</option>
            {DELIVERY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {DELIVERY_STATUS_LABELS[status].label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-event" className="text-xs text-slate-500">
            Event
          </Label>
          <select id="log-event" name="event" className={selectClass} defaultValue={filter.event}>
            <option value="all">All</option>
            {LOG_EVENT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="log-range" className="text-xs text-slate-500">
            Range
          </Label>
          <select id="log-range" name="preset" className={selectClass} defaultValue={filter.preset}>
            {LOG_RANGE_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {LOG_RANGE_LABELS[preset]}
              </option>
            ))}
          </select>
        </div>
        <SaveSubmitButton label="Apply" pendingLabel="Loading..." variant="outline" className="w-full lg:w-auto" />
      </form>

      {loadError ? (
        <TestResultAlert message={loadError} />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600">
          {filtered ? META_CONTROLS_COPY.logNoMatch : META_CONTROLS_COPY.logEmpty}
        </p>
      ) : (
        <DeliveryTable rows={rows} renderAction={renderAction} />
      )}

      {nextBefore ? (
        <Button asChild variant="outline">
          <Link href={filterHref(pixel.id, filter, nextBefore)}>{META_CONTROLS_COPY.olderEvents}</Link>
        </Button>
      ) : null}

      <StatusLegend />
    </div>
  );
}
