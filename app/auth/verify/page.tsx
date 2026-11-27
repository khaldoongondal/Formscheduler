import type { Metadata } from "next";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { verifyEmailLinkAction } from "@/app/auth/verify/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LINK_EXPIRED_MESSAGE, isEmailOtpType } from "@/lib/validation/signup";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirm | FormBook",
  referrer: "no-referrer",
  robots: { index: false, follow: false }
};

/**
 * Interstitial for emailed one-time links. Opening this page uses nothing up;
 * the token is verified only when the button is pressed, so mail scanners that
 * open links in advance cannot spend it.
 */
export default async function VerifyLinkPage({
  searchParams
}: {
  searchParams: Promise<{ token_hash?: string; type?: string; next?: string }>;
}) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash.slice(0, 512) : "";
  const type = typeof params.type === "string" ? params.type : "";
  const next = typeof params.next === "string" ? params.next.slice(0, 300) : "";
  const valid = Boolean(tokenHash) && isEmailOtpType(type);
  const isReset = type === "recovery";

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <MailCheck className="h-5 w-5" />
          </div>
          <CardTitle>{isReset ? "Reset your password" : "Confirm your email"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {valid ? (
            <>
              <p className="text-sm text-slate-700">
                {isReset
                  ? "Press the button to continue and choose a new password."
                  : "Press the button to confirm your email and choose your password."}
              </p>
              <form action={verifyEmailLinkAction}>
                <input type="hidden" name="token_hash" value={tokenHash} />
                <input type="hidden" name="type" value={type} />
                <input type="hidden" name="next" value={next} />
                <Button className="w-full" type="submit">
                  {isReset ? "Continue" : "Confirm my email"}
                </Button>
              </form>
            </>
          ) : (
            <p className="text-sm text-red-600" role="alert">
              {LINK_EXPIRED_MESSAGE}
            </p>
          )}
          <p className="text-center text-sm text-slate-500">
            <Link className="underline underline-offset-2" href="/auth/reset-password">
              Forgot password
            </Link>
            {" · "}
            <Link className="underline underline-offset-2" href="/login">
              Back to sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
