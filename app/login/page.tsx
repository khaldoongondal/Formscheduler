import Link from "next/link";
import { Lock } from "lucide-react";
import { signIn } from "@/app/login/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LoginPage({
  searchParams
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Lock className="h-5 w-5" />
          </div>
          <CardTitle>Sign in to FormBook</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signIn} className="space-y-4">
            <input type="hidden" name="next" value={params.next ?? "/admin/funnels"} />
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
            {params.error ? <p className="text-sm text-red-600">{params.error}</p> : null}
            <Button className="w-full" type="submit">
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
