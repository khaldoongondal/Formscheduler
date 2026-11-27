import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  deletePixelAction,
  fireAllHeldAction,
  savePixelSendingAction,
  sendTestEventAction,
  updatePixelAction
} from "@/app/(admin)/admin/pixels/actions";
import { TestResultAlert, formatEventTime } from "@/app/(admin)/admin/pixels/delivery-ui";
import { PIXEL_COPY, PIXEL_SAVED_MESSAGES, PixelFields } from "@/app/(admin)/admin/pixels/pixel-ui";
import { ActionError, ActionSuccess } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";
import { CopySnippetButton } from "@/components/admin/copy-snippet-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { buildBrowserPixelBridgeSnippet } from "@/lib/embed/snippets";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { countHeld, getLatestFailure } from "@/lib/meta/controls";
import { META_EVENT_DEFS, META_EVENT_KEYS } from "@/lib/meta/events";
import { META_CONTROLS_COPY, eventKeyLabel, metaResponseText } from "@/lib/meta/log-format";
import { getPixel, listFormsByPixel } from "@/lib/meta/pixels";

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <CopySnippetButton label={label} value={value} />
      </div>
      <pre className="max-h-48 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs leading-5 text-white">{value}</pre>
    </div>
  );
}

export const dynamic = "force-dynamic";

export default async function PixelSettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ error?: string; saved?: string; n?: string; test_error?: string }>;
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

  const [formsByPixel, heldCount, latestFailure] = await Promise.all([
    listFormsByPixel(tenantId),
    countHeld(tenantId, pixel.id).catch((error: unknown) => {
      console.error("[meta] held count failed", error instanceof Error ? error.message : "unknown error");
      return 0;
    }),
    getLatestFailure(tenantId, pixel.id).catch((error: unknown) => {
      console.error("[meta] latest failure failed", error instanceof Error ? error.message : "unknown error");
      return null;
    })
  ]);
  const forms = formsByPixel.get(pixel.id) ?? [];
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const firedCount = Math.max(0, Math.floor(Number(query.n ?? 0)) || 0);
  const actionSuccess =
    query.saved === "fired"
      ? META_CONTROLS_COPY.sendAllSaved(firedCount)
      : query.saved
        ? PIXEL_SAVED_MESSAGES[query.saved] ?? null
        : null;
  const testError = typeof query.test_error === "string" ? query.test_error : null;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  let bridgeSnippet: string | null = null;
  try {
    bridgeSnippet = buildBrowserPixelBridgeSnippet(appUrl);
  } catch {
    bridgeSnippet = null;
  }

  return (
    <div className="space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-3 mb-3">
          <Link href="/admin/pixels">
            <ArrowLeft className="h-4 w-4" />
            All pixels
          </Link>
        </Button>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{pixel.name}</h1>
        <p className="mt-2 break-all text-sm text-slate-600">
          Pixel {pixel.dataset_id}
          {pixel.token_last_four ? ` | Token ending ${pixel.token_last_four}` : ""}
        </p>
      </div>

      {actionError ? <ActionError message={actionError} /> : null}
      {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Pixel settings</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={updatePixelAction} className="space-y-5">
            <input type="hidden" name="id" value={pixel.id} />
            <PixelFields
              idPrefix="edit"
              defaults={{ name: pixel.name, datasetId: pixel.dataset_id, testEventCode: pixel.test_event_code }}
              tokenLastFour={pixel.token_last_four}
            />
            <SaveSubmitButton label="Save pixel" pendingLabel="Saving..." />
          </form>
        </CardContent>
      </Card>

      <Card className="max-w-3xl" id="sending">
        <CardHeader>
          <CardTitle>{META_CONTROLS_COPY.sendingTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={savePixelSendingAction} className="space-y-5">
            <input type="hidden" name="id" value={pixel.id} />
            <fieldset className="space-y-3">
              <legend className="sr-only">Sending mode</legend>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="sending_mode"
                  value="automatic"
                  defaultChecked={pixel.sending_mode !== "hold"}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-slate-900">{META_CONTROLS_COPY.automaticLabel}</span>
                  <span className="block text-slate-600">{META_CONTROLS_COPY.automaticHelp}</span>
                </span>
              </label>
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="radio"
                  name="sending_mode"
                  value="hold"
                  defaultChecked={pixel.sending_mode === "hold"}
                  className="mt-1"
                />
                <span>
                  <span className="font-semibold text-slate-900">{META_CONTROLS_COPY.holdLabel}</span>
                  <span className="block text-slate-600">{META_CONTROLS_COPY.holdHelp}</span>
                </span>
              </label>
              {pixel.sending_mode === "hold" && heldCount > 0 ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{META_CONTROLS_COPY.holdSwitchNote}</p>
              ) : null}
            </fieldset>

            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Send</th>
                    <th className="px-3 py-2 font-semibold">Event</th>
                    <th className="hidden px-3 py-2 font-semibold sm:table-cell">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {META_EVENT_KEYS.map((key) => {
                    const def = META_EVENT_DEFS[key];
                    return (
                      <tr key={key} className="align-top">
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            id={`switch-${key}`}
                            name={def.switchColumn}
                            defaultChecked={pixel[def.switchColumn] === true}
                            className="h-4 w-4"
                          />
                        </td>
                        <td className="px-3 py-3">
                          <label htmlFor={`switch-${key}`} className="font-medium text-slate-950">
                            {def.label}
                          </label>
                          <p className="text-xs text-slate-500">
                            {def.metaName}
                            {def.standard ? "" : ` ${META_CONTROLS_COPY.customEvent}`}
                          </p>
                          <p className="mt-1 text-xs text-slate-600 sm:hidden">{def.when}</p>
                        </td>
                        <td className="hidden px-3 py-3 text-slate-600 sm:table-cell">{def.when}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <SaveSubmitButton label={META_CONTROLS_COPY.saveSending} pendingLabel="Saving..." />
          </form>

          {heldCount > 0 ? (
            <form action={fireAllHeldAction} className="mt-6 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <input type="hidden" name="id" value={pixel.id} />
              <p className="text-sm font-semibold text-amber-900">{META_CONTROLS_COPY.heldCount(heldCount)}</p>
              <ConfirmSubmitButton
                label={META_CONTROLS_COPY.sendAllHeld}
                title={META_CONTROLS_COPY.sendAllHeld}
                description={META_CONTROLS_COPY.sendAllConfirm(heldCount)}
              />
            </form>
          ) : null}
        </CardContent>
      </Card>

      <Card className="max-w-3xl" id="test">
        <CardHeader>
          <CardTitle>{META_CONTROLS_COPY.testTitle}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {testError ? <TestResultAlert message={testError} /> : null}
          <form action={sendTestEventAction}>
            <input type="hidden" name="id" value={pixel.id} />
            {pixel.test_event_code ? (
              <SaveSubmitButton label={META_CONTROLS_COPY.sendTest} pendingLabel="Sending..." variant="outline" />
            ) : (
              <Button type="button" variant="outline" disabled>
                {META_CONTROLS_COPY.sendTest}
              </Button>
            )}
          </form>
          {!pixel.test_event_code ? (
            <p className="text-sm text-slate-600">{META_CONTROLS_COPY.testNeedsCode}</p>
          ) : null}
          {pixel.last_test_at && pixel.last_test_summary ? (
            <p className="break-words text-sm text-slate-700">
              {META_CONTROLS_COPY.lastTest(formatEventTime(pixel.last_test_at), pixel.last_test_summary)}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {latestFailure ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>{META_CONTROLS_COPY.latestFailureTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-slate-700">
              {formatEventTime(latestFailure.event_time)} | {eventKeyLabel(latestFailure.event_key)} ({latestFailure.event_name})
            </p>
            <p className="break-words text-red-700">
              {metaResponseText(latestFailure.status, latestFailure.meta_response, latestFailure.last_error)}
            </p>
            <Link
              href={`/admin/pixels/${pixel.id}/events?status=failed`}
              className="inline-block font-semibold text-slate-950 hover:underline"
            >
              {META_CONTROLS_COPY.seeFailed}
            </Link>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex max-w-3xl flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href={`/admin/pixels/${pixel.id}/events`}>{META_CONTROLS_COPY.eventLog}</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href={`/admin/pixels/${pixel.id}/quality`}>{META_CONTROLS_COPY.matchQuality}</Link>
        </Button>
      </div>

      {bridgeSnippet ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle>{META_CONTROLS_COPY.bridgeTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm leading-6 text-slate-600">{META_CONTROLS_COPY.bridgeHelp}</p>
            <Snippet label="Snippet" value={bridgeSnippet} />
          </CardContent>
        </Card>
      ) : null}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Forms using this pixel</CardTitle>
        </CardHeader>
        <CardContent>
          {forms.length === 0 ? (
            <p className="text-sm leading-6 text-slate-600">
              No form uses this pixel yet. Choose it in the Meta pixel section of a form.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {forms.map((form) => (
                <li key={form.id} className="flex flex-wrap items-center gap-2">
                  <Link href={`/admin/funnels/${form.id}#meta`} className="font-semibold text-slate-950 hover:underline">
                    {form.name}
                  </Link>
                  <span className="text-xs text-slate-500">{form.isPublished ? "Active" : "Draft"}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>Delete pixel</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={deletePixelAction}>
            <input type="hidden" name="id" value={pixel.id} />
            <ConfirmDeleteButton
              label="Delete pixel"
              title="Delete this pixel?"
              description={PIXEL_COPY.deleteConfirm}
              variant="destructive"
            />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
