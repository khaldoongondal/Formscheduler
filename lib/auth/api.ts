import { createAuthServerClient } from "@/lib/supabase/auth";
import { requireTenantRole, type TenantRole } from "@/lib/auth/tenant";

export async function requireAdminApiUser(allowedRoles: TenantRole[] = ["owner", "admin", "member"]) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Unauthorized");
    }
    return;
  }

  const supabase = await createAuthServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Unauthorized");
  }

  await requireTenantRole(allowedRoles);
}
