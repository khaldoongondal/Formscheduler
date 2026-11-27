import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createWebhookConnectionAction } from "@/app/(admin)/admin/connections/actions";
import { ActionError, HelpLink } from "@/app/(admin)/admin/connections/connection-ui";
import { WebhookSecretInput } from "@/app/(admin)/admin/connections/webhook-secret-input";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function NewWebhookConnectionPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
  await getAdminTenantId();
  const query = searchParams ? await searchParams : {};

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <Link href="/admin/connections" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-950">
        <ArrowLeft className="h-4 w-4" />
        {CONNECTIONS_COPY.backToConnections}
      </Link>
      {query.error ? <ActionError message={query.error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{WEBHOOK_COPY.createHeading}</CardTitle>
          <CardDescription>{WEBHOOK_COPY.createIntro}</CardDescription>
          <HelpLink kind="webhook" className="mt-2" />
        </CardHeader>
        <CardContent>
          <form action={createWebhookConnectionAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="webhook_name">{WEBHOOK_COPY.nameLabel}</Label>
              <Input id="webhook_name" name="name" defaultValue={WEBHOOK_COPY.defaultName} maxLength={120} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook_url">{WEBHOOK_COPY.addressLabel}</Label>
              <Input
                id="webhook_url"
                name="endpoint_url"
                type="url"
                inputMode="url"
                placeholder={WEBHOOK_COPY.addressPlaceholder}
                maxLength={2048}
                required
              />
              <p className="text-xs leading-5 text-slate-500">{WEBHOOK_COPY.addressHelp}</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhook_secret">{WEBHOOK_COPY.secretLabel}</Label>
              <WebhookSecretInput id="webhook_secret" />
            </div>
            <SaveSubmitButton className="w-full" label={WEBHOOK_COPY.createButton} pendingLabel="Saving..." />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
