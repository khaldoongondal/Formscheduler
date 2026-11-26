import { unstable_noStore as noStore } from "next/cache";
import { parsePlanState, type PlanState } from "@/lib/billing/plans";
import { setFunnelTakedown } from "@/lib/funnels/takedown";
import {
  ownerOptionalReasonSchema,
  ownerPlanSchema,
  ownerReportStatusSchema,
  ownerRequiredReasonSchema,
  ownerUuidSchema
} from "@/lib/owner/format";
import { createServiceClient } from "@/lib/supabase/server";
import type { FormReport, Funnel, Json, OwnerAuditAction, OwnerClientListRow, Tenant } from "@/lib/types/database";

/**
 * Platform-owner operations. Callers must have passed requirePlatformOwner()
 * first; this module trusts its `actor` argument and writes it to the audit log.
 */

export type ClientRow = {
  tenantId: string;
  tenantName: string;
  businessName: string | null;
  contactName: string | null;
  contactEmail: string | null;
  ownerEmail: string | null;
  plan: PlanState;
  badgeEnabled: boolean;
  activeForms: number;
  draftForms: number;
  leads30d: number;
  openReports: number;
  lastActivityAt: string | null;
  createdAt: string;
};

export type ClientForm = Pick<
  Funnel,
  "id" | "name" | "slug" | "is_published" | "taken_down_at" | "taken_down_reason" | "updated_at"
>;

export type OpenReport = FormReport & { funnel_name: string | null; tenant_name: string | null };

const OPEN_REPORTS_LIMIT = 100;

function toClientRow(row: OwnerClientListRow): ClientRow {
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    businessName: row.business_name,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    ownerEmail: row.owner_email,
    plan: parsePlanState(row.plan),
    badgeEnabled: row.badge_enabled !== false,
    activeForms: Number(row.active_forms ?? 0),
    draftForms: Number(row.draft_forms ?? 0),
    leads30d: Number(row.leads_30d ?? 0),
    openReports: Number(row.open_reports ?? 0),
    lastActivityAt: row.last_activity_at,
    createdAt: row.created_at
  };
}

async function writeAudit(
  actor: string,
  action: OwnerAuditAction,
  targetType: "tenant" | "funnel" | "report",
  targetId: string,
  details: Record<string, Json | undefined> = {}
) {
  const supabase = createServiceClient();
  const cleanDetails: Record<string, Json> = {};
  for (const [key, value] of Object.entries(details)) {
    if (value !== undefined) cleanDetails[key] = value;
  }
  const { error } = await supabase.from("owner_audit_log").insert({
    actor_email: actor.slice(0, 254),
    action,
    target_type: targetType,
    target_id: targetId,
    details: cleanDetails
  });
  if (error) {
    // The change itself is saved; a missing audit row is logged for follow-up.
    console.error("[owner] audit log write failed:", action, error.message);
  }
}

export async function listClients(): Promise<ClientRow[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("owner_list_clients");
  if (error) throw new Error(error.message);
  return ((data ?? []) as OwnerClientListRow[]).map(toClientRow);
}

export async function getClientDetail(
  tenantIdInput: string
): Promise<{ client: ClientRow; tenant: Tenant; forms: ClientForm[] } | null> {
  noStore();
  const parsedId = ownerUuidSchema.safeParse(tenantIdInput);
  if (!parsedId.success) return null;
  const tenantId = parsedId.data;
  const supabase = createServiceClient();

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", tenantId)
    .maybeSingle();
  if (tenantError) throw new Error(tenantError.message);
  if (!tenant) return null;

  const [clients, formsResult] = await Promise.all([
    listClients(),
    supabase
      .from("funnels")
      .select("id,name,slug,is_published,taken_down_at,taken_down_reason,updated_at")
      .eq("tenant_id", tenantId)
      .order("updated_at", { ascending: false })
  ]);
  if (formsResult.error) throw new Error(formsResult.error.message);

  const client = clients.find((row) => row.tenantId === tenantId);
  if (!client) return null;

  return { client, tenant: tenant as Tenant, forms: (formsResult.data ?? []) as ClientForm[] };
}

export async function listOpenReports(): Promise<OpenReport[]> {
  noStore();
  const supabase = createServiceClient();
  const { data: reports, error } = await supabase
    .from("form_reports")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(OPEN_REPORTS_LIMIT);
  if (error) throw new Error(error.message);
  if (!reports || reports.length === 0) return [];

  const funnelIds = Array.from(new Set(reports.map((report) => report.funnel_id).filter((id): id is string => Boolean(id))));
  const tenantIds = Array.from(new Set(reports.map((report) => report.tenant_id).filter((id): id is string => Boolean(id))));

  const [funnelsResult, tenantsResult] = await Promise.all([
    funnelIds.length
      ? supabase.from("funnels").select("id,name").in("id", funnelIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }>, error: null }),
    tenantIds.length
      ? supabase.from("tenants").select("id,name,business_name").in("id", tenantIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string; business_name: string | null }>, error: null })
  ]);
  if (funnelsResult.error) throw new Error(funnelsResult.error.message);
  if (tenantsResult.error) throw new Error(tenantsResult.error.message);

  const funnelNames = new Map((funnelsResult.data ?? []).map((row) => [row.id, row.name]));
  const tenantNames = new Map((tenantsResult.data ?? []).map((row) => [row.id, row.business_name || row.name]));

  return (reports as FormReport[]).map((report) => ({
    ...report,
    funnel_name: report.funnel_id ? funnelNames.get(report.funnel_id) ?? null : null,
    tenant_name: report.tenant_id ? tenantNames.get(report.tenant_id) ?? null : null
  }));
}

async function loadTenantPlan(tenantId: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id,plan,suspended_at")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found.");
  return { plan: parsePlanState(data.plan), suspendedAt: data.suspended_at as string | null };
}

export async function setTenantPlan(actor: string, tenantIdInput: string, planInput: PlanState): Promise<void> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const plan = ownerPlanSchema.parse(planInput);
  if (plan === "suspended") {
    await suspendTenant(actor, tenantId);
    return;
  }

  const previous = await loadTenantPlan(tenantId);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("tenants")
    .update({ plan, plan_before_suspension: null, suspended_at: null, suspension_reason: null })
    .eq("id", tenantId);
  if (error) throw new Error(error.message);
  await writeAudit(actor, "set_plan", "tenant", tenantId, { from: previous.plan, to: plan });
}

export async function setTenantBadge(actor: string, tenantIdInput: string, enabled: boolean): Promise<void> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .update({ badge_enabled: enabled === true })
    .eq("id", tenantId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Client not found.");
  await writeAudit(actor, "set_badge", "tenant", tenantId, { enabled: enabled === true });
}

export async function suspendTenant(actor: string, tenantIdInput: string, reasonInput?: string): Promise<void> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const reason = ownerOptionalReasonSchema.parse(reasonInput);
  const current = await loadTenantPlan(tenantId);
  const supabase = createServiceClient();

  const update =
    current.plan === "suspended"
      ? // Already suspended: keep the saved plan and the original date, update the reason.
        { suspension_reason: reason ?? null, suspended_at: current.suspendedAt ?? new Date().toISOString() }
      : {
          plan: "suspended" as const,
          plan_before_suspension: current.plan,
          suspended_at: new Date().toISOString(),
          suspension_reason: reason ?? null
        };

  const { error } = await supabase.from("tenants").update(update).eq("id", tenantId);
  if (error) throw new Error(error.message);
  await writeAudit(actor, "suspend", "tenant", tenantId, { from: current.plan, reason: reason ?? null });
}

export async function restoreTenant(actor: string, tenantIdInput: string): Promise<void> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const supabase = createServiceClient();
  const { data, error: readError } = await supabase
    .from("tenants")
    .select("id,plan,plan_before_suspension")
    .eq("id", tenantId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!data) throw new Error("Client not found.");

  const savedPlan = data.plan_before_suspension === "scaling" ? "scaling" : "free";
  const restoredPlan = parsePlanState(data.plan) === "suspended" ? savedPlan : parsePlanState(data.plan);
  const { error } = await supabase
    .from("tenants")
    .update({ plan: restoredPlan, plan_before_suspension: null, suspended_at: null, suspension_reason: null })
    .eq("id", tenantId);
  if (error) throw new Error(error.message);
  await writeAudit(actor, "restore", "tenant", tenantId, { to: restoredPlan });
}

export async function takeDownForm(actor: string, funnelIdInput: string, reasonInput: string): Promise<void> {
  const funnelId = ownerUuidSchema.parse(funnelIdInput);
  const reason = ownerRequiredReasonSchema.parse(reasonInput);
  await setFunnelTakedown(funnelId, true, reason);

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("form_reports")
    .update({ status: "actioned", resolved_at: new Date().toISOString(), resolved_by: actor.slice(0, 254) })
    .eq("funnel_id", funnelId)
    .eq("status", "open");
  if (error) console.error("[owner] marking reports actioned failed:", error.message);

  await writeAudit(actor, "take_down_form", "funnel", funnelId, { reason });
}

export async function restoreForm(actor: string, funnelIdInput: string): Promise<void> {
  const funnelId = ownerUuidSchema.parse(funnelIdInput);
  await setFunnelTakedown(funnelId, false);
  await writeAudit(actor, "restore_form", "funnel", funnelId);
}

export async function resolveReport(
  actor: string,
  reportIdInput: string,
  statusInput: "actioned" | "dismissed"
): Promise<void> {
  const reportId = ownerUuidSchema.parse(reportIdInput);
  const status = ownerReportStatusSchema.parse(statusInput);
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("form_reports")
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: actor.slice(0, 254) })
    .eq("id", reportId)
    .select("id");
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Report not found.");
  await writeAudit(actor, "resolve_report", "report", reportId, { status });
}
