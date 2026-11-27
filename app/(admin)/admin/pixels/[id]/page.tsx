import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { deletePixelAction, updatePixelAction } from "@/app/(admin)/admin/pixels/actions";
import { PIXEL_COPY, PIXEL_SAVED_MESSAGES, PixelFields } from "@/app/(admin)/admin/pixels/pixel-ui";
import { ActionError, ActionSuccess } from "@/app/(admin)/admin/split-tests/split-test-ui";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { getPixel, listFormsByPixel } from "@/lib/meta/pixels";

export const dynamic = "force-dynamic";

export default async function PixelSettingsPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
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

  const { id } = await params;
  const tenantId = await getAdminTenantId();
  const pixel = await getPixel(tenantId, id).catch(() => null);
  if (!pixel) notFound();

  const formsByPixel = await listFormsByPixel(tenantId);
  const forms = formsByPixel.get(pixel.id) ?? [];
  const query = searchParams ? await searchParams : {};
  const actionError = typeof query.error === "string" ? query.error : null;
  const actionSuccess = query.saved ? PIXEL_SAVED_MESSAGES[query.saved] ?? null : null;

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
