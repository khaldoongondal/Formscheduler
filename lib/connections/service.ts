/**
 * Tenant-scoped reads and writes on `connections` (calendars and CRMs other
 * than GoHighLevel). Every function filters by the caller's tenant unless it
 * says otherwise. Summaries carry no ciphertext and are the only shape UI
 * code may receive.
 */
import { unstable_noStore as noStore } from "next/cache";
import { CONNECTIONS_COPY } from "@/lib/connections/copy";
import { isUuid } from "@/lib/connections/registry";
import type { CalendarKind, ConnectionStatus, CrmKind, GenericProvider } from "@/lib/connections/types";
import { createServiceClient } from "@/lib/supabase/server";
import type { Connection } from "@/lib/types/database";

export type ConnectionRow = Connection;

export type ConnectionSummary = {
  id: string;
  provider: GenericProvider;
  name: string;
  status: ConnectionStatus;
  statusMessage: string | null;
  accountLabel: string | null;
  secretLastFour: string | null;
  signingSecretLastFour: string | null;
  endpointUrl: string | null;
  settings: Record<string, unknown>;
  availability: Record<string, unknown> | null;
  availabilityConfirmedAt: string | null;
  lastCheckedAt: string | null;
  lastCheckOk: boolean | null;
  lastCheckSummary: string | null;
  createdAt: string;
};

export const CONNECTION_SUMMARY_COLUMNS =
  "id,provider,name,status,status_message,account_label,secret_last_four,signing_secret_last_four,endpoint_url,settings,availability,availability_confirmed_at,last_checked_at,last_check_ok,last_check_summary,created_at";

/** Keeps at most the last four characters of a secret in clear. */
export function lastFour(value: string) {
  return value.length >= 4 ? value.slice(-4) : value;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

type SummaryRow = Pick<
  Connection,
  | "id"
  | "provider"
  | "name"
  | "status"
  | "status_message"
  | "account_label"
  | "secret_last_four"
  | "signing_secret_last_four"
  | "endpoint_url"
  | "settings"
  | "availability"
  | "availability_confirmed_at"
  | "last_checked_at"
  | "last_check_ok"
  | "last_check_summary"
  | "created_at"
>;

export function toConnectionSummary(row: SummaryRow): ConnectionSummary {
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    statusMessage: row.status_message,
    accountLabel: row.account_label,
    secretLastFour: row.secret_last_four,
    signingSecretLastFour: row.signing_secret_last_four,
    endpointUrl: row.endpoint_url,
    settings: asObject(row.settings),
    availability: row.availability ? asObject(row.availability) : null,
    availabilityConfirmedAt: row.availability_confirmed_at,
    lastCheckedAt: row.last_checked_at,
    lastCheckOk: row.last_check_ok,
    lastCheckSummary: row.last_check_summary,
    createdAt: row.created_at
  };
}

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /relation .*connections.* does not exist/i.test(error.message ?? "");
}

/** [] when the table is missing (migration 0029 not applied yet). */
export async function listConnections(tenantId: string): Promise<ConnectionSummary[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connections")
    .select(CONNECTION_SUMMARY_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });
  if (isMissingTable(error)) return [];
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as SummaryRow[]).map(toConnectionSummary);
}

export async function getConnectionSummary(tenantId: string, id: string): Promise<ConnectionSummary | null> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connections")
    .select(CONNECTION_SUMMARY_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(error)) return null;
  if (error) throw new Error(error.message);
  return data ? toConnectionSummary(data as unknown as SummaryRow) : null;
}

/** Server-only full row with ciphertext, for adapters. Never pass it to UI code. */
export async function getConnectionRowForTenant(tenantId: string, id: string): Promise<ConnectionRow | null> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connections")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (isMissingTable(error)) return null;
  if (error) throw new Error(error.message);
  return (data as ConnectionRow | null) ?? null;
}

/**
 * Server-only, NOT tenant-scoped: only for an inbound provider webhook whose
 * address names the connection (the row then supplies the tenant, and the
 * caller must verify the provider signature before acting on anything).
 */
export async function getConnectionRowForWebhook(id: string, provider: GenericProvider): Promise<ConnectionRow | null> {
  if (!isUuid(id)) return null;
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("connections").select("*").eq("id", id).eq("provider", provider).maybeSingle();
  if (isMissingTable(error)) return null;
  if (error) throw new Error(error.message);
  return (data as ConnectionRow | null) ?? null;
}

export async function renameConnection(tenantId: string, id: string, name: string): Promise<void> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) throw new Error("Please enter a name.");
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("connections")
    .update({ name: trimmed })
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(CONNECTIONS_COPY.notFound);
}

/** Switching back on sets `connected` only when it was `disabled`. */
export async function setConnectionDisabled(tenantId: string, id: string, disabled: boolean): Promise<void> {
  const supabase = createServiceClient();
  const query = disabled
    ? supabase.from("connections").update({ status: "disabled" }).eq("tenant_id", tenantId).eq("id", id)
    : supabase
        .from("connections")
        .update({ status: "connected", status_message: null })
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .eq("status", "disabled");
  const { error } = await query;
  if (error) throw new Error(error.message);
}

/** Runtime status change. The caller loaded the row tenant-scoped first. */
export async function markConnectionStatus(id: string, status: ConnectionStatus, message: string | null): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("connections")
    .update({ status, status_message: message ? message.slice(0, 300) : null })
    .eq("id", id)
    .neq("status", "disabled");
  if (error) throw new Error(error.message);
}

export async function recordConnectionCheck(id: string, ok: boolean, summary: string): Promise<void> {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("connections")
    .update({ last_checked_at: new Date().toISOString(), last_check_ok: ok, last_check_summary: summary.slice(0, 500) })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Active forms of this tenant that use the connection (generic columns, or ghl_connection_id). */
export async function listActiveFormsUsingConnection(
  tenantId: string,
  id: string,
  kind: "generic" | "ghl"
): Promise<Array<{ id: string; name: string }>> {
  // The id goes into a filter expression: only a real uuid is accepted.
  if (!isUuid(id)) return [];
  const supabase = createServiceClient();
  let query = supabase.from("funnels").select("id,name").eq("tenant_id", tenantId).eq("is_published", true);
  query = kind === "ghl" ? query.eq("ghl_connection_id", id) : query.or(`calendar_connection_id.eq.${id},crm_connection_id.eq.${id}`);
  const { data, error } = await query.order("name", { ascending: true });
  if (error) {
    // Before migration 0029 no form can use a generic connection.
    if (kind === "generic" && error.code === "42703") return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string }));
}

/** Every form of this tenant (active or not) that uses a generic connection. */
export async function listFormsUsingConnection(
  tenantId: string,
  id: string
): Promise<Array<{ id: string; name: string; isPublished: boolean }>> {
  if (!isUuid(id)) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("id,name,is_published")
    .eq("tenant_id", tenantId)
    .or(`calendar_connection_id.eq.${id},crm_connection_id.eq.${id}`)
    .order("name", { ascending: true });
  if (error) {
    if (error.code === "42703") return [];
    throw new Error(error.message);
  }
  return (data ?? []).map((row) => ({ id: row.id as string, name: row.name as string, isPublished: Boolean(row.is_published) }));
}

export type FormConnectionRow = {
  id: string;
  ghl_connection_id: string | null;
  calendar_id: string | null;
  calendar_provider?: CalendarKind;
  calendar_connection_id?: string | null;
  crm_provider?: CrmKind;
  crm_connection_id?: string | null;
};

/**
 * The connection columns of every form of this tenant, for "Used by {n}
 * forms" on the Connections page. Before migration 0029 only the GoHighLevel
 * column exists.
 */
export async function listFormConnectionColumns(tenantId: string): Promise<FormConnectionRow[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("funnels")
    .select("id,ghl_connection_id,calendar_id,calendar_provider,calendar_connection_id,crm_provider,crm_connection_id")
    .eq("tenant_id", tenantId);
  if (!error) return (data ?? []) as FormConnectionRow[];
  if (error.code !== "42703") throw new Error(error.message);
  const legacy = await supabase.from("funnels").select("id,ghl_connection_id,calendar_id").eq("tenant_id", tenantId);
  if (legacy.error) throw new Error(legacy.error.message);
  return (legacy.data ?? []) as FormConnectionRow[];
}

/**
 * Refused while an Active form uses it (decision C9). `beforeDelete` (token
 * revocation, webhook cleanup) is best effort and never blocks the delete.
 */
export async function deleteConnection(
  tenantId: string,
  id: string,
  beforeDelete?: (row: ConnectionRow) => Promise<void>
): Promise<void> {
  const row = await getConnectionRowForTenant(tenantId, id);
  if (!row) throw new Error(CONNECTIONS_COPY.notFound);

  const activeForms = await listActiveFormsUsingConnection(tenantId, id, "generic");
  if (activeForms.length) throw new Error(CONNECTIONS_COPY.deleteBlocked(activeForms.map((form) => form.name)));

  if (beforeDelete) {
    try {
      await beforeDelete(row);
    } catch (error) {
      console.error("[connections] cleanup failed", row.provider, error instanceof Error ? error.name : "unknown");
    }
  }

  const supabase = createServiceClient();
  const { error } = await supabase.from("connections").delete().eq("tenant_id", tenantId).eq("id", id);
  if (error) throw new Error(error.message);
}

/** Maps the connection trigger errors (migration 0029) to user messages. */
export function connectionMessageFromError(message: string): string | null {
  if (message.includes("FORMBOOK_LIMIT:connections")) return CONNECTIONS_COPY.connectionLimit;
  if (message.includes("FORMBOOK_INVALID:calendar_connection") || message.includes("FORMBOOK_INVALID:crm_connection")) {
    return CONNECTIONS_COPY.foreignConnection;
  }
  return null;
}
