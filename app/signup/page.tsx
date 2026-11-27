import type { Metadata } from "next";
import { PRODUCT_ICONS } from "@/lib/marketing/site";
import { redirect } from "next/navigation";
import { SignupForm } from "@/components/auth/signup-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { PLANS } from "@/lib/billing/plans";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { createAuthServerClient } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  icons: PRODUCT_ICONS,
  title: "Create your free account"
};

async function hasTenantMembership(): Promise<boolean> {
  if (getMissingSupabaseAdminEnv().length > 0) return false;
  try {
    const auth = await createAuthServerClient();
    const {
      data: { user }
    } = await auth.auth.getUser();
    if (!user) return false;

    const { data } = await createServiceClient()
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle();
    return Boolean(data?.tenant_id);
  } catch {
    return false;
  }
}

export default async function SignupPage() {
  if (await hasTenantMembership()) {
    redirect("/admin/funnels");
  }

  return (
    <AuthShell
      title="Create your free FormBook account"
      description={<>The free {PLANS.free.name} plan includes {PLANS.free.maxActiveForms} active forms.</>}
    >
      <SignupForm turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined} />
    </AuthShell>
  );
}
