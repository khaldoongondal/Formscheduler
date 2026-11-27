/**
 * Resolves a form's calendar and CRM adapters with their context (P1.8).
 * Rows are always loaded with the form's own tenant. Switched-off and
 * needs-attention connections resolve to null.
 */
import { ADAPTERS } from "@/lib/connections/adapters";
import { getConnectionRowForTenant } from "@/lib/connections/service";
import type { CalendarKind, CalendarProvider, CrmKind, CrmProvider } from "@/lib/connections/types";
import { getGhlConnectionForTenant } from "@/lib/ghl/connections";
import type { Funnel } from "@/lib/types/database";

export type ResolvedCalendar = {
  provider: CalendarProvider<unknown>;
  ctx: unknown;
  connectionId: string | null;
  kind: CalendarKind;
};

export type ResolvedCrm = {
  provider: CrmProvider<unknown>;
  ctx: unknown;
  kind: CrmKind;
  connectionId: string | null;
  ghlConnectionId: string | null;
};

export function calendarKindOf(funnel: Pick<Funnel, "calendar_provider">): CalendarKind {
  return (funnel.calendar_provider ?? "ghl") as CalendarKind;
}

export function crmKindOf(funnel: Pick<Funnel, "crm_provider">): CrmKind {
  return (funnel.crm_provider ?? "ghl") as CrmKind;
}

export async function resolveCalendar(funnel: Funnel): Promise<ResolvedCalendar | null> {
  const kind = calendarKindOf(funnel);
  const entry = ADAPTERS[kind];
  if (!entry?.calendar || !entry.calendarContext) return null;

  if (kind === "ghl") {
    if (!funnel.ghl_connection_id) return null;
    const connection = await getGhlConnectionForTenant(funnel.ghl_connection_id, funnel.tenant_id);
    if (!connection || !connection.is_active) return null;
    const ctx = await entry.calendarContext(connection, funnel);
    return ctx ? { provider: entry.calendar, ctx, connectionId: null, kind } : null;
  }

  if (!funnel.calendar_connection_id) return null;
  const row = await getConnectionRowForTenant(funnel.tenant_id, funnel.calendar_connection_id);
  if (!row || row.provider !== kind || row.status !== "connected") return null;
  const ctx = await entry.calendarContext(row, funnel);
  return ctx ? { provider: entry.calendar, ctx, connectionId: row.id, kind } : null;
}

export async function resolveCrm(funnel: Funnel): Promise<ResolvedCrm | null> {
  const kind = crmKindOf(funnel);
  const entry = ADAPTERS[kind];
  if (!entry?.crm || !entry.crmContext) return null;

  if (kind === "ghl") {
    if (!funnel.ghl_connection_id) return null;
    const connection = await getGhlConnectionForTenant(funnel.ghl_connection_id, funnel.tenant_id);
    if (!connection || !connection.is_active) return null;
    const ctx = await entry.crmContext(connection, funnel);
    return ctx ? { provider: entry.crm, ctx, kind, connectionId: null, ghlConnectionId: connection.id } : null;
  }

  if (!funnel.crm_connection_id) return null;
  const row = await getConnectionRowForTenant(funnel.tenant_id, funnel.crm_connection_id);
  if (!row || row.provider !== kind || row.status !== "connected") return null;
  const ctx = await entry.crmContext(row, funnel);
  return ctx ? { provider: entry.crm, ctx, kind, connectionId: row.id, ghlConnectionId: null } : null;
}
