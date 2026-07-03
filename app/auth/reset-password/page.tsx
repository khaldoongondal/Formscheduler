import Link from "next/link";
import { MailQuestion } from "lucide-react";
import { requestPasswordReset } from "@/app/auth/reset-password/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function ResetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
            <MailQuestion className="h-5 w-5" />
          </div>
          <CardTitle>Reset your password</CardTitle>
          <p className="text-sm text-slate-500">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </CardHeader>
        <CardContent>
          {params.sent ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                If an account exists for that email, a password reset link is on its way. Check your
                inbox (and spam folder).
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
              {params.error ? <p className="text-sm text-red-600">{params.error}</p> : null}
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
        </CardContent>
      </Card>
    </main>
  );
}
