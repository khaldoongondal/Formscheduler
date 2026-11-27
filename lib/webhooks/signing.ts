/**
 * Webhook signatures (decision C18): HMAC-SHA256 over "{timestamp}.{raw body}"
 * with the connection's secret. Pure: node:crypto only.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { CrmEventType } from "@/lib/connections/types";

export const SIGNATURE_HEADER = "X-FormBook-Signature";
export const TIMESTAMP_HEADER = "X-FormBook-Timestamp";
export const WEBHOOK_USER_AGENT = "FormBook-Webhooks/1.0";
export const WEBHOOK_SECRET_PATTERN = /^[\x21-\x7e]{24,200}$/;
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

function hmacHex(secret: string, timestampSec: number, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestampSec}.${rawBody}`, "utf8").digest("hex");
}

/** "t={ts},v1={hex}" */
export function signPayload(secret: string, timestampSec: number, rawBody: string): string {
  return `t=${timestampSec},v1=${hmacHex(secret, timestampSec, rawBody)}`;
}

/** Parses "t=...,v1=...,v1=..." into its timestamp and every v1 value. */
export function parseSignatureHeader(header: string | null | undefined): { t: number; v1: string[] } | null {
  if (typeof header !== "string" || header.length > 2000) return null;
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t" && /^\d{1,12}$/.test(value)) t = Number(value);
    if (key === "v1" && /^[0-9a-f]{64}$/i.test(value)) v1.push(value.toLowerCase());
  }
  if (t === null || !v1.length) return null;
  return { t, v1 };
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/** Timing safe; any v1 value may match (secret rotation); rejects timestamps outside the tolerance either way. */
export function verifySignature(
  header: string | null,
  rawBody: string,
  secret: string,
  nowSec: number,
  toleranceSec = DEFAULT_SIGNATURE_TOLERANCE_SECONDS
): boolean {
  const parsed = parseSignatureHeader(header);
  if (!parsed || !secret) return false;
  if (Math.abs(nowSec - parsed.t) > toleranceSec) return false;
  const expected = hmacHex(secret, parsed.t, rawBody);
  let matched = false;
  for (const candidate of parsed.v1) {
    if (safeEqualHex(candidate, expected)) matched = true;
  }
  return matched;
}

export function webhookHeaders(input: {
  secret: string;
  timestampSec: number;
  rawBody: string;
  eventType: CrmEventType;
  deliveryId: string;
  eventId: string;
}): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": WEBHOOK_USER_AGENT,
    "X-FormBook-Event": input.eventType,
    "X-FormBook-Event-Id": input.eventId,
    "X-FormBook-Delivery": input.deliveryId,
    [TIMESTAMP_HEADER]: String(input.timestampSec),
    [SIGNATURE_HEADER]: signPayload(input.secret, input.timestampSec, input.rawBody)
  };
}
