"use server";

import { redirect } from "next/navigation";
import { createAuthServerClient } from "@/lib/supabase/auth";
import { resolveSetPasswordNext } from "@/lib/validation/signup";

function setPasswordUrl(error: string, next: string) {
  const params = new URLSearchParams({ error });
  if (next !== "/admin/funnels") params.set("next", next);
  return `/auth/set-password?${params.toString()}`;
}

export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const next = resolveSetPasswordNext(formData.get("next"));

  if (password.length < 8) {
    redirect(setPasswordUrl("Password must be at least 8 characters.", next));
  }

  if (password !== confirm) {
    redirect(setPasswordUrl("Passwords do not match.", next));
  }

  const supabase = await createAuthServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?error=${encodeURIComponent("Your session expired. Use your invite link again or sign in.")}`);
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    redirect(setPasswordUrl(error.message, next));
  }

  redirect(next);
}
