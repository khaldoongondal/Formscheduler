"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/auth";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email || !email.includes("@")) {
    redirect(`/auth/reset-password?error=${encodeURIComponent("Enter a valid email address.")}`);
  }

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const supabase = await createAuthServerClient();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${appUrl}/auth/confirm?next=/auth/set-password`
  });

  // Always confirm, regardless of whether the account exists, to avoid
  // leaking which emails have accounts.
  redirect("/auth/reset-password?sent=1");
}
