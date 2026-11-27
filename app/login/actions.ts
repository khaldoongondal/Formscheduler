"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkActionRateLimit } from "@/lib/security/rate-limit";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { createAuthServerClient } from "@/lib/supabase/auth";

const SIGN_IN_FAILED_MESSAGE = 
  "Email or password is incorrect, or the email is not verified yet. Never chose a password? Use Forgot password.";
const SIGN_IN_RATE_LIMITED_MESSAGE = "Too many sign-in attempts. Please wait a few minutes.";

function loginErrorUrl(message: string, next: string) {
  return `/login?error=${encodeURIComponent(message)}&next=${encodeURIComponent(next)}`;
}

export async function signIn(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = safeNextPath(formData.get("next"));

  if (!(await checkActionRateLimit(await headers(), "login"))) {
    redirect(loginErrorUrl(SIGN_IN_RATE_LIMITED_MESSAGE, next));
  }

  const supabase = await createAuthServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Never echo Supabase error text.
    redirect(loginErrorUrl(SIGN_IN_FAILED_MESSAGE, next));
  }

  redirect(next);
}

export async function signOut() {
  const supabase = await createAuthServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}
