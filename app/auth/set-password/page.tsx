import { KeyRound } from "lucide-react";
import { setPassword } from "@/app/auth/set-password/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function SetPasswordPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-slate-950 text-white">
            <KeyRound className="h-5 w-5" />
          </div>
          <CardTitle>Set your password</CardTitle>
          <p className="text-sm text-slate-500">
            Welcome! Choose a password to finish setting up your account.
          </p>
        </CardHeader>
        <CardContent>
          <form action={setPassword} className="space-y-4">
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
            {params.error ? <p className="text-sm text-red-600">{params.error}</p> : null}
            <Button className="w-full" type="submit">
              Save password and continue
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
