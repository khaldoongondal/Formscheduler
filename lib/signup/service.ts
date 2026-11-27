import { randomBytes } from "node:crypto";
import { PublicError } from "@/lib/api/responses";
import { findUserIdByEmail, isAuthUserConfirmed } from "@/lib/auth/users";
import { CONTACT_EMAIL } from "@/lib/billing/plans";
import { allowEmailSend } from "@/lib/security/rate-limit";
import { postGhlWebhook } from "@/lib/signup/ghl-webhook";
import { createAuthServerClient } from "@/lib/supabase/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  buildSignupEmailRedirect,
  buildSignupWebhookPayload,
  buildVerifyLink,
  type SignupInput,
  type SignupProfile
} from "@/lib/validation/signup";

/**
 * Self-serve signup.
 *
 * The account only works after the email is verified: the tenant and owner
 * membership are created by the complete_signup() RPC (migration 0022), which
 * refuses unconfirmed users. Until then the profile waits in signup_requests.
 *
 * Email goes through GoHighLevel: the server creates the unverified user,
 * generates the verification link itself and POSTs it to the inbound webhook
 * in FORMBOOK_GHL_SIGNUP_WEBHOOK_URL. When that variable is unset, Supabase
 * sends its own email instead so signup still works.
 *
 * The signup form never sets a password. The user is created with a random,
 * unknown password and the verification link leads to /auth/set-password, so
 * the password is chosen only after the owner of the address has proven it.
 * A repeat signup for an unverified address only resends the link: it never
 * changes the password or the stored profile.
 */

export const VERIFICATION_SEND_FAILED_MESSAGE = `We could not send your verification email. Please try again in a few minutes or email ${CONTACT_EMAIL}.`;

export function isGhlSignupWebhookConfigured(): boolean {
  return Boolean(process.env.FORMBOOK_GHL_SIGNUP_WEBHOOK_URL?.trim());
}

export function getAppUrl(): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (!appUrl) throw new Error("Missing NEXT_PUBLIC_APP_URL.");
  return appUrl.replace(/\/+$/, "");
}

function confirmRedirectUrl() {
  return buildSignupEmailRedirect(getAppUrl());
}

/** A password nobody knows; the real one is set after verification. */
function unusablePassword(): string {
  return randomBytes(32).toString("base64url");
}

function logSignupError(context: string, error: unknown) {
  // Never log the address, the payload or the link.
  console.error(`[signup] ${context}:`, error instanceof Error ? error.message : "unknown error");
}

/** Stores the profile for a new pending signup. Never overwrites an existing one. */
async function insertSignupRequestIfMissing(userId: string, input: SignupProfile) {
  const supabase = createServiceClient();
  const { error } = await supabase.from("signup_requests").upsert(
    {
      user_id: userId,
      email: input.email,
      full_name: input.name,
      phone: input.phone,
      business_name: input.business_name,
      website: input.website,
      plan: "free"
    },
    { onConflict: "user_id", ignoreDuplicates: true }
  );
  if (error) throw new Error(error.message);
}

async function loadSignupProfile(userId: string): Promise<SignupProfile | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("signup_requests")
    .select("email, full_name, phone, business_name, website, completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.completed_at) return null;
  return {
    email: data.email,
    name: data.full_name,
    phone: data.phone,
    business_name: data.business_name,
    website: data.website
  };
}

/**
 * Generates the verification link server-side (no email is sent by Supabase)
 * and hands it to the GoHighLevel workflow.
 *
 * OWNER SMOKE TEST (cannot be checked offline): confirm in production that
 * generateLink({ type: "magiclink" }) for an unconfirmed user returns a working
 * link (verification_type "signup") and that opening it sets
 * auth.users.email_confirmed_at. If it does not, complete_signup() refuses the
 * account and the welcome page shows the "verify your email" message.
 */
async function sendVerificationThroughGhl(profile: SignupProfile): Promise<void> {
  const webhookUrl = process.env.FORMBOOK_GHL_SIGNUP_WEBHOOK_URL?.trim();
  if (!webhookUrl) throw new Error("FORMBOOK_GHL_SIGNUP_WEBHOOK_URL is not set.");

  const supabase = createServiceClient();
  const { data, error } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: profile.email,
    options: { redirectTo: confirmRedirectUrl() }
  });
  if (error) throw new Error(`generateLink failed: ${error.message}`);

  const hashedToken = data.properties?.hashed_token;
  const verificationType = data.properties?.verification_type;
  if (!hashedToken || !verificationType) throw new Error("generateLink returned no token.");

  const verifyLink = buildVerifyLink(getAppUrl(), hashedToken, verificationType);
  await postGhlWebhook(webhookUrl, buildSignupWebhookPayload(profile, verifyLink));
}

async function sendVerificationThroughSupabase(email: string): Promise<void> {
  const auth = await createAuthServerClient();
  const { error } = await auth.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmRedirectUrl() }
  });
  if (error) throw new Error(`resend failed: ${error.message}`);
}

/**
 * Sends a new verification email. Throws on failure; returns false when there
 * is nothing to send or the per-address cooldown is active.
 */
async function sendVerification(email: string): Promise<boolean> {
  const userId = await findUserIdByEmail(email);
  if (!userId || (await isAuthUserConfirmed(userId))) return false;
  if (!(await allowEmailSend("signup-email", email))) return false;

  if (isGhlSignupWebhookConfigured()) {
    const profile = await loadSignupProfile(userId);
    if (!profile) return false;
    await sendVerificationThroughGhl(profile);
  } else {
    await sendVerificationThroughSupabase(email);
  }
  return true;
}

/**
 * Callers rate-limit this. Always resolves without revealing whether an
 * account exists or is waiting for verification.
 */
export async function resendVerification(email: string): Promise<void> {
  try {
    await sendVerification(email.trim().toLowerCase());
  } catch (error) {
    logSignupError("resend verification failed", error);
  }
}

function isAlreadyRegisteredError(error: { status?: number; message: string; code?: string }) {
  return (
    error.status === 422 ||
    error.code === "email_exists" ||
    error.code === "user_already_exists" ||
    /already.*(registered|exists)/i.test(error.message)
  );
}

async function handleExistingUser(userId: string, input: SignupInput): Promise<void> {
  if (await isAuthUserConfirmed(userId)) {
    // Same "check your email" page as a new signup: no account enumeration.
    console.info("[signup] signup attempt for an existing account");
    return;
  }

  // Still unverified: only resend the link. The password and the stored
  // profile are never changed by an unauthenticated request. The profile is
  // only filled in when none exists yet (a lost race with createUser).
  await insertSignupRequestIfMissing(userId, input);
  try {
    await sendVerification(input.email);
  } catch (error) {
    logSignupError("verification send failed", error);
    throw new PublicError(VERIFICATION_SEND_FAILED_MESSAGE);
  }
}

export async function startSignup(input: SignupInput): Promise<void> {
  const existingId = await findUserIdByEmail(input.email);
  if (existingId) {
    await handleExistingUser(existingId, input);
    return;
  }

  if (isGhlSignupWebhookConfigured()) {
    const supabase = createServiceClient();
    const { data, error } = await supabase.auth.admin.createUser({
      email: input.email,
      password: unusablePassword(),
      email_confirm: false,
      user_metadata: { full_name: input.name }
    });

    if (error) {
      if (isAlreadyRegisteredError(error)) {
        // Created by a parallel request between the lookup and here.
        const racedId = await findUserIdByEmail(input.email);
        if (racedId) {
          await handleExistingUser(racedId, input);
          return;
        }
      }
      throw new Error(`createUser failed: ${error.message}`);
    }

    // User and request rows stay even if the email fails, so "send again" works.
    await insertSignupRequestIfMissing(data.user.id, input);
    if (!(await allowEmailSend("signup-email", input.email))) return;
    try {
      await sendVerificationThroughGhl(input);
    } catch (sendError) {
      logSignupError("verification send failed", sendError);
      throw new PublicError(VERIFICATION_SEND_FAILED_MESSAGE);
    }
    return;
  }

  // Fallback: Supabase sends its own verification email. The link lands on
  // /auth/confirm?code=..., which the route exchanges (PKCE, same browser).
  if (!(await allowEmailSend("signup-email", input.email))) return;
  const auth = await createAuthServerClient();
  const { data, error } = await auth.auth.signUp({
    email: input.email,
    password: unusablePassword(),
    options: {
      emailRedirectTo: confirmRedirectUrl(),
      data: { full_name: input.name }
    }
  });
  if (error) {
    logSignupError("supabase signUp failed", error);
    throw new PublicError(VERIFICATION_SEND_FAILED_MESSAGE);
  }

  // A null user or empty identities means the address already exists.
  if (!data.user || !data.user.identities || data.user.identities.length === 0) return;
  await insertSignupRequestIfMissing(data.user.id, input);
}

/** Creates the tenant and owner membership once the email is verified. Idempotent. */
export async function completeSignupForUser(userId: string): Promise<string | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("complete_signup", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data ? data : null;
}
