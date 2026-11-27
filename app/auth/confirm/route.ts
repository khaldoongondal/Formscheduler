import { NextResponse, type NextRequest } from "next/server";
import { completeSignupIfPending } from "@/lib/signup/complete";
import { createAuthServerClient } from "@/lib/supabase/auth";
import {
  LINK_EXPIRED_MESSAGE,
  buildVerifyInterstitialPath,
  isEmailOtpType,
  resolveConfirmNext
} from "@/lib/validation/signup";

/**
 * Landing route for every emailed link (signup verification, password reset).
 *
 * token_hash links (the GoHighLevel emails) are never verified on this GET:
 * mail security scanners open links before the person does and would use up
 * the one-time token. They are forwarded to /auth/verify, which verifies only
 * when the person presses its button.
 *
 * ?code= links (Supabase's own PKCE emails) are exchanged here: the exchange
 * needs the code verifier cookie of the browser that started the flow, so a
 * scanner cannot use them.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");

  const redirectTo = request.nextUrl.clone();
  redirectTo.search = "";

  if (tokenHash && isEmailOtpType(type)) {
    const target = new URL(buildVerifyInterstitialPath(tokenHash, type as string, rawNext), request.nextUrl.origin);
    const response = NextResponse.redirect(target);
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }

  if (code) {
    const supabase = await createAuthServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      await completeSignupIfPending(supabase);
      const next = resolveConfirmNext(rawNext);
      redirectTo.pathname = next.pathname;
      redirectTo.search = next.search;
      return NextResponse.redirect(redirectTo);
    }
  }

  redirectTo.pathname = "/login";
  redirectTo.searchParams.set("error", LINK_EXPIRED_MESSAGE);
  return NextResponse.redirect(redirectTo);
}
