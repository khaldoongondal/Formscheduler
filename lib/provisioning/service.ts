import { PublicError } from "@/lib/api/responses";
import { findUserIdByEmail } from "@/lib/auth/users";
import { normalizeAccountRef } from "@/lib/billing/account-ref";
import { applyPlanChange, type AppliedPlanChange } from "@/lib/billing/plan-change-service";
import { parsePlanState, type PlanState } from "@/lib/billing/plans";
import { resolveProvisionPlanChange } from "@/lib/provisioning/plan-change";
import { randomSuffix } from "@/lib/security/random";
import { createServiceClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types/database";

const SLUG_SUFFIX_LENGTH = 6;

/** The actor recorded in plan history for /api/provision calls. */
export const PROVISION_ACTOR = "billing automation";

/** What a provision plan change did (frozen and restored counts); null when nothing changed. */
export type ProvisionPlanChangeSummary = Omit<AppliedPlanChange, "historyId">;

export type ProvisionResult = {
  tenant_id: string;
  user_id: string;
  user_created: boolean;
  tenant_created: boolean;
  plan: PlanState;
  /**
   * One-time link the customer uses to set their password and reach the admin.
   * Returned so the sales-side automation (GHL) can embed it in the branded
   * welcome email instead of relying on a Supabase-sent email.
   */
  login_link: string;
  /** Opaque account reference (null before migration 0032). */
  account_ref: string | null;
  plan_change: ProvisionPlanChangeSummary | null;
};

export type ProvisionRefResult = {
  tenant_id: string;
  user_id: null;
  user_created: false;
  tenant_created: false;
  plan: PlanState;
  login_link: null;
  account_ref: string;
  plan_change: ProvisionPlanChangeSummary | null;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}


function getAppUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  }
  return appUrl.replace(/\/$/, "");
}

/**
 * Generates a one-time set-password link without sending any email. GHL embeds
 * this in the branded welcome email. Uses a recovery-type link so the customer
 * lands on /auth/confirm and is routed to /auth/set-password.
 */
async function generateLoginLink(email: string) {
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${getAppUrl()}/auth/confirm?next=/auth/set-password` }
  });

  if (error) throw new Error(`Failed to generate login link: ${error.message}`);
  const hashedToken = data.properties?.hashed_token;
  if (!hashedToken) throw new Error("Login link generation returned no token.");

  return `${getAppUrl()}/auth/confirm?token_hash=${hashedToken}&type=recovery&next=/auth/set-password`;
}

/**
 * Creates (or reuses) a Supabase auth user and tenant for a new customer.
 * Called by the sales-side automation (GHL workflow after a Stripe purchase),
 * so it must be idempotent: repeated calls for the same email return the
 * existing tenant instead of creating duplicates.
 */
export async function provisionTenant(input: {
  email: string;
  tenant_name?: string;
  plan?: PlanState;
}): Promise<ProvisionResult> {
  const supabase = createServiceClient();
  const email = input.email.trim().toLowerCase();
  const tenantName = input.tenant_name?.trim() || email.split("@")[0];
  const plan: PlanState = input.plan ?? "free";

  let userId: string | null = null;
  let userCreated = false;

  // Create the user without sending any email — GHL sends the branded welcome
  // email using the login_link this function returns.
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true
  });

  if (createError) {
    const alreadyExists =
      createError.status === 422 || /already.*(registered|exists)/i.test(createError.message);
    if (!alreadyExists) {
      throw new Error(`Failed to create user: ${createError.message}`);
    }
    userId = await findUserIdByEmail(email);
    if (!userId) {
      throw new Error("User already exists but could not be found by email.");
    }
  } else {
    userId = created.user.id;
    userCreated = true;
  }

  const loginLink = await generateLoginLink(email);

  const { data: existingMember, error: memberLookupError } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberLookupError) throw new Error(memberLookupError.message);

  if (existingMember?.tenant_id) {
    // Repeat call for an existing customer: treat it as a plan change
    // (upgrade, downgrade, lapse or renewal from the sales-side automation),
    // keeping the suspension fields in step with the plan.
    const tenantId = existingMember.tenant_id;
    const { plan: resultingPlan, planChange } = input.plan
      ? await applyProvisionPlan(tenantId, plan)
      : { plan, planChange: null };

    return {
      tenant_id: tenantId,
      user_id: userId,
      user_created: userCreated,
      tenant_created: false,
      plan: resultingPlan,
      login_link: loginLink,
      account_ref: await readAccountRef(tenantId),
      plan_change: planChange
    };
  }

  const baseSlug = slugify(tenantName) || "tenant";
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: tenantName,
      slug: `${baseSlug}-${randomSuffix(SLUG_SUFFIX_LENGTH)}`,
      plan,
      signup_source: "provisioned"
    })
    .select("id")
    .single<Pick<Tenant, "id">>();

  if (tenantError) throw new Error(tenantError.message);

  const { error: memberError } = await supabase.from("tenant_members").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner"
  });

  if (memberError) throw new Error(memberError.message);

  if (plan !== "free") await recordProvisionedPlan(tenant.id, plan);

  return {
    tenant_id: tenant.id,
    user_id: userId,
    user_created: userCreated,
    tenant_created: true,
    plan,
    login_link: loginLink,
    account_ref: await readAccountRef(tenant.id),
    plan_change: null
  };
}

/**
 * Plan change by the opaque account reference (the GoHighLevel checkout and
 * subscription workflows send it). Never creates or touches an auth user or a
 * tenant: an unknown reference is a 404.
 */
export async function provisionByAccountRef(input: { account_ref: string; plan?: PlanState }): Promise<ProvisionRefResult> {
  const ref = normalizeAccountRef(input.account_ref);
  if (!ref) throw new PublicError("Account not found.", 404);
  const supabase = createServiceClient();
  const { data, error } = await supabase.from("tenants").select("id,plan").eq("account_ref", ref).maybeSingle();
  if (error) {
    // 42703: migration 0032 is not applied, so no reference can match.
    if (error.code === "42703") throw new PublicError("Account not found.", 404);
    throw new Error(error.message);
  }
  if (!data) throw new PublicError("Account not found.", 404);

  const { plan, planChange } = input.plan
    ? await applyProvisionPlan(data.id, input.plan)
    : { plan: parsePlanState(data.plan), planChange: null };

  return {
    tenant_id: data.id,
    user_id: null,
    user_created: false,
    tenant_created: false,
    plan,
    login_link: null,
    account_ref: ref,
    plan_change: planChange
  };
}

/** The shared provision plan change: applyPlanChange with the automation's rules. */
async function applyProvisionPlan(
  tenantId: string,
  requested: PlanState
): Promise<{ plan: PlanState; planChange: ProvisionPlanChangeSummary | null }> {
  let resultingPlan: PlanState = requested;
  let keptOwnerSuspension = false;
  const applied = await applyPlanChange({
    tenantId,
    resolve: (current) => {
      const change = resolveProvisionPlanChange(current, requested, new Date().toISOString());
      resultingPlan = change.resultingPlan;
      keptOwnerSuspension = change.keptOwnerSuspension;
      return change;
    },
    source: "provision",
    actor: PROVISION_ACTOR,
    note: null
  });
  if (keptOwnerSuspension) {
    console.info("[provision] plan change kept an owner suspension in place");
  }
  if (!applied.changed) return { plan: resultingPlan, planChange: null };
  const { historyId: _historyId, ...summary } = applied;
  void _historyId;
  return { plan: resultingPlan, planChange: summary };
}

/** History row for a tenant created on a paid plan (errors are logged, never thrown). */
async function recordProvisionedPlan(tenantId: string, plan: PlanState) {
  try {
    const supabase = createServiceClient();
    const { error } = await supabase.from("tenant_plan_changes").insert({
      tenant_id: tenantId,
      from_plan: null,
      to_plan: plan,
      source: "provision",
      actor: PROVISION_ACTOR
    });
    if (error) console.error("[provision] plan history write failed:", error.code ?? "error");
  } catch {
    console.error("[provision] plan history write failed");
  }
}

/** The tenant's account reference, or null before migration 0032. */
async function readAccountRef(tenantId: string): Promise<string | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase.from("tenants").select("account_ref").eq("id", tenantId).maybeSingle();
    if (error || !data) return null;
    return normalizeAccountRef((data as { account_ref?: unknown }).account_ref);
  } catch {
    return null;
  }
}
