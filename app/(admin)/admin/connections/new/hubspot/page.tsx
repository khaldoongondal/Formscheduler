import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createHubspotConnectionAction } from "@/app/(admin)/admin/connections/actions";
import { ActionError, HelpLink } from "@/app/(admin)/admin/connections/connection-ui";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function NewHubspotConnectionPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
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
          <CardTitle>{HUBSPOT_COPY.createHeading}</CardTitle>
          <CardDescription>{HUBSPOT_COPY.createIntro}</CardDescription>
          <HelpLink kind="hubspot" className="mt-2" />
        </CardHeader>
        <CardContent>
          <form action={createHubspotConnectionAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hubspot_name">{HUBSPOT_COPY.nameLabel}</Label>
              <Input id="hubspot_name" name="name" defaultValue={HUBSPOT_COPY.defaultName} maxLength={120} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="hubspot_token">{HUBSPOT_COPY.tokenLabel}</Label>
              <Input id="hubspot_token" name="token" type="password" autoComplete="off" required />
              <p className="text-xs leading-5 text-slate-500">{HUBSPOT_COPY.tokenHelp}</p>
            </div>
            <SaveSubmitButton className="w-full" label={HUBSPOT_COPY.createButton} pendingLabel="Checking..." />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
