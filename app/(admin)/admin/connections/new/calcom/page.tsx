import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createCalcomConnectionAction } from "@/app/(admin)/admin/connections/actions";
import { ActionError, HelpLink } from "@/app/(admin)/admin/connections/connection-ui";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { CALCOM_COPY } from "@/lib/calcom/constants";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { SaveSubmitButton } from "@/components/admin/save-submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const dynamic = "force-dynamic";

export default async function NewCalcomConnectionPage({
  searchParams
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  // Requires a signed-in admin before the form is shown.
  await getAdminTenantId();
  const query = searchParams ? await searchParams : {};

  return (
    <div className="mx-auto grid max-w-xl gap-6">
      <Link
        href="/admin/connections"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-950"
      >
        <ArrowLeft className="h-4 w-4" />
        {CONNECTIONS_COPY.backToConnections}
      </Link>
      {query.error ? <ActionError message={query.error} /> : null}
      <Card>
        <CardHeader>
          <CardTitle>{CALCOM_COPY.createHeading}</CardTitle>
          <CardDescription>{CALCOM_COPY.createIntro}</CardDescription>
          <HelpLink kind="calcom" className="mt-2" />
        </CardHeader>
        <CardContent>
          <form action={createCalcomConnectionAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="calcom_name">{CALCOM_COPY.nameLabel}</Label>
              <Input id="calcom_name" name="name" defaultValue={CALCOM_COPY.defaultName} maxLength={120} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="calcom_key">{CALCOM_COPY.keyLabel}</Label>
              <Input id="calcom_key" name="api_key" type="password" autoComplete="off" required />
              <p className="text-xs leading-5 text-slate-500">{CALCOM_COPY.keyHelp}</p>
            </div>
            <SaveSubmitButton className="w-full" label={CALCOM_COPY.createButton} pendingLabel="Checking..." />
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
