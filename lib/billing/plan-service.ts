import {
  PLANS,
  SUSPENDED_MESSAGE,
  checkFormLimit,
  parsePlanState,
  planLimitMessageFromError,
  type FormLimitAction,
  type FormUsage,
  type PlanDefinition,
  type PlanState
} from "@/lib/billing/plans";
import { createServiceClient } from "@/lib/supabase/server";

export async function getTenantPlanState(tenantId: string): Promise<PlanState> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("tenants").select("plan").eq("id", tenantId).single();

  if (error) throw new Error(error.message);
  return parsePlanState(data.plan);
}

/** Throws the suspended message for a suspended tenant. */
export async function getTenantPlan(tenantId: string): Promise<PlanDefinition> {
  const state = await getTenantPlanState(tenantId);
  if (state === "suspended") throw new Error(SUSPENDED_MESSAGE);
  return PLANS[state];
}

export async function isTenantSuspended(tenantId: string): Promise<boolean> {
  return (await getTenantPlanState(tenantId)) === "suspended";
}

/** Counts the tenant's active and draft forms, optionally leaving one form out. */
export async function getTenantFormUsage(tenantId: string, excludeFunnelId?: string): Promise<FormUsage> {
  const supabase = createServiceClient();

  const countForms = async (published: boolean) => {
    let query = supabase
      .from("funnels")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_published", published);
    if (excludeFunnelId) query = query.neq("id", excludeFunnelId);
    const { count, error } = await query;
    if (error) throw new Error(error.message);
    return count ?? 0;
  };

  const [activeForms, draftForms] = await Promise.all([countForms(true), countForms(false)]);
  return { activeForms, draftForms };
}

/**
 * Friendly pre-check before a create, activate or duplicate. The database
 * trigger (migration 0020) is the authority and also blocks races.
 */
export async function assertFormLimit(
  tenantId: string,
  action: FormLimitAction,
  excludeFunnelId?: string
): Promise<void> {
  if (action === "deactivate") return;
  const [state, usage] = await Promise.all([
    getTenantPlanState(tenantId),
    getTenantFormUsage(tenantId, excludeFunnelId)
  ]);
  const result = checkFormLimit(state, usage, action);
  if (!result.allowed) throw new Error(result.message);
}

export async function getTenantPlanSummary(
  tenantId: string
): Promise<{ state: PlanState; plan: PlanDefinition | null; usage: FormUsage }> {
  const [state, usage] = await Promise.all([getTenantPlanState(tenantId), getTenantFormUsage(tenantId)]);
  return { state, plan: state === "suspended" ? null : PLANS[state], usage };
}

/**
 * Turns a database trigger error ("FORMBOOK_LIMIT:<reason>") into the user
 * message for this tenant's plan. Returns null when the error is unrelated.
 */
export async function planLimitMessageForTenant(message: string, tenantId: string): Promise<string | null> {
  if (!planLimitMessageFromError(message)) return null;
  let state: PlanState | undefined;
  try {
    state = await getTenantPlanState(tenantId);
  } catch {
    state = undefined;
  }
  return planLimitMessageFromError(message, state);
}
