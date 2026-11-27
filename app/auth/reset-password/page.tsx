import Link from "next/link";
import { requestPasswordReset } from "@/app/auth/reset-password/actions";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account email and we’ll send you a reset link."
    >
      {params.sent ? (
        <div className="space-y-4" role="status">
          <p className="text-sm text-slate-700">
            If an account exists for that email, a password reset link is on its way. Check your
            inbox (and spam folder).
          </p>
          <p className="text-sm text-slate-500">
            We send at most one link every three minutes to the same address. If you just asked for one, wait a
            few minutes before trying again.
          </p>
          <Link className="text-sm font-semibold text-slate-900 underline underline-offset-2" href="/login">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form action={requestPasswordReset} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" />
          </div>
          {params.error ? <p className="text-sm text-red-600" role="alert">{params.error}</p> : null}
          <Button className="w-full" type="submit">
            Send reset link
          </Button>
          <p className="text-center text-sm text-slate-500">
            <Link className="underline underline-offset-2" href="/login">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
