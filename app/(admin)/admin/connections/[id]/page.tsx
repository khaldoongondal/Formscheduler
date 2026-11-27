import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import {
  checkConnectionAction,
  deleteConnectionAction,
  renameConnectionAction,
  replaceCalcomKeyAction,
  saveAvailabilityAction,
  setConnectionDisabledAction
} from "@/app/(admin)/admin/connections/actions";
import { AvailabilityForm } from "@/app/(admin)/admin/connections/availability-form";
import { CalendlySection, HubspotSection, WebhookSection } from "@/app/(admin)/admin/connections/provider-sections";
import { CALENDLY_COPY } from "@/lib/calendly/constants";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import { createServiceClient } from "@/lib/supabase/server";
import { ActionError, ActionSuccess, ConnectionStatusBadge, HelpLink } from "@/app/(admin)/admin/connections/connection-ui";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { CALCOM_COPY } from "@/lib/calcom/constants";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { isUuid, providerLabel } from "@/lib/connections/registry";
import { getConnectionSummary, listFormsUsingConnection } from "@/lib/connections/service";
import { DEFAULT_AVAILABILITY, parseAvailability } from "@/lib/google/availability";
import { GOOGLE_COPY } from "@/lib/google/copy";
import { GOOGLE_START_PATH } from "@/lib/google/oauth-core";
import { relativeTime } from "@/lib/time/relative";
import { ConfirmDeleteButton } from "@/components/admin/confirm-delete-button";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

const SAVED_MESSAGES: Record<string, string> = {
  google: GOOGLE_COPY.connected,
  created: CALCOM_COPY.created,
  key: CALCOM_COPY.keyReplaced,
  availability: GOOGLE_COPY.availabilitySaved,
  renamed: CONNECTIONS_COPY.savedRenamed,
  disabled: CONNECTIONS_COPY.savedDisabled,
  enabled: CONNECTIONS_COPY.savedEnabled,
  checked: CONNECTIONS_COPY.savedChecked,
  "calendly-created": CALENDLY_COPY.created,
  "calendly-token": CALENDLY_COPY.tokenReplaced,
  "calendly-confirmations": CALENDLY_COPY.confirmationsSetUp,
  "hubspot-created": HUBSPOT_COPY.created,
  "hubspot-token": HUBSPOT_COPY.tokenReplaced,
  "webhook-created": WEBHOOK_COPY.created,
  "webhook-address": WEBHOOK_COPY.addressSaved,
  "webhook-secret": WEBHOOK_COPY.secretReplaced
};

/** The "Send test" result, read from this tenant's own delivery log row. */
async function loadTestResult(tenantId: string, connectionId: string, deliveryId: string | undefined) {
  if (!deliveryId || !isUuid(deliveryId)) return null;
  const supabase = createServiceClient();
  const { data } = await supabase
    .from("crm_event_deliveries")
    .select("status,response_status,response_summary")
    .eq("id", deliveryId)
    .eq("tenant_id", tenantId)
    .eq("connection_id", connectionId)
    .eq("event_type", "test.ping")
    .maybeSingle();
  if (!data) return null;
  return { sent: data.status === "sent", status: data.response_status ?? null, summary: data.response_summary ?? "" };
}

export default async function ConnectionDetailPage({
  params,
  searchParams
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ saved?: string; error?: string; test?: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tenantId = await getAdminTenantId();
  const connection = await getConnectionSummary(tenantId, id);
  if (!connection) notFound();
  const forms = await listFormsUsingConnection(tenantId, id).catch(() => []);
  const query = searchParams ? await searchParams : {};
  const success = query.saved ? SAVED_MESSAGES[query.saved] ?? null : null;
  const error = query.error ?? null;
  const nowMs = Date.now();
  const isGoogle = connection.provider === "google_calendar";
  const isCalcom = connection.provider === "calcom";
  const availability = isGoogle ? parseAvailability(connection.availability) ?? DEFAULT_AVAILABILITY : null;
  const isWebhook = connection.provider === "webhook";
  const testResult = isWebhook ? await loadTestResult(tenantId, connection.id, query.test).catch(() => null) : null;

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div>
        <Link
          href="/admin/connections"
          className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-950"
        >
          <ArrowLeft className="h-4 w-4" />
          {CONNECTIONS_COPY.backToConnections}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">{connection.name}</h1>
          <ConnectionStatusBadge status={connection.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <p className="text-sm text-slate-600">{providerLabel(connection.provider)}</p>
          <HelpLink kind={connection.provider} />
        </div>
        {connection.status === "needs_attention" && connection.statusMessage ? (
          <p className="mt-2 text-sm text-amber-800">{connection.statusMessage}</p>
        ) : null}
      </div>

      {success ? <ActionSuccess message={success} /> : null}
      {error ? <ActionError message={error} /> : null}

      {isGoogle ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-700">
              {connection.accountLabel ? GOOGLE_COPY.connectedAs(connection.accountLabel) : providerLabel(connection.provider)}
            </p>
            <Button asChild variant="outline" size="sm">
              <a href={GOOGLE_START_PATH}>{GOOGLE_COPY.reconnect}</a>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {isGoogle && availability ? (
        <Card id="availability" className="scroll-mt-24">
          <CardHeader>
            <CardTitle>{GOOGLE_COPY.availabilityHeading}</CardTitle>
            <CardDescription>{GOOGLE_COPY.availabilityIntro}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!connection.availabilityConfirmedAt ? (
              <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {GOOGLE_COPY.availabilityUnconfirmed}
              </p>
            ) : null}
            <AvailabilityForm
              action={saveAvailabilityAction}
              connectionId={connection.id}
              initial={availability}
              confirmed={Boolean(connection.availabilityConfirmedAt)}
              defaultTimezone={DEFAULT_AVAILABILITY.timezone}
            />
          </CardContent>
        </Card>
      ) : null}

      {isCalcom ? (
        <Card>
          <CardContent className="space-y-4 p-5">
            <div className="space-y-1 text-sm text-slate-700">
              {connection.accountLabel ? <p>{CALCOM_COPY.account(connection.accountLabel)}</p> : null}
              {connection.secretLastFour ? <p>{CALCOM_COPY.keyEnding(connection.secretLastFour)}</p> : null}
            </div>
            <form action={replaceCalcomKeyAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <input type="hidden" name="id" value={connection.id} />
              <div className="flex-1 space-y-2">
                <Label htmlFor="calcom_api_key">{CALCOM_COPY.replaceKey}</Label>
                <Input id="calcom_api_key" name="api_key" type="password" autoComplete="off" required />
              </div>
              <SaveSubmitButton label={CALCOM_COPY.replaceKey} variant="outline" />
            </form>
          </CardContent>
        </Card>
      ) : null}

      {connection.provider === "calendly" ? <CalendlySection connection={connection} /> : null}
      {connection.provider === "hubspot" ? <HubspotSection connection={connection} /> : null}
      {isWebhook ? <WebhookSection connection={connection} testResult={testResult} /> : null}

      <Card>
        <CardContent className="space-y-5 p-5">
          <form action={renameConnectionAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <input type="hidden" name="id" value={connection.id} />
            <div className="flex-1 space-y-2">
              <Label htmlFor="connection_name">{CONNECTIONS_COPY.renameLabel}</Label>
              <Input id="connection_name" name="name" defaultValue={connection.name} maxLength={120} required />
            </div>
            <SaveSubmitButton label={CONNECTIONS_COPY.renameButton} variant="outline" />
          </form>

          <div className="flex flex-wrap items-center gap-3">
            <form action={setConnectionDisabledAction}>
              <input type="hidden" name="id" value={connection.id} />
              <input type="hidden" name="disabled" value={connection.status === "disabled" ? "false" : "true"} />
              <SaveSubmitButton
                label={connection.status === "disabled" ? CONNECTIONS_COPY.switchOn : CONNECTIONS_COPY.switchOff}
                variant="outline"
                pendingLabel="Saving..."
              />
            </form>
            {/* A webhook is checked with Send test above. */}
            {isWebhook ? null : (
              <form action={checkConnectionAction}>
                <input type="hidden" name="id" value={connection.id} />
                <SaveSubmitButton label={CONNECTIONS_COPY.checkConnection} variant="outline" pendingLabel="Checking..." />
              </form>
            )}
          </div>
          <p className="text-sm text-slate-600">
            {connection.lastCheckedAt
              ? CONNECTIONS_COPY.lastChecked(relativeTime(connection.lastCheckedAt, nowMs), connection.lastCheckSummary ?? "")
              : CONNECTIONS_COPY.neverChecked}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{CONNECTIONS_COPY.formsUsingHeading}</CardTitle>
        </CardHeader>
        <CardContent>
          {forms.length ? (
            <ul className="space-y-2 text-sm">
              {forms.map((form) => (
                <li key={form.id} className="flex items-center gap-2">
                  <Link href={`/admin/funnels/${form.id}`} className="font-medium text-slate-900 underline underline-offset-2">
                    {form.name}
                  </Link>
                  {form.isPublished ? (
                    <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                      {CONNECTIONS_COPY.activeBadge}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600">{CONNECTIONS_COPY.noFormsUsing}</p>
          )}
        </CardContent>
      </Card>

      <form action={deleteConnectionAction} className="flex justify-end">
        <input type="hidden" name="id" value={connection.id} />
        <ConfirmDeleteButton
          label={CONNECTIONS_COPY.deleteButton}
          title={CONNECTIONS_COPY.deleteTitle}
          description={CONNECTIONS_COPY.deleteDescription(connection.name)}
          size="sm"
        />
      </form>
    </div>
  );
}
