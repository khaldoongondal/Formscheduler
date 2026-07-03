import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAuthServerClient } from "@/lib/supabase/auth";

const allowedNextPaths = new Set(["/auth/set-password", "/admin/funnels"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const requestedNext = searchParams.get("next") ?? "/auth/set-password";
  const next = allowedNextPaths.has(requestedNext) ? requestedNext : "/auth/set-password";

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  const supabase = await createAuthServerClient();

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      redirectTo.pathname = next;
      return NextResponse.redirect(redirectTo);
    }
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      redirectTo.pathname = next;
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", "Your sign-in link is invalid or expired. Request a new one.");
  return NextResponse.redirect(redirectTo);
}
