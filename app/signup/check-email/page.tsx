import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { resendVerificationAction } from "@/app/signup/check-email/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RESEND_RATE_LIMITED_MESSAGE } from "@/lib/validation/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Check your email | FormBook"
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
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MailCheck className="h-5 w-5" />
          </div>
          <CardTitle>Check your email</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-700">
            We sent a verification link to {email ? <strong>{email}</strong> : "your email address"}. Open it on
            this device to finish setting up your account.
          </p>
          <p className="text-sm text-slate-500">No email after a few minutes? Check your spam folder, or send it again.</p>

          {params.sent ? (
            <p className="text-sm text-slate-700" role="status">
              If an account is waiting for verification, we sent a new link.
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

          <p className="text-center text-sm text-slate-500">
            <Link className="underline underline-offset-2" href="/login">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
