"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Fallback for any uncaught server or client error. In production Next hides
 * the error message, so this page never shows it; the digest helps match logs.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Something went wrong</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-700">
            We could not finish that request. Please try again. If it keeps happening, go back and try a different way.
          </p>
          {error.digest ? <p className="text-xs text-slate-500">Reference: {error.digest}</p> : null}
          <div className="flex gap-3">
            <Button type="button" onClick={() => reset()}>
              Try again
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin/funnels">Back to forms</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
