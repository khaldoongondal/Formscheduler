/**
 * The atomic status guard for lead sessions. Pure: no Next.js, Supabase or I/O imports.
 */
import type { LeadSessionStatus } from "@/lib/types/database";

export type StatusUpdateOptions = {
  /** The row is changed only when its current status is not one of these (one conditional update). */
  unlessStatusIn: LeadSessionStatus[];
};

/** Thrown when the guard left the row unchanged because its status is one to keep. */
export class LeadStatusKeptError extends Error {
  constructor() {
    super("Lead status kept.");
    this.name = "LeadStatusKeptError";
  }
}

export function isLeadStatusKept(error: unknown): boolean {
  return error instanceof LeadStatusKeptError || (error instanceof Error && error.name === "LeadStatusKeptError");
}
