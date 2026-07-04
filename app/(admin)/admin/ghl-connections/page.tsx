import { CheckCircle2 } from "lucide-react";
import {
  createGhlConnectionAction,
  deleteGhlConnectionAction,
  updateGhlConnectionAction
} from "@/app/(admin)/admin/ghl-connections/actions";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listGhlConnections } from "@/lib/ghl/connections";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function GhlConnectionsPage({
  searchParams
}: {
  searchParams?: Promise<{ connection?: string; saved?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for GHL connection management."
        description="GHL connection records and tenant permissions are stored in Supabase. Add the Supabase environment variables before using this admin screen."
        missingEnv={missingEnv}
      />
    );
  }

  const tenantId = await getAdminTenantId();
  const connections = await listGhlConnections(tenantId);
  const query = searchParams ? await searchParams : {};
  const savedConnectionId = query.saved === "connection" || query.saved === "created" ? query.connection : null;
  const actionSuccess = query.saved === "deleted" ? "GHL connection deleted." : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">GHL Connections</h1>
          <p className="mt-1 text-sm text-slate-600">Each funnel can point to a different GHL sub-account.</p>
        </div>
        {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}
        <div className="grid gap-4">
          {connections.map((connection) => (
            <Card key={connection.id}>
              <CardContent className="p-5">
                <form action={updateGhlConnectionAction} className="grid gap-4 md:grid-cols-2">
                  <input type="hidden" name="id" value={connection.id} />
                  <Field label="Name" name="name" defaultValue={connection.name} />
                  <Field label="Location ID" name="location_id" defaultValue={connection.location_id} />
                  <Field label="Default Calendar ID" name="calendar_id" defaultValue={connection.calendar_id ?? ""} />
                  <Field label="API Version" name="api_version" defaultValue={connection.api_version} />
                  <div className="space-y-2 md:col-span-2">
                    <Label>Private Integration Token</Label>
                    <Input name="private_token" type="password" placeholder={connection.token_last_four ? `Ends in ${connection.token_last_four}` : "Paste token"} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>API Base URL</Label>
                    <Input name="api_base_url" defaultValue={connection.api_base_url} />
                  </div>
                  <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                    <input type="checkbox" name="is_active" defaultChecked={connection.is_active} />
                    Active
                  </label>
                  <div className="flex items-center justify-end gap-2">
                    {savedConnectionId === connection.id ? <SavedBadge label="Saved" /> : null}
                    <SaveSubmitButton label="Save" variant="outline" />
                  </div>
                </form>
                <form action={deleteGhlConnectionAction} className="mt-3 flex justify-end">
                  <input type="hidden" name="id" value={connection.id} />
                  <ConfirmDeleteButton
                    label="Delete"
                    title="Delete this GHL connection?"
                    description={`This permanently removes "${connection.name}" from FormBook. Funnels using this connection will need another GHL connection selected before they can book properly.`}
                    size="sm"
                  />
                </form>
              </CardContent>
            </Card>
          ))}
          {connections.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600">No GHL connections configured.</CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Create Connection</CardTitle>
          <CardDescription>Tokens are stored server-side and never sent to public routes.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createGhlConnectionAction} className="space-y-4">
            <Field label="Name" name="name" placeholder="Client A GHL" />
            <Field label="Location ID" name="location_id" />
            <Field label="Default Calendar ID" name="calendar_id" />
            <div className="space-y-2">
              <Label>Private Integration Token</Label>
              <Input name="private_token" type="password" required />
            </div>
            <Field label="API Base URL" name="api_base_url" defaultValue="https://services.leadconnectorhq.com" />
            <Field label="API Version" name="api_version" defaultValue="2023-02-21" />
            <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
              <input type="checkbox" name="is_active" defaultChecked />
              Active
            </label>
            <SaveSubmitButton className="w-full" label="Create" />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ActionSuccess({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

function SavedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
      <CheckCircle2 className="mr-1.5 h-4 w-4" />
      {label}
    </span>
  );
}

function Field({
  label,
  name,
  defaultValue,
  placeholder
}: {
  label: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input name={name} defaultValue={defaultValue} placeholder={placeholder} />
    </div>
  );
}
