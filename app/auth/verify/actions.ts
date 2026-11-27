"use server";

import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { completeSignupIfPending } from "@/lib/signup/complete";
import { createAuthServerClient } from "@/lib/supabase/auth";
import { LINK_EXPIRED_MESSAGE, isEmailOtpType, resolveConfirmNext } from "@/lib/validation/signup";

/** Uses the one-time token only when the person presses the button on /auth/verify. */
export async function verifyEmailLinkAction(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "").slice(0, 512);
  const type = String(formData.get("type") ?? "");
  const rawNext = formData.get("next");
  const next = resolveConfirmNext(typeof rawNext === "string" && rawNext ? rawNext : null);

  let verified = false;
  if (tokenHash && isEmailOtpType(type)) {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.verifyOtp({ type: type as EmailOtpType, token_hash: tokenHash });
    if (!error) {
      await completeSignupIfPending(supabase);
      verified = true;
    }
  }

  if (!verified) {
    redirect(`/login?error=${encodeURIComponent(LINK_EXPIRED_MESSAGE)}`);
  }
  redirect(`${next.pathname}${next.search}`);
}
