import { completeSignupForUser } from "@/lib/signup/service";
import type { createAuthServerClient } from "@/lib/supabase/auth";

/**
 * Creates the tenant for a self-serve signup right after verification.
 * Never throws: the welcome page (getAdminTenantContext) retries.
 */
export async function completeSignupIfPending(supabase: Awaited<ReturnType<typeof createAuthServerClient>>) {
  try {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user?.email_confirmed_at) {
      await completeSignupForUser(user.id);
    }
  } catch (error) {
    console.error("[auth/confirm] complete signup failed:", error instanceof Error ? error.message : "unknown error");
  }
}
