import { PlugZap } from "lucide-react";
import {
  createGhlConnectionAction,
  deleteGhlConnectionAction,
  updateGhlConnectionAction
} from "@/app/(admin)/admin/ghl-connections/actions";
import {
  ActionError,
  ActionSuccess,
  Field,
  GenericConnectionCard,
  SavedBadge
} from "@/app/(admin)/admin/connections/connection-ui";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { PROVIDERS, type ProviderKind } from "@/lib/connections/registry";
import { listConnections, type ConnectionSummary } from "@/lib/connections/service";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { listGhlConnections } from "@/lib/ghl/connections";
import { isGhlOauthConfigured } from "@/lib/ghl/oauth";
import { CALCOM_COPY } from "@/lib/calcom/constants";
import { GOOGLE_COPY } from "@/lib/google/copy";
import { isGoogleOauthConfigured } from "@/lib/google/oauth";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { SetupRequired } from "@/components/setup/setup-required";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const ADD_LABELS: Partial<Record<ProviderKind, string>> = {
  google_calendar: GOOGLE_COPY.connectButton,
  calcom: CALCOM_COPY.createButton
};

export default async function ConnectionsPage({
  searchParams
}: {
  searchParams?: Promise<{ connection?: string; saved?: string; error?: string }>;
}) {
  const missingEnv = getMissingSupabaseAdminEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required for connection management."
        description="Connection records and tenant permissions are stored in Supabase. Add the Supabase environment variables before using this admin screen."
        missingEnv={missingEnv}
      />
    );
  }

  const tenantId = await getAdminTenantId();
  const [connections, genericConnections] = await Promise.all([
    listGhlConnections(tenantId),
    // Empty before migration 0029.
    listConnections(tenantId).catch((error: unknown): ConnectionSummary[] => {
      console.error("[connections] list failed", error instanceof Error ? error.message : "unknown error");
      return [];
    })
  ]);
  const oauthAvailable = isGhlOauthConfigured();
  const googleAvailable = isGoogleOauthConfigured();
  const query = searchParams ? await searchParams : {};
  const savedConnectionId =
    query.saved === "connection" || query.saved === "created" || query.saved === "oauth"
      ? query.connection
      : null;
  const actionSuccess =
    query.saved === "deleted"
      ? CONNECTIONS_COPY.ghlDeleted
      : query.saved === "connection-deleted"
        ? CONNECTIONS_COPY.connectionDeleted
      : query.saved === "oauth"
        ? CONNECTIONS_COPY.ghlOauthConnected
        : null;
  const actionError = query.error ?? null;
  const calendarConnections = genericConnections.filter((connection) =>
    PROVIDERS[connection.provider].roles.includes("calendar")
  );
  const crmConnections = genericConnections.filter((connection) => PROVIDERS[connection.provider].roles.includes("crm"));
  const addableProviders = (Object.keys(PROVIDERS) as ProviderKind[]).filter(
    (kind) => kind !== "ghl" && PROVIDERS[kind].available && PROVIDERS[kind].addHref
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section>
        <div className="mb-5">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{CONNECTIONS_COPY.heading}</h1>
          <p className="mt-1 text-sm text-slate-600">{CONNECTIONS_COPY.subheading}</p>
        </div>
        {actionSuccess ? <ActionSuccess message={actionSuccess} /> : null}
        {actionError ? <ActionError message={actionError} /> : null}

        <h2 id="calendars" className="mb-3 scroll-mt-24 text-lg font-semibold text-slate-950">
          {CONNECTIONS_COPY.calendarsHeading}
        </h2>
        <div className="grid gap-4">
          {connections.map((connection) => (
            <Card key={connection.id}>
              <CardContent className="p-5">
                <form action={updateGhlConnectionAction} className="grid gap-4 md:grid-cols-2">
                  <input type="hidden" name="id" value={connection.id} />
                  <div className="flex flex-wrap items-center gap-2 md:col-span-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">GoHighLevel</span>
                    {connection.auth_type === "oauth" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                        <PlugZap className="h-3.5 w-3.5" />
                        Connected via GoHighLevel sign-in
                      </span>
                    ) : null}
                  </div>
                  <Field label="Name" name="name" defaultValue={connection.name} />
                  <Field label="Location ID" name="location_id" defaultValue={connection.location_id} />
                  <Field label="Default Calendar ID" name="calendar_id" defaultValue={connection.calendar_id ?? ""} />
                  <Field label="API Version" name="api_version" defaultValue={connection.api_version} />
                  {connection.auth_type !== "oauth" ? (
                    <div className="space-y-2 md:col-span-2">
                      <Label>Private Integration Token</Label>
                      <Input
                        name="private_token"
                        type="password"
                        placeholder={connection.token_last_four ? `Ends in ${connection.token_last_four}` : "Paste token"}
                      />
                    </div>
                  ) : null}
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
                    title="Delete this GoHighLevel connection?"
                    description={`This permanently removes "${connection.name}" from FormBook. Forms using this connection will need another connection selected before they can book.`}
                    size="sm"
                  />
                </form>
              </CardContent>
            </Card>
          ))}
          {calendarConnections.map((connection) => (
            <GenericConnectionCard key={connection.id} connection={connection} />
          ))}
          {connections.length === 0 && calendarConnections.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600">{CONNECTIONS_COPY.noCalendars}</CardContent>
            </Card>
          ) : null}
        </div>

        <h2 id="crms" className="mb-3 mt-8 scroll-mt-24 text-lg font-semibold text-slate-950">
          {CONNECTIONS_COPY.crmsHeading}
        </h2>
        <p className="mb-3 text-sm text-slate-600">{CONNECTIONS_COPY.ghlAlsoCrm}</p>
        <div className="grid gap-4">
          {crmConnections.map((connection) => (
            <GenericConnectionCard key={connection.id} connection={connection} />
          ))}
          {connections.length === 0 && crmConnections.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-slate-600">{CONNECTIONS_COPY.noCrms}</CardContent>
            </Card>
          ) : null}
        </div>
      </section>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>{CONNECTIONS_COPY.addHeading}</CardTitle>
          <CardDescription>{CONNECTIONS_COPY.addDescription}</CardDescription>
        </CardHeader>
        <CardContent>
          <h3 className="mb-3 text-sm font-semibold text-slate-950">{CONNECTIONS_COPY.ghlSubheading}</h3>
          {oauthAvailable ? (
            <div className="mb-6">
              <Button asChild className="w-full">
                <a href="/api/connect/start">
                  <PlugZap className="h-4 w-4" />
                  Connect GoHighLevel
                </a>
              </Button>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Sign in to GoHighLevel and pick a sub-account. Tokens refresh automatically.
              </p>
              <div className="mt-4 flex items-center gap-3 text-xs uppercase tracking-wide text-slate-400">
                <span className="h-px flex-1 bg-slate-200" />
                or add manually
                <span className="h-px flex-1 bg-slate-200" />
              </div>
            </div>
          ) : null}
          <form action={createGhlConnectionAction} className="space-y-4">
            <Field label="Name" name="name" placeholder="Client A GoHighLevel" />
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

          {addableProviders.length ? (
            <div className="mt-6 space-y-2 border-t border-slate-100 pt-6">
              {addableProviders.map((kind) =>
                kind === "google_calendar" && !googleAvailable ? (
                  <p key={kind} className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {GOOGLE_COPY.notConfiguredButton}
                  </p>
                ) : (
                  <Button key={kind} asChild variant="outline" className="w-full">
                    <a href={PROVIDERS[kind].addHref ?? "/admin/connections"}>{ADD_LABELS[kind] ?? PROVIDERS[kind].label}</a>
                  </Button>
                )
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
