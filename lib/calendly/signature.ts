/**
 * Calendly webhook signature check: header `Calendly-Webhook-Signature:
 * t={unix},v1={hex}`, HMAC-SHA256 of "{t}.{raw body}" with our signing key.
 * Pure: node:crypto only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { SIGNATURE_TOLERANCE_SECONDS } from "@/lib/calendly/constants";

export const CALENDLY_SIGNATURE_HEADER = "calendly-webhook-signature";

export function parseCalendlySignature(header: string | null | undefined): { t: number; v1: string[] } | null {
  if (typeof header !== "string" || !header || header.length > 2000) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) t = Number(value);
    else if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) v1.push(value.toLowerCase());
  }
  if (t === null || !v1.length) return null;
  return { t, v1 };
}

export function verifyCalendlySignature(
  header: string | null | undefined,
  rawBody: string,
  signingKey: string,
  nowSec: number,
  tolerance = SIGNATURE_TOLERANCE_SECONDS
): boolean {
  const parsed = parseCalendlySignature(header);
  if (!parsed || !signingKey) return false;
  if (Math.abs(nowSec - parsed.t) > tolerance) return false;
  const expected = Buffer.from(createHmac("sha256", signingKey).update(`${parsed.t}.${rawBody}`, "utf8").digest("hex"), "hex");
  let matched = false;
  for (const candidate of parsed.v1) {
    const given = Buffer.from(candidate, "hex");
    if (given.length === expected.length && timingSafeEqual(given, expected)) matched = true;
  }
  return matched;
}
