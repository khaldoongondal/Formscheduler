import Link from "next/link";
import {
  replaceCalendlyTokenAction,
  replaceHubspotTokenAction,
  replaceWebhookSecretAction,
  sendWebhookTestAction,
  setupCalendlyConfirmationsAction,
  updateWebhookAddressAction
} from "@/app/(admin)/admin/connections/actions";
import { WebhookSecretInput } from "@/app/(admin)/admin/connections/webhook-secret-input";
import { CALENDLY_COPY } from "@/lib/calendly/constants";
import type { ConnectionSummary } from "@/lib/connections/service";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CalendlySection({ connection }: { connection: ConnectionSummary }) {
  const ready = typeof connection.settings.webhook_subscription_uri === "string";
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <p className="text-sm leading-6 text-slate-700">{CALENDLY_COPY.intro}</p>
        <div className="space-y-1 text-sm text-slate-700">
          {connection.accountLabel ? <p>{CALENDLY_COPY.signedInAs(connection.accountLabel)}</p> : null}
          {connection.secretLastFour ? <p>{CALENDLY_COPY.tokenEnding(connection.secretLastFour)}</p> : null}
          <p>
            {CALENDLY_COPY.confirmationsLabel}{" "}
            <span className={ready ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>
              {ready ? CALENDLY_COPY.confirmationsOn : CALENDLY_COPY.confirmationsOff}
            </span>
          </p>
        </div>
        <form action={setupCalendlyConfirmationsAction}>
          <input type="hidden" name="id" value={connection.id} />
          <SaveSubmitButton label={CALENDLY_COPY.setUpConfirmations} variant="outline" pendingLabel="Setting up..." />
        </form>
        <form action={replaceCalendlyTokenAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={connection.id} />
          <div className="flex-1 space-y-2">
            <Label htmlFor="calendly_token">{CALENDLY_COPY.replaceToken}</Label>
            <Input id="calendly_token" name="token" type="password" autoComplete="off" required />
          </div>
          <SaveSubmitButton label={CALENDLY_COPY.replaceToken} variant="outline" pendingLabel="Checking..." />
        </form>
        <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{CALENDLY_COPY.limits}</p>
      </CardContent>
    </Card>
  );
}

export function HubspotSection({ connection }: { connection: ConnectionSummary }) {
  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="space-y-1 text-sm text-slate-700">
          {connection.accountLabel ? <p>{connection.accountLabel}</p> : null}
          {connection.secretLastFour ? <p>{HUBSPOT_COPY.tokenEnding(connection.secretLastFour)}</p> : null}
        </div>
        <form action={replaceHubspotTokenAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={connection.id} />
          <div className="flex-1 space-y-2">
            <Label htmlFor="hubspot_token">{HUBSPOT_COPY.replaceToken}</Label>
            <Input id="hubspot_token" name="token" type="password" autoComplete="off" required />
          </div>
          <SaveSubmitButton label={HUBSPOT_COPY.replaceToken} variant="outline" pendingLabel="Checking..." />
        </form>
        <Link href={`/admin/connections/${connection.id}/deliveries`} className="inline-block text-sm font-medium underline underline-offset-2">
          {WEBHOOK_COPY.deliveryLog}
        </Link>
      </CardContent>
    </Card>
  );
}

export function WebhookSection({
  connection,
  testResult
}: {
  connection: ConnectionSummary;
  testResult: { sent: boolean; status: number | null; summary: string } | null;
}) {
  return (
    <Card id="webhook" className="scroll-mt-24">
      <CardContent className="space-y-5 p-5">
        <p className="text-sm leading-6 text-slate-700">{WEBHOOK_COPY.intro}</p>
        <form action={updateWebhookAddressAction} className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <input type="hidden" name="id" value={connection.id} />
          <div className="flex-1 space-y-2">
            <Label htmlFor="webhook_url">{WEBHOOK_COPY.addressHeading}</Label>
            <Input id="webhook_url" name="endpoint_url" type="url" defaultValue={connection.endpointUrl ?? ""} maxLength={2048} required />
          </div>
          <SaveSubmitButton label={WEBHOOK_COPY.saveAddress} variant="outline" />
        </form>
        <form action={replaceWebhookSecretAction} className="space-y-2">
          <input type="hidden" name="id" value={connection.id} />
          {connection.signingSecretLastFour ? (
            <p className="text-sm text-slate-700">{WEBHOOK_COPY.secretEnding(connection.signingSecretLastFour)}</p>
          ) : null}
          <Label htmlFor="webhook_secret">{WEBHOOK_COPY.replaceSecret}</Label>
          <WebhookSecretInput id="webhook_secret" />
          <SaveSubmitButton label={WEBHOOK_COPY.replaceSecret} variant="outline" />
        </form>
        <div className="flex flex-wrap items-center gap-3">
          <form action={sendWebhookTestAction}>
            <input type="hidden" name="id" value={connection.id} />
            <SaveSubmitButton label={WEBHOOK_COPY.sendTest} variant="outline" pendingLabel="Sending..." />
          </form>
          <Link href={`/admin/connections/${connection.id}/deliveries`} className="text-sm font-medium underline underline-offset-2">
            {WEBHOOK_COPY.deliveryLog}
          </Link>
          <Link href="/help/connections#webhook" className="text-sm font-medium text-slate-600 underline underline-offset-2">
            {WEBHOOK_COPY.helpLink}
          </Link>
        </div>
        {testResult ? (
          <p
            className={
              testResult.sent
                ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800"
                : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            }
            role="status"
          >
            {testResult.sent ? WEBHOOK_COPY.testDelivered(testResult.status ?? 200) : WEBHOOK_COPY.testFailed(testResult.summary)}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
