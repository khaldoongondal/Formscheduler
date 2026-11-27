import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createCalendlyConnectionAction } from "@/app/(admin)/admin/connections/actions";
import { ActionError } from "@/app/(admin)/admin/connections/connection-ui";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { CALENDLY_COPY } from "@/lib/calendly/constants";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function NewCalendlyConnectionPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {
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
          <CardTitle>{CALENDLY_COPY.createHeading}</CardTitle>
          <CardDescription>{CALENDLY_COPY.createIntro}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form action={createCalendlyConnectionAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="calendly_name">{CALENDLY_COPY.nameLabel}</Label>
              <Input id="calendly_name" name="name" defaultValue={CALENDLY_COPY.defaultName} maxLength={120} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calendly_token">{CALENDLY_COPY.tokenLabel}</Label>
              <Input id="calendly_token" name="token" type="password" autoComplete="off" required />
              <p className="text-xs leading-5 text-slate-500">{CALENDLY_COPY.tokenHelp}</p>
            </div>
            <SaveSubmitButton className="w-full" label={CALENDLY_COPY.createButton} pendingLabel="Checking..." />
          </form>
          <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">{CALENDLY_COPY.limits}</p>
        </CardContent>
      </Card>
    </div>
  );
}
