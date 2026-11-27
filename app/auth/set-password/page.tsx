import { setPassword } from "@/app/auth/set-password/actions";
import { Button } from "@/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { resolveSetPasswordNext } from "@/lib/validation/signup";

export default async function SetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const next = resolveSetPasswordNext(params.next);

  return (
    <AuthShell
      title="Set your password"
      description="Welcome to FormBook! Choose a password to finish setting up your account."
    >
      <form action={setPassword} className="space-y-4">
        <input type="hidden" name="next" value={next} />
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            required
            minLength={8}
            autoComplete="new-password"
          />
        </div>
        {params.error ? <p className="text-sm text-red-600" role="alert">{params.error}</p> : null}
        <Button className="w-full" type="submit">
          Save password and continue
        </Button>
      </form>
    </AuthShell>
  );
}
