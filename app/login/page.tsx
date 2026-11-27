import Link from "next/link";
import type { Metadata } from "next";
import { PRODUCT_ICONS } from "@/lib/marketing/site";
import { signIn } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/security/safe-redirect";
import { messageSuggestsPasswordReset } from "@/lib/validation/signup";

export const metadata: Metadata = { icons: PRODUCT_ICONS };

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <AuthShell title="Sign in to FormBook">
      <form action={signIn} className="space-y-4">
        <input type="hidden" name="next" value={safeNextPath(params.next)} />
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              className="text-xs text-slate-500 underline underline-offset-2 hover:text-slate-700"
              href="/auth/reset-password"
            >
              Forgot password?
            </Link>
          </div>
          <Input id="password" name="password" type="password" required autoComplete="current-password" />
        </div>
        {params.error ? <p className="text-sm text-red-600" role="alert">{params.error}</p> : null}
        {messageSuggestsPasswordReset(params.error) ? (
          <p className="text-sm">
            <Link className="font-semibold text-slate-900 underline underline-offset-2" href="/auth/reset-password">
              Get a new link with Forgot password
            </Link>
          </p>
        ) : null}
        <Button className="w-full" type="submit">
          Sign in
        </Button>
        <p className="text-center text-sm text-slate-500">
          New to FormBook?{" "}
          <Link className="font-semibold text-slate-900 underline underline-offset-2" href="/signup">
            Create a free account
          </Link>
        </p>
      </form>
    </AuthShell>
  );
}
