/**
 * Bearer check for cron routes. Pure: only node:crypto.
 *
 * Vercel sends `Authorization: Bearer $CRON_SECRET`. Without a secret the
 * route is open only outside production. The comparison hashes both sides
 * first so it takes the same time whatever the input length.
 */

import { createHash, timingSafeEqual } from "node:crypto";

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isCronAuthorized(
  authorizationHeader: string | null,
  secret: string | undefined,
  isProduction: boolean
): boolean {
  if (!secret) return !isProduction;
  if (!authorizationHeader) return false;
  return timingSafeEqual(digest(authorizationHeader), digest(`Bearer ${secret}`));
}
