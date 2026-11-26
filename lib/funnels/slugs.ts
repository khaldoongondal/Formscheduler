/**
 * Form address (slug) rules: format, reserved addresses and blocked words.
 * Pure module. Slugs are globally unique, so these rules are global too.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 80;

export const SLUG_FORMAT_MESSAGE = "Use 3 to 80 lowercase letters, numbers and single hyphens, like growth-call.";
export const SLUG_RESERVED_MESSAGE = "That address is reserved. Please choose another.";
export const SLUG_BLOCKED_MESSAGE =
  "That address is not allowed because it could be mistaken for a sign-in or payment page. Please choose another.";

/** Exact matches that collide with app routes or the brand. */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "admin",
  "api",
  "app",
  "assets",
  "auth",
  "billing",
  "blog",
  "book",
  "clients",
  "dashboard",
  "demo",
  "docs",
  "dpa",
  "embed",
  "favicon",
  "formbook",
  "gondal",
  "gondaltech",
  "help",
  "home",
  "leadder",
  "login",
  "logout",
  "new",
  "null",
  "owner",
  "pricing",
  "privacy",
  "register",
  "report",
  "reset-password",
  "root",
  "settings",
  "set-password",
  "signin",
  "signup",
  "static",
  "status",
  "support",
  "terms",
  "undefined",
  "welcome",
  "www",
  "_next"
]);

/** Any hyphen-separated token equal to one of these is blocked. */
export const BLOCKED_TOKENS: ReadonlySet<string> = new Set([
  "paypal",
  "venmo",
  "zelle",
  "stripe",
  "apple",
  "appleid",
  "icloud",
  "microsoft",
  "office365",
  "outlook",
  "hotmail",
  "google",
  "gmail",
  "facebook",
  "instagram",
  "whatsapp",
  "meta",
  "amazon",
  "netflix",
  "coinbase",
  "binance",
  "metamask",
  "ledger",
  "wallet",
  "bank",
  "banking",
  "irs",
  "cra",
  "hmrc",
  "login",
  "signin",
  "password",
  "verify",
  "verification",
  "secure",
  "recovery",
  "2fa",
  "otp"
]);

/** Blocked when found anywhere in the slug. */
export const BLOCKED_PHRASES: readonly string[] = [
  "apple-id",
  "verify-account",
  "account-verify",
  "reset-password",
  "update-payment",
  "unlock-account",
  "wallet-connect",
  "seed-phrase"
];

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export type SlugCheck = { ok: true; slug: string } | { ok: false; message: string };

export function normalizeSlug(input: string): string {
  return input.trim().toLowerCase();
}

export function checkSlug(input: string): SlugCheck {
  const slug = normalizeSlug(input);

  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, message: SLUG_RESERVED_MESSAGE };
  }

  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_PATTERN.test(slug) || slug.includes("--")) {
    return { ok: false, message: SLUG_FORMAT_MESSAGE };
  }

  if (slug.split("-").some((token) => BLOCKED_TOKENS.has(token))) {
    return { ok: false, message: SLUG_BLOCKED_MESSAGE };
  }

  if (BLOCKED_PHRASES.some((phrase) => slug.includes(phrase))) {
    return { ok: false, message: SLUG_BLOCKED_MESSAGE };
  }

  return { ok: true, slug };
}

/** `${base}-copy-${suffix}`, with the base trimmed so the total stays within SLUG_MAX. */
export function buildCopySlug(sourceSlug: string, suffix: string): string {
  const tail = `-copy-${suffix}`;
  const maxBase = Math.max(0, SLUG_MAX - tail.length);
  const base = normalizeSlug(sourceSlug)
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, maxBase)
    .replace(/^-+|-+$/g, "");
  return base ? `${base}${tail}` : `form${tail}`;
}
