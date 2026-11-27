import Link from "next/link";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { providerLabel } from "@/lib/connections/registry";
import type { ConnectionSummary } from "@/lib/connections/service";
import type { ConnectionStatus } from "@/lib/connections/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const BADGE_STYLES: Record<ConnectionStatus, { label: string; className: string }> = {
  connected: { label: CONNECTIONS_COPY.badgeConnected, className: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  needs_attention: { label: CONNECTIONS_COPY.badgeNeedsAttention, className: "bg-amber-50 text-amber-800 ring-amber-200" },
  disabled: { label: CONNECTIONS_COPY.badgeDisabled, className: "bg-slate-100 text-slate-600 ring-slate-200" }
};

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const style = BADGE_STYLES[status] ?? BADGE_STYLES.disabled;
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ring-1 ${style.className}`}>
      {style.label}
    </span>
  );
}

/** Summary card for a calendar or CRM connection other than GoHighLevel. No secrets reach this component. */
export function GenericConnectionCard({ connection }: { connection: ConnectionSummary }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold text-slate-950">{connection.name}</h3>
            <ConnectionStatusBadge status={connection.status} />
          </div>
          <p className="mt-1 text-sm text-slate-600">
            {providerLabel(connection.provider)}
            {connection.accountLabel ? ` · ${connection.accountLabel}` : ""}
          </p>
          {connection.status === "needs_attention" && connection.statusMessage ? (
            <p className="mt-1 text-sm text-amber-800">{connection.statusMessage}</p>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/admin/connections/${connection.id}`}>{CONNECTIONS_COPY.open}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ActionError({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-900">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

export function ActionSuccess({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-6 text-emerald-900">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="font-semibold">{message}</p>
    </div>
  );
}

export function SavedBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
      <CheckCircle2 className="mr-1.5 h-4 w-4" />
      {label}
    </span>
  );
}

export function Field({
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
