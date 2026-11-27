/**
 * Normalising and hashing of personal data for the Meta Conversions API.
 * Pure: only node:crypto, no Next.js or Supabase imports.
 *
 * Meta wants email, phone, names and location lowercased, trimmed and hashed
 * with SHA-256 before they leave our server. IP address, browser, fbc and fbp
 * are sent as they are. Empty values are left out so we never send the hash
 * of an empty string.
 */

import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function clean(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed ? trimmed : null;
}

export function normalizeEmail(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  return lowered.includes("@") ? lowered : null;
}

export function normalizePhone(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

export function normalizeName(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

/** Accents folded ("Montréal" -> "montreal"), then only a-z kept. */
export function normalizeCity(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const folded = trimmed
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return folded || null;
}

export function normalizeRegion(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalized || null;
}

export function normalizeCountry(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  return /^[a-z]{2}/.test(lowered) ? lowered.slice(0, 2) : null;
}

export function normalizeExternalId(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  return trimmed ? trimmed.toLowerCase() : null;
}

export type UserDataInput = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  externalIds?: Array<string | null | undefined>;
  clientIp?: string | null;
  userAgent?: string | null;
  fbc?: string | null;
  fbp?: string | null;
};

export type MetaUserData = Record<string, string | string[]>;

/**
 * Hashed (arrays): em, ph, fn, ln, ct, st, country, external_id.
 * Plain: client_ip_address, client_user_agent, fbc, fbp.
 * `matchKeys` lists the Meta field names included, in that order.
 */
export function buildUserData(input: UserDataInput): { userData: MetaUserData; matchKeys: string[] } {
  const userData: MetaUserData = {};
  const matchKeys: string[] = [];

  const addHashed = (key: string, normalized: string | null) => {
    if (!normalized) return;
    userData[key] = [sha256Hex(normalized)];
    matchKeys.push(key);
  };

  addHashed("em", normalizeEmail(input.email));
  addHashed("ph", normalizePhone(input.phone));
  addHashed("fn", normalizeName(input.firstName));
  addHashed("ln", normalizeName(input.lastName));
  addHashed("ct", normalizeCity(input.city));
  addHashed("st", normalizeRegion(input.region));
  addHashed("country", normalizeCountry(input.country));

  const externalIds = [
    ...new Set((input.externalIds ?? []).map((value) => normalizeExternalId(value)).filter((value): value is string => Boolean(value)))
  ];
  if (externalIds.length) {
    userData.external_id = externalIds.map(sha256Hex);
    matchKeys.push("external_id");
  }

  const addPlain = (key: string, value: string | null | undefined) => {
    const trimmed = clean(value);
    if (!trimmed) return;
    userData[key] = trimmed;
    matchKeys.push(key);
  };

  addPlain("client_ip_address", input.clientIp);
  addPlain("client_user_agent", input.userAgent);
  addPlain("fbc", input.fbc);
  addPlain("fbp", input.fbp);

  return { userData, matchKeys };
}
