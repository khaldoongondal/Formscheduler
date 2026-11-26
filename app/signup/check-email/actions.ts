"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { checkActionRateLimit } from "@/lib/security/rate-limit";
import { resendVerification } from "@/lib/signup/service";
import { RESEND_RATE_LIMITED_MESSAGE } from "@/lib/validation/signup";

function checkEmailUrl(email: string, extra: Record<string, string>) {
  const params = new URLSearchParams({ email, ...extra });
  return `/signup/check-email?${params.toString()}`;
}

export async function resendVerificationAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);

  if (!(await checkActionRateLimit(await headers(), "signup"))) {
    redirect(checkEmailUrl(email, { error: RESEND_RATE_LIMITED_MESSAGE }));
  }

  if (email.includes("@")) {
    // Resolves without revealing whether an account is waiting.
    await resendVerification(email);
  }

  redirect(checkEmailUrl(email, { sent: "1" }));
}
