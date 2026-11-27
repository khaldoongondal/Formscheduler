import { unstable_noStore as noStore } from "next/cache";
import { normalizeAccountRef } from "@/lib/billing/account-ref";
import type { FormActivity, PixelActivity } from "@/lib/billing/freeze";
import {
  applyPlanChange,
  loadFormActivity,
  loadPixelActivity,
  type AppliedPlanChange
} from "@/lib/billing/plan-change-service";
import { resolveOwnerPlanChange, type OwnerPlanRequest } from "@/lib/billing/plan-transitions";
import { parsePlanState, type PlanState } from "@/lib/billing/plans";
import type { TenantPlanFields } from "@/lib/provisioning/plan-change";
import { setFunnelTakedown } from "@/lib/funnels/takedown";
import { toActivationRow, type ActivationRow } from "@/lib/owner/activation";
import {
  ownerOptionalReasonSchema,
  ownerPlanSchema,
  ownerReportStatusSchema,
  ownerRequiredReasonSchema,
  ownerUuidSchema
} from "@/lib/owner/format";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  FormReport,
  Funnel,
  Json,
  OwnerActivationRow,
  OwnerAuditAction,
  OwnerClientListRow,
  Tenant,
  TenantPlanChange
} from "@/lib/types/database";

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
> & { frozen_at: string | null };

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

export type ClientDetail = {
  client: ClientRow;
  tenant: Tenant;
  forms: ClientForm[];
  /** For the downgrade freeze preview (empty before migration 0032). */
  formActivity: FormActivity[];
  pixelActivity: PixelActivity[];
  accountRef: string | null;
};

const CLIENT_FORM_COLUMNS = "id,name,slug,is_published,taken_down_at,taken_down_reason,updated_at";

async function loadClientForms(tenantId: string): Promise<ClientForm[]> {
  const supabase = createServiceClient();
  const withFrozen = await supabase
    .from("funnels")
    .select(`${CLIENT_FORM_COLUMNS},frozen_at`)
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (!withFrozen.error) {
    return ((withFrozen.data ?? []) as unknown as ClientForm[]).map((form) => ({ ...form, frozen_at: form.frozen_at ?? null }));
  }
  if (withFrozen.error.code !== "42703") throw new Error(withFrozen.error.message);
  // Before migration 0032: no form is frozen.
  const fallback = await supabase
    .from("funnels")
    .select(CLIENT_FORM_COLUMNS)
    .eq("tenant_id", tenantId)
    .order("updated_at", { ascending: false });
  if (fallback.error) throw new Error(fallback.error.message);
  return ((fallback.data ?? []) as unknown as Omit<ClientForm, "frozen_at">[]).map((form) => ({ ...form, frozen_at: null }));
}

export async function getClientDetail(tenantIdInput: string): Promise<ClientDetail | null> {
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

  const [clients, forms, formActivity, pixelActivity] = await Promise.all([
    listClients(),
    loadClientForms(tenantId),
    loadFormActivity(tenantId).catch((error: unknown): FormActivity[] => {
      console.error("[owner] form activity read failed:", error instanceof Error ? error.message : "unknown error");
      return [];
    }),
    loadPixelActivity(tenantId).catch((error: unknown): PixelActivity[] => {
      console.error("[owner] pixel activity read failed:", error instanceof Error ? error.message : "unknown error");
      return [];
    })
  ]);

  const client = clients.find((row) => row.tenantId === tenantId);
  if (!client) return null;

  return {
    client,
    tenant: tenant as Tenant,
    forms,
    formActivity,
    pixelActivity,
    accountRef: normalizeAccountRef((tenant as Tenant).account_ref)
  };
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

async function loadTenantPlanFields(tenantId: string): Promise<TenantPlanFields> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("id,plan,plan_before_suspension,suspended_at,suspension_reason")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Client not found.");
  return {
    plan: parsePlanState(data.plan),
    plan_before_suspension: data.plan_before_suspension ?? null,
    suspended_at: data.suspended_at ?? null,
    suspension_reason: data.suspension_reason ?? null
  };
}

/** Freeze and restore counts for the audit log details. */
function changeDetails(change: AppliedPlanChange): Record<string, Json> {
  return {
    frozen_forms: change.frozenForms,
    frozen_pixels: change.frozenPixels,
    restored_forms: change.restoredForms,
    restored_pixels: change.restoredPixels,
    ended_split_tests: change.endedSplitTests
  };
}

function ownerChange(actor: string, tenantId: string, request: OwnerPlanRequest, note: string | null) {
  return applyPlanChange({
    tenantId,
    resolve: (current) => resolveOwnerPlanChange(current, request, new Date().toISOString()),
    source: "owner",
    actor,
    note
  });
}

export async function setTenantPlan(actor: string, tenantIdInput: string, planInput: PlanState): Promise<AppliedPlanChange> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const plan = ownerPlanSchema.parse(planInput);
  if (plan === "suspended") {
    return suspendTenant(actor, tenantId);
  }

  const change = await ownerChange(actor, tenantId, { kind: "set", plan }, null);
  await writeAudit(actor, "set_plan", "tenant", tenantId, { from: change.from, to: plan, ...changeDetails(change) });
  return change;
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

export async function suspendTenant(actor: string, tenantIdInput: string, reasonInput?: string): Promise<AppliedPlanChange> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const reason = ownerOptionalReasonSchema.parse(reasonInput) ?? null;
  const current = await loadTenantPlanFields(tenantId);

  const resolution = resolveOwnerPlanChange(current, { kind: "suspend", reason }, new Date().toISOString());
  if (resolution.reasonOnly) {
    // Already suspended: keep the saved plan and the original date, update the reason (no history row).
    const supabase = createServiceClient();
    const { error } = await supabase.from("tenants").update(resolution.update ?? {}).eq("id", tenantId);
    if (error) throw new Error(error.message);
    await writeAudit(actor, "suspend", "tenant", tenantId, { from: current.plan, reason });
    return {
      changed: false,
      historyId: null,
      from: "suspended",
      to: "suspended",
      frozenForms: 0,
      frozenPixels: 0,
      restoredForms: 0,
      restoredPixels: 0,
      endedSplitTests: 0
    };
  }

  const change = await ownerChange(actor, tenantId, { kind: "suspend", reason }, reason);
  await writeAudit(actor, "suspend", "tenant", tenantId, { from: change.from, reason, ...changeDetails(change) });
  return change;
}

export async function restoreTenant(actor: string, tenantIdInput: string): Promise<AppliedPlanChange> {
  const tenantId = ownerUuidSchema.parse(tenantIdInput);
  const change = await ownerChange(actor, tenantId, { kind: "restore" }, null);
  await writeAudit(actor, "restore", "tenant", tenantId, { to: change.to, ...changeDetails(change) });
  return change;
}

export type PlanHistoryRow = {
  id: string;
  fromPlan: PlanState | null;
  toPlan: PlanState;
  source: "provision" | "owner";
  actor: string | null;
  note: string | null;
  frozenForms: number;
  frozenPixels: number;
  restoredForms: number;
  restoredPixels: number;
  endedSplitTests: number;
  createdAt: string;
};

/** Plan changes of one client, newest first. Owner pages only; empty when the table is missing. */
export async function listPlanHistory(tenantIdInput: string, limit = 50): Promise<PlanHistoryRow[]> {
  noStore();
  const parsedId = ownerUuidSchema.safeParse(tenantIdInput);
  if (!parsedId.success) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenant_plan_changes")
    .select("id,from_plan,to_plan,source,actor,note,frozen_forms,frozen_pixels,restored_forms,restored_pixels,ended_split_tests,created_at")
    .eq("tenant_id", parsedId.data)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, Math.floor(limit))));
  if (error) {
    console.error("[owner] plan history read failed:", error.code ?? "error");
    return [];
  }
  return ((data ?? []) as unknown as TenantPlanChange[]).map((row) => ({
    id: row.id,
    fromPlan: row.from_plan ? parsePlanState(row.from_plan) : null,
    toPlan: parsePlanState(row.to_plan),
    source: row.source === "owner" ? "owner" : "provision",
    actor: row.actor ?? null,
    note: row.note ?? null,
    frozenForms: Number(row.frozen_forms ?? 0),
    frozenPixels: Number(row.frozen_pixels ?? 0),
    restoredForms: Number(row.restored_forms ?? 0),
    restoredPixels: Number(row.restored_pixels ?? 0),
    endedSplitTests: Number(row.ended_split_tests ?? 0),
    createdAt: row.created_at
  }));
}

/** Every tenant's milestones for the activation funnel. Empty when migration 0034 is missing. */
export async function listActivationRows(): Promise<ActivationRow[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("owner_activation_rows");
  if (error) {
    console.error("[owner] activation rows read failed:", error.code ?? "error");
    return [];
  }
  return ((data ?? []) as OwnerActivationRow[]).map(toActivationRow);
}

/** Signup dates of requests not verified yet. Empty when migration 0034 is missing. */
export async function listPendingSignupDates(): Promise<string[]> {
  noStore();
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("owner_pending_signups");
  if (error) {
    console.error("[owner] pending signups read failed:", error.code ?? "error");
    return [];
  }
  return ((data ?? []) as Array<{ created_at: string | null }>)
    .map((row) => row.created_at)
    .filter((value): value is string => typeof value === "string");
}

export { getLifecycleStatus } from "@/lib/lifecycle/queue";

export type ClientMilestones = {
  createdAt: string | null;
  accountRef: string | null;
  firstConnectionAt: string | null;
  firstFormActivatedAt: string | null;
  firstLeadAt: string | null;
  firstBookingAt: string | null;
};

const EMPTY_MILESTONES: ClientMilestones = {
  createdAt: null,
  accountRef: null,
  firstConnectionAt: null,
  firstFormActivatedAt: null,
  firstLeadAt: null,
  firstBookingAt: null
};

/** One client's milestones. Nulls when migration 0034 is missing. */
export async function getClientMilestones(tenantIdInput: string): Promise<ClientMilestones> {
  noStore();
  const parsedId = ownerUuidSchema.safeParse(tenantIdInput);
  if (!parsedId.success) return EMPTY_MILESTONES;
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("created_at,account_ref,first_connection_at,first_form_activated_at,first_lead_at,first_booking_at")
    .eq("id", parsedId.data)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error("[owner] milestones read failed:", error.code ?? "error");
    return EMPTY_MILESTONES;
  }
  const row = data as Partial<Tenant>;
  return {
    createdAt: row.created_at ?? null,
    accountRef: normalizeAccountRef(row.account_ref),
    firstConnectionAt: row.first_connection_at ?? null,
    firstFormActivatedAt: row.first_form_activated_at ?? null,
    firstLeadAt: row.first_lead_at ?? null,
    firstBookingAt: row.first_booking_at ?? null
  };
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
