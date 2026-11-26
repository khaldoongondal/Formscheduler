import { notFound } from "next/navigation";
import { DEV_OWNER_EMAIL, isDevOwnerBypass, isOwnerEmail } from "@/lib/auth/owner";
import { createAuthServerClient } from "@/lib/supabase/auth";

export type PlatformOwner = { email: string };

/**
 * Returns the signed-in platform owner, or null. Never throws, so the admin
 * layout can call it on every page.
 */
export async function getPlatformOwner(): Promise<PlatformOwner | null> {
  if (isDevOwnerBypass({ NODE_ENV: process.env.NODE_ENV, LEADDER_DEFAULT_TENANT_ID: process.env.LEADDER_DEFAULT_TENANT_ID })) {
    return { email: DEV_OWNER_EMAIL };
  }

  try {
    const auth = await createAuthServerClient();
    const {
      data: { user }
    } = await auth.auth.getUser();
    if (!user || !user.email || !user.email_confirmed_at) return null;
    if (!isOwnerEmail(user.email, process.env.FORMBOOK_OWNER_EMAILS)) return null;
    return { email: user.email.trim().toLowerCase() };
  } catch (error) {
    // Let Next.js internal signals (dynamic usage, redirects) pass through.
    if (error && typeof error === "object" && typeof (error as { digest?: unknown }).digest === "string") {
      throw error;
    }
    console.error("[owner] owner check failed:", error instanceof Error ? error.message : "unknown error");
    return null;
  }
}

/** Every owner page and server action calls this first. Non-owners get a 404. */
export async function requirePlatformOwner(): Promise<PlatformOwner> {
  const owner = await getPlatformOwner();
  if (!owner) notFound();
  return owner;
}
