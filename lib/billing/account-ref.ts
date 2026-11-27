/**
 * The opaque account reference (tenants.account_ref, migration 0032) and the
 * owner links built from it. Pure: no Next.js or Supabase imports.
 *
 * The reference is "fba_" plus 24 lowercase hex characters. It is not a
 * secret (it allows nothing without the provision secret), and it is the only
 * account identifier that ever leaves the app in a URL. It never encodes an
 * email, a name or an id.
 */

export const ACCOUNT_REF_PATTERN = /^fba_[0-9a-f]{24}$/;
export const UPGRADE_REF_PARAM = "ref";
const MAX_LINK_LENGTH = 2000;

export function isAccountRef(value: unknown): value is string {
  return typeof value === "string" && ACCOUNT_REF_PATTERN.test(value);
}

/** Trim and lowercase, then the exact pattern; anything else gives null. */
export function normalizeAccountRef(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return ACCOUNT_REF_PATTERN.test(normalized) ? normalized : null;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * An owner link from an env value. https only; http only for localhost or
 * 127.0.0.1 when allowHttpLocalhost is set. Null when unset or invalid, when
 * the URL carries credentials, or when it is over 2000 characters.
 */
export function parseOwnerLink(
  raw: string | undefined | null,
  opts: { allowHttpLocalhost?: boolean } = {}
): URL | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > MAX_LINK_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && opts.allowHttpLocalhost === true && isLocalHost(url.hostname)) return url;
  return null;
}

/**
 * The upgrade (checkout) link with ?ref=<account_ref> set, replacing any ref
 * the base already has and keeping every other parameter. Null when the base
 * or the reference is invalid.
 */
export function buildUpgradeUrl(
  base: string | undefined | null,
  accountRef: string,
  opts: { allowHttpLocalhost?: boolean } = {}
): string | null {
  const ref = normalizeAccountRef(accountRef);
  if (!ref) return null;
  const url = parseOwnerLink(base, opts);
  if (!url) return null;
  url.searchParams.set(UPGRADE_REF_PARAM, ref);
  const result = url.toString();
  return result.length > MAX_LINK_LENGTH ? null : result;
}

export type PlanLinkEnv = {
  FORMBOOK_UPGRADE_URL?: string;
  FORMBOOK_BILLING_PORTAL_URL?: string;
  NODE_ENV?: string;
};

/**
 * The Plan page links from env values (pass process.env). http://localhost is
 * accepted only outside production. Each link is null when unset or invalid;
 * the upgrade link is also null without a valid account reference.
 */
export function planLinks(
  env: PlanLinkEnv,
  accountRef: string | null
): { upgradeUrl: string | null; billingPortalUrl: string | null } {
  const opts = { allowHttpLocalhost: env.NODE_ENV !== "production" };
  return {
    upgradeUrl: accountRef ? buildUpgradeUrl(env.FORMBOOK_UPGRADE_URL, accountRef, opts) : null,
    billingPortalUrl: buildBillingPortalUrl(env.FORMBOOK_BILLING_PORTAL_URL, opts)
  };
}

/** The billing portal link as given: no parameter is added (the portal signs the customer in itself). */
export function buildBillingPortalUrl(
  base: string | undefined | null,
  opts: { allowHttpLocalhost?: boolean } = {}
): string | null {
  const url = parseOwnerLink(base, opts);
  return url && typeof base === "string" ? base.trim() : null;
}
