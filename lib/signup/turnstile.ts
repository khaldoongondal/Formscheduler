/**
 * Cloudflare Turnstile. Enforced when both keys are set. Outside production a
 * missing key turns the captcha off so local work needs no keys; in
 * production (NODE_ENV=production, which includes Vercel previews) missing
 * keys refuse signup instead of silently running without a captcha. Previews
 * can use Cloudflare's published test keys.
 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8000;

export type TurnstileMode = "enforced" | "off" | "missing";

type TurnstileEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
};

/** "missing" means production without both keys: signup must be refused. */
export function turnstileMode(env: TurnstileEnv = process.env): TurnstileMode {
  const hasKeys = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim());
  if (hasKeys) return "enforced";
  return env.NODE_ENV === "production" ? "missing" : "off";
}

export function isTurnstileEnabled(): boolean {
  return turnstileMode() === "enforced";
}

export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TURNSTILE_TIMEOUT_MS);
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
