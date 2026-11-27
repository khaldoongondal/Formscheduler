import Link from "next/link";
import { createPixelAction } from "@/app/(admin)/admin/pixels/actions";
import { FrozenPixelBadge, PIXEL_COPY, PIXEL_SAVED_MESSAGES, PixelFields, usageLine } from "@/app/(admin)/admin/pixels/pixel-ui";
import { ActionError, ActionSuccess } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { UpgradeHint } from "@/components/admin/upgrade-hint";
import { SetupRequired } from "@/components/setup/setup-required";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getTenantPlanState } from "@/lib/billing/plan-service";
import { PLANS, SUSPENDED_MESSAGE, checkPixelLimit } from "@/lib/billing/plans";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { META_CONTROLS_COPY } from "@/lib/meta/log-format";
import { listFormsByPixel, listPixels, type PixelSummary } from "@/lib/meta/pixels";

export const dynamic = "force-dynamic";

export default async function PixelsPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string; saved?: string }>;
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

  const tenantId = await getAdminTenantId();
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = query.saved ? PIXEL_SAVED_MESSAGES[query.saved] ?? null : null;

  let pixels: PixelSummary[] = [];
  let formsByPixel = new Map<string, Array<{ id: string; name: string; isPublished: boolean }>>();
  let unavailable = false;
  try {
    [pixels, formsByPixel] = await Promise.all([listPixels(tenantId), listFormsByPixel(tenantId)]);
  } catch (error) {
    console.error("[meta] pixel list failed", error instanceof Error ? error.message : "unknown error");
    unavailable = true;
  }
  const state = await getTenantPlanState(tenantId);
  const plan = state === "suspended" ? null : PLANS[state];
  // Frozen pixels (migration 0032) do not count against the limit.
  const unfrozenCount = pixels.filter((pixel) => !pixel.frozen).length;
  const limit = checkPixelLimit(state, unfrozenCount);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-semibold text-emerald-700">Meta Pixels</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{PIXEL_COPY.heading}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{PIXEL_COPY.subheading}</p>
        {plan ? (
          <p className="mt-3 text-sm font-medium text-slate-700">{usageLine(unfrozenCount, plan.maxPixels, plan.name)}</p>
        ) : null}
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      {unavailable ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-600">
            Meta pixels are not available yet. Please try again later.
          </CardContent>
        </Card>
      ) : pixels.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-600">{PIXEL_COPY.empty}</CardContent>
        </Card>
      ) : (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <ul className="divide-y divide-slate-100">
            {pixels.map((pixel) => {
              const forms = formsByPixel.get(pixel.id) ?? [];
              return (
                <li key={pixel.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-slate-950">{pixel.name}</p>
                      {pixel.frozen ? <FrozenPixelBadge /> : null}
                    </div>
                    <p className="break-all text-sm text-slate-600">
                      Pixel {pixel.dataset_id}
                      {pixel.token_last_four ? ` | Token ending ${pixel.token_last_four}` : ""}
                    </p>
                    <p className="text-xs text-slate-500">
                      {forms.length === 1 ? "Used by 1 form" : `Used by ${forms.length} forms`}
                    </p>
                    {pixel.test_event_code ? (
                      <p className="text-xs font-semibold text-amber-800">{META_CONTROLS_COPY.testCodeListBadge}</p>
                    ) : null}
                  </div>
                  <Link
                    href={`/admin/pixels/${pixel.id}`}
                    className="shrink-0 text-sm font-semibold text-primary hover:underline"
                  >
                    Settings
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {unavailable ? null : (
        <Card id="add-pixel" className="max-w-3xl scroll-mt-24">
          <CardHeader>
            <CardTitle>{PIXEL_COPY.addTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {state === "suspended" ? (
              <p className="text-sm leading-6 text-amber-900">{SUSPENDED_MESSAGE}</p>
            ) : !limit.allowed ? (
              <div className="text-sm leading-6 text-amber-900">
                <p>{limit.message}</p>
                <UpgradeHint message={limit.message} />
              </div>
            ) : (
              <form action={createPixelAction} className="space-y-5">
                <PixelFields idPrefix="create" />
                <SaveSubmitButton label="Add pixel" pendingLabel="Adding..." />
              </form>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
