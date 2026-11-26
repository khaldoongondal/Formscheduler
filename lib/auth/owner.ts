/**
 * Platform-owner check (pure). The owner list comes from FORMBOOK_OWNER_EMAILS,
 * a comma or whitespace separated list of email addresses. No Next.js or
 * Supabase imports here so node:test can load it.
 */

export function parseOwnerEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0)
  );
}

export function isOwnerEmail(email: string | null | undefined, raw: string | undefined): boolean {
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return false;
  const owners = parseOwnerEmails(raw);
  if (owners.size === 0) return false;
  return owners.has(normalized);
}

/** Local fixture bypass, the same rule as getAdminTenantContext (decision D15). */
export function isDevOwnerBypass(env: { NODE_ENV?: string; LEADDER_DEFAULT_TENANT_ID?: string }): boolean {
  return env.NODE_ENV !== "production" && Boolean(env.LEADDER_DEFAULT_TENANT_ID);
}

export const DEV_OWNER_EMAIL = "dev-owner@localhost";
