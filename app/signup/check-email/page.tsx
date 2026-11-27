import type { Metadata } from "next";
import { PRODUCT_ICONS } from "@/lib/marketing/site";
import Link from "next/link";
import { resendVerificationAction } from "@/app/signup/check-email/actions";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { RESEND_RATE_LIMITED_MESSAGE } from "@/lib/validation/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  icons: PRODUCT_ICONS,
  title: "Check your email"
};

const RESEND_ERRORS = new Set([RESEND_RATE_LIMITED_MESSAGE]);

export default async function CheckEmailPage({
  searchParams
}: {
  searchParams: Promise<{ email?: string; sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email.trim().slice(0, 254) : "";
  // Only show messages this app sends, never free text from the URL.
  const error = typeof params.error === "string" && RESEND_ERRORS.has(params.error) ? params.error : null;

  return (
    <AuthShell title="Check your email">
      <p className="text-sm text-slate-700">
        We sent a verification link to {email ? <strong>{email}</strong> : "your email address"}. Open it on
        this device to finish setting up your account.
      </p>
      <p className="text-sm text-slate-500">No email after a few minutes? Check your spam folder, or send it again.</p>

      {params.sent ? (
        <p className="text-sm text-slate-700" role="status">
          If an account is waiting for verification, we sent a new link. We send at most one link every three
          minutes, so if you just asked for one, wait a few minutes before trying again.
        </p>
      ) : null}
      {error ? (
        <p className="text-sm text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      {email ? (
        <form action={resendVerificationAction}>
          <input type="hidden" name="email" value={email} />
          <Button className="w-full" type="submit" variant="outline">
            Send the link again
          </Button>
        </form>
      ) : null}

      <p className="text-sm text-slate-700">
        Already verified your email, or this address already has an account? Sign in, or use{" "}
        <Link className="font-semibold underline underline-offset-2" href="/auth/reset-password">
          Forgot password
        </Link>{" "}
        to get a new link and set a new password.
      </p>

      <p className="text-center text-sm text-slate-500">
        <Link className="underline underline-offset-2" href="/login">
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
