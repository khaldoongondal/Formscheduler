/**
 * Split test assignment. Pure: no Next.js or Supabase imports, so node:test
 * can load it.
 *
 * Every visitor of a split test gets one form with equal chances, and the same
 * visitor gets the same form every time (the bucket is a hash of the test id
 * and the visitor key).
 */
import { createHash } from "node:crypto";
import { hashSubject } from "@/lib/security/rate-limit-core";

export type SplitTestStatus = "draft" | "running" | "ended";
export type ArmCandidate = { funnelId: string; position: number; available: boolean };
export type ArmChoice = { funnelId: string; recorded: boolean };

export const SPLIT_TEST_MIN_ARMS = 2;
export const SPLIT_TEST_MAX_ARMS = 3;
export const SPLIT_ARM_LABELS = ["A", "B", "C"] as const;

/** Visitor ids made by the booking flow: a uuid, or `visitor_<base36>_<base36>`. */
export const VISITOR_KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export function isValidVisitorKey(value: unknown): value is string {
  return typeof value === "string" && VISITOR_KEY_PATTERN.test(value);
}

/**
 * sha256 hex of `${testId}:${visitorKey}`, the first 12 hex characters (48 bits)
 * read as an integer, modulo the number of arms. Throws unless armCount is 1 to 3.
 */
export function assignmentBucket(testId: string, visitorKey: string, armCount: number): number {
  if (!Number.isInteger(armCount) || armCount < 1 || armCount > SPLIT_TEST_MAX_ARMS) {
    throw new Error(`Invalid split test arm count: ${armCount}`);
  }
  const digest = createHash("sha256").update(`${testId}:${visitorKey}`).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % armCount;
}

/** Deterministic key when the browser blocks both cookies and storage. */
export function fallbackVisitorKey(ip: string, userAgent: string, salt: string): string {
  return `ipua:${hashSubject(`${ip}|${userAgent}`, salt)}`;
}

/**
 * Picks the form for one visitor (decisions S2 and S5).
 * - draft: null (the link is not live).
 * - running: bucket over every member by position; if that form is not
 *   available, bucket again over the available members with the same key, so
 *   visitors of the other forms keep their form. recorded = true.
 * - ended with an available winner: the winner, recorded = false.
 * - ended otherwise: the same split as running, recorded = false.
 * - no available member: null.
 */
export function chooseArm(
  test: { id: string; status: SplitTestStatus; winnerFunnelId: string | null },
  members: ArmCandidate[],
  visitorKey: string
): ArmChoice | null {
  if (test.status === "draft") return null;

  const sorted = [...members]
    .sort((left, right) => left.position - right.position)
    .slice(0, SPLIT_TEST_MAX_ARMS);
  const available = sorted.filter((member) => member.available);
  if (!available.length) return null;

  const recorded = test.status === "running";

  if (test.status === "ended" && test.winnerFunnelId) {
    const winner = available.find((member) => member.funnelId === test.winnerFunnelId);
    if (winner) return { funnelId: winner.funnelId, recorded: false };
  }

  const first = sorted[assignmentBucket(test.id, visitorKey, sorted.length)];
  if (first.available) return { funnelId: first.funnelId, recorded };

  const fallback = available[assignmentBucket(test.id, visitorKey, available.length)];
  return { funnelId: fallback.funnelId, recorded };
}

/** "A", "B" or "C" for a member position (1 to 3). */
export function splitArmLabel(position: number): string {
  return SPLIT_ARM_LABELS[position - 1] ?? String(position);
}
