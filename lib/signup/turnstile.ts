/**
 * The existing signup widget is verified on the server before account creation.
 */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TURNSTILE_TIMEOUT_MS = 8000;

export type TurnstileMode = "enforced" | "off" | "missing";

type TurnstileEnv = {
  NODE_ENV?: string;
  NEXT_PUBLIC_TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_HOSTNAMES?: string;
};

function expectedHostnames(env: TurnstileEnv): string[] {
  const hosts = (env.TURNSTILE_HOSTNAMES ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  const valid = hosts.every((host) => {
    if (!/^[a-z0-9-]+(?:\.[a-z0-9-]+)*$/.test(host)) return false;
    return env.NODE_ENV !== "production" ||
      (host !== "localhost" && !host.endsWith(".localhost") && !host.startsWith("127."));
  });
  return valid ? hosts : [];
}

export function turnstileMode(env: TurnstileEnv = process.env): TurnstileMode {
  const hasKeys = Boolean(env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() && env.TURNSTILE_SECRET_KEY?.trim());
  if (hasKeys) return expectedHostnames(env).length ? "enforced" : "missing";
  return env.NODE_ENV === "production" ? "missing" : "off";
}

export function isTurnstileEnabled(): boolean {
  return turnstileMode() === "enforced";
}

export async function verifyTurnstile(token: string | null, ip: string, env: TurnstileEnv = process.env): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim();
  const hosts = expectedHostnames(env);
  if (!secret || !token?.trim() || token.length > 2048 || !hosts.length) return false;

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
    const result = (await response.json()) as { success?: unknown; action?: unknown; hostname?: unknown };
    return result.success === true && result.action === "signup" &&
      typeof result.hostname === "string" && hosts.includes(result.hostname.toLowerCase());
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
