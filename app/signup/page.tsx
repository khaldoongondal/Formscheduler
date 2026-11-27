import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { UserPlus } from "lucide-react";
import { SignupForm } from "@/components/auth/signup-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLANS } from "@/lib/billing/plans";
import { getMissingSupabaseAdminEnv } from "@/lib/env";
import { createAuthServerClient } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <UserPlus className="h-5 w-5" />
          </div>
          <CardTitle>Create your free FormBook account</CardTitle>
          <p className="text-sm text-slate-500">
            The free {PLANS.free.name} plan includes {PLANS.free.maxActiveForms} active forms.
          </p>
        </CardHeader>
        <CardContent>
          <SignupForm turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
