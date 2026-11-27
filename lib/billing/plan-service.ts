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
import { normalizeAccountRef } from "@/lib/billing/account-ref";
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

/**
 * Counts the tenant's active and draft forms, optionally leaving one form out.
 * Frozen forms (migration 0032) are not drafts; before 0032 every unpublished
 * form counts as a draft.
 */
export async function getTenantFormUsage(tenantId: string, excludeFunnelId?: string): Promise<FormUsage> {
  const supabase = createServiceClient();

  const countForms = async (published: boolean, skipFrozen: boolean) => {
    let query = supabase
      .from("funnels")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("is_published", published);
    if (skipFrozen) query = query.is("frozen_at", null);
    if (excludeFunnelId) query = query.neq("id", excludeFunnelId);
    const { count, error } = await query;
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return count ?? 0;
  };

  const countDrafts = async () => {
    try {
      return await countForms(false, true);
    } catch (error) {
      if ((error as { code?: string }).code === "42703") return countForms(false, false);
      throw error;
    }
  };

  const [activeForms, draftForms] = await Promise.all([countForms(true, false), countDrafts()]);
  return { activeForms, draftForms };
}

/** Frozen forms and pixels of the tenant; zeros when migration 0032 is not applied yet. */
export async function countFrozen(tenantId: string): Promise<{ forms: number; pixels: number }> {
  const supabase = createServiceClient();
  const count = async (table: "funnels" | "meta_pixels") => {
    try {
      const { count: value, error } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .not("frozen_at", "is", null);
      if (error) return 0;
      return value ?? 0;
    } catch {
      return 0;
    }
  };
  const [forms, pixels] = await Promise.all([count("funnels"), count("meta_pixels")]);
  return { forms, pixels };
}

/** The tenant's opaque account reference, or null before migration 0032. */
export async function getTenantAccountRef(tenantId: string): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("tenants").select("account_ref").eq("id", tenantId).maybeSingle();
    if (error || !data) return null;
    return normalizeAccountRef((data as { account_ref?: unknown }).account_ref);
  } catch {
    return null;
  }
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

export type TenantPlanSummary = {
  state: PlanState;
  plan: PlanDefinition | null;
  usage: FormUsage;
  /** Every Meta pixel, frozen ones included (null when the table is missing). */
  pixelCount: number | null;
  /** Pixels that are not frozen: what the pixel limit counts (null when the table is missing). */
  unfrozenPixelCount: number | null;
  frozen: { forms: number; pixels: number };
  accountRef: string | null;
};

export async function getTenantPlanSummary(tenantId: string): Promise<TenantPlanSummary> {
  const [state, usage, pixelCount, frozen, accountRef] = await Promise.all([
    getTenantPlanState(tenantId),
    getTenantFormUsage(tenantId),
    countTenantPixels(tenantId),
    countFrozen(tenantId),
    getTenantAccountRef(tenantId)
  ]);
  const unfrozenPixelCount = pixelCount === null ? null : Math.max(0, pixelCount - frozen.pixels);
  return {
    state,
    plan: state === "suspended" ? null : PLANS[state],
    usage,
    pixelCount,
    unfrozenPixelCount,
    frozen,
    accountRef
  };
}

/** Meta pixels of the tenant; null when the table is missing (migration 0027 not run yet). */
export async function countTenantPixels(tenantId: string): Promise<number | null> {
  try {
    const supabase = createServiceClient();
    const { count, error } = await supabase
      .from("meta_pixels")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
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
