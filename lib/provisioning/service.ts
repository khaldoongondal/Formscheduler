import { PLANS, type PlanId } from "@/lib/billing/plans";
import { createServiceClient } from "@/lib/supabase/server";
import type { Tenant } from "@/lib/types/database";

const SLUG_SUFFIX_LENGTH = 6;

export type ProvisionResult = {
  tenant_id: string;
  user_id: string;
  user_created: boolean;
  tenant_created: boolean;
  plan: PlanId;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 2 + SLUG_SUFFIX_LENGTH);
}

function getAppUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  }
  return appUrl.replace(/\/$/, "");
}

async function findUserIdByEmail(email: string) {
  const supabase = createServiceClient();
  const perPage = 200;

  for (let page = 1; page <= 25; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);

    const match = data.users.find((user) => user.email?.toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < perPage) break;
  }

  return null;
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
  plan?: PlanId;
}): Promise<ProvisionResult> {
  const supabase = createServiceClient();
  const email = input.email.trim().toLowerCase();
  const tenantName = input.tenant_name?.trim() || email.split("@")[0];
  const plan = input.plan ?? PLANS.tier1.id;

  let userId: string | null = null;
  let userCreated = false;

  const { data: invited, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getAppUrl()}/auth/confirm?next=/auth/set-password`
  });

  if (inviteError) {
    const alreadyExists =
      inviteError.status === 422 || /already.*(registered|exists)/i.test(inviteError.message);
    if (!alreadyExists) {
      throw new Error(`Failed to invite user: ${inviteError.message}`);
    }
    userId = await findUserIdByEmail(email);
    if (!userId) {
      throw new Error("User already exists but could not be found by email.");
    }
  } else {
    userId = invited.user.id;
    userCreated = true;
  }

  const { data: existingMember, error: memberLookupError } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (memberLookupError) throw new Error(memberLookupError.message);

  if (existingMember?.tenant_id) {
    // Repeat call for an existing customer: treat it as a plan change
    // (upgrade/downgrade from the sales-side automation).
    if (input.plan) {
      const { error: planError } = await supabase
        .from("tenants")
        .update({ plan })
        .eq("id", existingMember.tenant_id);
      if (planError) throw new Error(planError.message);
    }

    return {
      tenant_id: existingMember.tenant_id,
      user_id: userId,
      user_created: userCreated,
      tenant_created: false,
      plan
    };
  }

  const baseSlug = slugify(tenantName) || "tenant";
  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: tenantName,
      slug: `${baseSlug}-${randomSuffix()}`,
      plan
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

  return {
    tenant_id: tenant.id,
    user_id: userId,
    user_created: userCreated,
    tenant_created: true,
    plan
  };
}
