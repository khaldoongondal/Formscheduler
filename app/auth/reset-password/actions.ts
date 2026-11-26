"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { findUserIdByEmail } from "@/lib/auth/users";
import { hashSubject } from "@/lib/security/rate-limit-core";
import { checkActionRateLimit, getIpHashSalt, hitRateLimit } from "@/lib/security/rate-limit";
import { postGhlWebhook } from "@/lib/signup/ghl-webhook";
import { createAuthServerClient } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { buildResetLink } from "@/lib/validation/signup";

const RESET_RATE_LIMITED_MESSAGE = "Too many reset requests. Please wait an hour and try again.";

function getAppUrl() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  return appUrl.replace(/\/+$/, "");
}

/** Name for the email greeting: the owner's tenant contact name, else the auth metadata name, else empty. */
async function findDisplayName(userId: string): Promise<string> {
  const supabase = createServiceClient();
  const { data: member } = await supabase
    .from("tenant_members")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("role", "owner")
    .limit(1)
    .maybeSingle();

  if (member?.tenant_id) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("contact_name")
      .eq("id", member.tenant_id)
      .maybeSingle();
    if (tenant?.contact_name) return tenant.contact_name;
  }

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const fullName = userData.user?.user_metadata?.full_name;
  return typeof fullName === "string" ? fullName.slice(0, 120) : "";
}

/** GoHighLevel path: generate the recovery link server-side and hand it to the workflow. */
async function sendResetThroughGhl(webhookUrl: string, email: string) {
  const userId = await findUserIdByEmail(email);
  if (!userId) return;

  const appUrl = getAppUrl();
  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/auth/confirm?next=/auth/set-password` }
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);
  const hashedToken = data.properties?.hashed_token;
  if (!hashedToken) throw new Error("generateLink returned no token.");

  await postGhlWebhook(webhookUrl, {
    email,
    name: await findDisplayName(userId),
    reset_link: buildResetLink(appUrl, hashedToken)
  });
}

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email || !email.includes("@") || email.length > 254) {
    redirect(`/auth/reset-password?error=${encodeURIComponent("Enter a valid email address.")}`);
  }

  const requestHeaders = await headers();
  if (!(await checkActionRateLimit(requestHeaders, "password-reset"))) {
    redirect(`/auth/reset-password?error=${encodeURIComponent(RESET_RATE_LIMITED_MESSAGE)}`);
  }

  // Per address as well, so one inbox cannot be flooded from many IPs.
  const perEmail = await hitRateLimit({
    scope: "password-reset-email",
    subject: hashSubject(email, getIpHashSalt()),
    limit: 3,
    windowSeconds: 3600
  });

  if (perEmail.allowed) {
    const webhookUrl = process.env.FORMBOOK_GHL_PASSWORD_RESET_WEBHOOK_URL?.trim();
    try {
      if (webhookUrl) {
        await sendResetThroughGhl(webhookUrl, email);
      } else {
        const supabase = await createAuthServerClient();
        await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${getAppUrl()}/auth/confirm?next=/auth/set-password`
        });
      }
    } catch (error) {
      // Logged and swallowed: the visitor always sees the same confirmation.
      console.error("[reset-password] send failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  // Always confirm, regardless of whether the account exists, to avoid
  // leaking which emails have accounts.
  redirect("/auth/reset-password?sent=1");
}
