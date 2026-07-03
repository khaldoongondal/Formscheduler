import { createServiceClient } from "@/lib/supabase/server";

export type PlanId = "tier1" | "tier2" | "tier3";

export type PlanLimits = {
  id: PlanId;
  name: string;
  monthlyPriceUsd: number;
  /** null = unlimited */
  maxFunnels: number | null;
  /** null = unlimited */
  maxCalendars: number | null;
};

export const PLANS: Record<PlanId, PlanLimits> = {
  tier1: {
    id: "tier1",
    name: "Starter",
    monthlyPriceUsd: 50,
    maxFunnels: 1,
    maxCalendars: 1
  },
  tier2: {
    id: "tier2",
    name: "Growth",
    monthlyPriceUsd: 150,
    maxFunnels: 3,
    maxCalendars: 3
  },
  tier3: {
    id: "tier3",
    name: "Scale",
    monthlyPriceUsd: 300,
    maxFunnels: null,
    maxCalendars: null
  }
};

export type PlanState = PlanId | "suspended";

export function isPlanId(value: unknown): value is PlanId {
  return value === "tier1" || value === "tier2" || value === "tier3";
}

export async function getTenantPlanState(tenantId: string): Promise<PlanState> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("tenants")
    .select("plan")
    .eq("id", tenantId)
    .single();

  if (error) throw new Error(error.message);
  if (data.plan === "suspended") return "suspended";
  return isPlanId(data.plan) ? data.plan : "tier1";
}

const SUSPENDED_MESSAGE =
  "This account is suspended. Renew your subscription to keep using Leadder Scheduler.";

export async function getTenantPlan(tenantId: string): Promise<PlanLimits> {
  const state = await getTenantPlanState(tenantId);
  if (state === "suspended") {
    throw new Error(SUSPENDED_MESSAGE);
  }
  return PLANS[state];
}

export async function isTenantSuspended(tenantId: string) {
  return (await getTenantPlanState(tenantId)) === "suspended";
}

export async function assertCanCreateFunnel(tenantId: string) {
  const plan = await getTenantPlan(tenantId);
  if (plan.maxFunnels === null) return;

  const supabase = createServiceClient();
  const { count, error } = await supabase
    .from("funnels")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  if ((count ?? 0) >= plan.maxFunnels) {
    throw new Error(
      `Your ${plan.name} plan allows ${plan.maxFunnels} form${plan.maxFunnels === 1 ? "" : "s"}. ` +
        "Upgrade your plan to add more forms."
    );
  }
}

/**
 * Enforces the per-plan calendar cap when a funnel is assigned a calendar.
 * A calendar already in use by this tenant never counts against the cap again.
 */
export async function assertCanUseCalendar(
  tenantId: string,
  calendarId: string | null | undefined,
  excludeFunnelId?: string
) {
  if (!calendarId) return;

  const plan = await getTenantPlan(tenantId);
  if (plan.maxCalendars === null) return;

  const supabase = createServiceClient();
  let query = supabase
    .from("funnels")
    .select("calendar_id")
    .eq("tenant_id", tenantId)
    .not("calendar_id", "is", null);

  if (excludeFunnelId) {
    query = query.neq("id", excludeFunnelId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const calendarsInUse = new Set((data ?? []).map((row) => row.calendar_id).filter(Boolean));
  if (calendarsInUse.has(calendarId)) return;

  if (calendarsInUse.size >= plan.maxCalendars) {
    throw new Error(
      `Your ${plan.name} plan allows ${plan.maxCalendars} calendar${plan.maxCalendars === 1 ? "" : "s"}. ` +
        "Upgrade your plan to connect more calendars."
    );
  }
}
