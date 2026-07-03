import { createAuthServerClient } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { TenantMember } from "@/lib/types/database";

export type TenantRole = TenantMember["role"];

const allRoles: TenantRole[] = ["owner", "admin", "member"];

function hasAllowedRole(role: TenantRole, allowedRoles: TenantRole[]) {
  return allowedRoles.includes(role);
}

export async function getAdminTenantContext(allowedRoles: TenantRole[] = allRoles) {
  if (process.env.LEADDER_DEFAULT_TENANT_ID && process.env.NODE_ENV !== "production") {
    return {
      tenantId: process.env.LEADDER_DEFAULT_TENANT_ID,
      role: "owner" as TenantRole
    };
  }

  const auth = await createAuthServerClient();
  const {
    data: { user }
  } = await auth.auth.getUser();
  const supabase = createServiceClient();

  if (user) {
    const { data: member, error } = await supabase
      .from("tenant_members")
      .select("tenant_id, role")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (member?.tenant_id && hasAllowedRole(member.role, allowedRoles)) {
      return { tenantId: member.tenant_id, role: member.role };
    }
    if (member?.tenant_id) {
      throw new Error("You do not have permission to perform this action.");
    }
    throw new Error("Authenticated user is not assigned to a tenant.");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("Authenticated user is required.");
  }

  const { data: tenant, error } = await supabase
    .from("tenants")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!tenant?.id) throw new Error("No tenant is configured.");
  return { tenantId: tenant.id, role: "owner" as TenantRole };
}

export async function getAdminTenantId() {
  const context = await getAdminTenantContext();
  return context.tenantId;
}

export async function requireTenantRole(allowedRoles: TenantRole[]) {
  return getAdminTenantContext(allowedRoles);
}
