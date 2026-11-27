/**
 * Pure ad spend helpers: amount parsing, formatting, currencies, entry
 * selection for a date range and the input schemas. No Next or Supabase imports.
 */
import { z } from "zod";

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** 1,000,000,000.00 in cents, the database ceiling. */
export const MAX_AMOUNT_CENTS = 100_000_000_000;

export const SPEND_MESSAGES = {
  amount: "Enter an amount like 1250 or 1250.50.",
  currency: "Choose the currency.",
  dateOrder: "The end date must be on or after the start date.",
  note: "Keep the note under 200 characters.",
  startDate: "Choose a start date.",
  endDate: "Choose an end date.",
  wrongForm: "Choose a form from your own account.",
  saved: "Ad spend saved.",
  deleted: "Ad spend entry deleted.",
  cleared: "Ad spend cleared."
} as const;

/** "1,234.56", "$1234.5", "1234" -> cents; rejects negatives, more than 2 decimals, letters, above 1,000,000,000.00. */
export function parseAmountToCents(input: string): { ok: true; cents: number } | { ok: false; message: string } {
  const cleaned = String(input ?? "")
    .trim()
    .replace(/^\$/, "")
    .replace(/,/g, "")
    .trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return { ok: false, message: SPEND_MESSAGES.amount };
  const whole = match[1].replace(/^0+(?=\d)/, "");
  if (whole.length > 10) return { ok: false, message: SPEND_MESSAGES.amount };
  const cents = Number(whole) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_AMOUNT_CENTS) {
    return { ok: false, message: SPEND_MESSAGES.amount };
  }
  return { ok: true, cents };
}

/** Intl en-US currency format, for example "$1,234.56" or "CA$1,234.56". */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

/** Cents as a plain input value, for example 123450 -> "1234.50". */
export function centsToInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

type RangeEntry = { periodStart: string; periodEnd: string; amountCents: number; currency: string };

/**
 * Entries fully inside [from, to] (dates as YYYY-MM-DD). Returns the included
 * entries, the total by currency, and how many entries overlap the range but
 * start before it or end after it (left out). Entries wholly outside the range
 * are not counted as left out.
 */
export function selectEntriesForRange<T extends RangeEntry>(
  entries: T[],
  from: string,
  to: string
): { included: T[]; totals: Record<string, number>; excludedCount: number } {
  const included: T[] = [];
  const totals: Record<string, number> = {};
  let excludedCount = 0;
  for (const entry of entries) {
    if (entry.periodStart >= from && entry.periodEnd <= to) {
      included.push(entry);
      totals[entry.currency] = (totals[entry.currency] ?? 0) + entry.amountCents;
    } else if (entry.periodStart <= to && entry.periodEnd >= from) {
      excludedCount += 1;
    }
  }
  return { included, totals, excludedCount };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

const amountField = z
  .string({ required_error: SPEND_MESSAGES.amount, invalid_type_error: SPEND_MESSAGES.amount })
  .transform((value, context) => {
    const parsed = parseAmountToCents(value);
    if (!parsed.ok) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: parsed.message });
      return z.NEVER;
    }
    return parsed.cents;
  });

const currencyField = z.enum(CURRENCIES, {
  errorMap: () => ({ message: SPEND_MESSAGES.currency })
});

const noteField = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() ? value.trim() : null))
  .refine((value) => value === null || value.length <= 200, { message: SPEND_MESSAGES.note });

/** Spend for one form in a split test (covers the whole test). */
export const testSpendSchema = z.object({
  amount: amountField,
  currency: currencyField,
  note: noteField
});

/** Single-form spend with a period. */
export const spendEntrySchema = z
  .object({
    amount: amountField,
    currency: currencyField,
    period_start: z.string({ required_error: SPEND_MESSAGES.startDate }).refine(isRealDate, { message: SPEND_MESSAGES.startDate }),
    period_end: z.string({ required_error: SPEND_MESSAGES.endDate }).refine(isRealDate, { message: SPEND_MESSAGES.endDate }),
    note: noteField
  })
  .refine((value) => value.period_end >= value.period_start, {
    message: SPEND_MESSAGES.dateOrder,
    path: ["period_end"]
  });

export type SpendEntryInput = z.output<typeof spendEntrySchema>;
export type TestSpendInput = z.output<typeof testSpendSchema>;

/** First user message from a Zod error, else null. */
export function firstZodMessage(error: unknown): string | null {
  if (!(error instanceof z.ZodError)) return null;
  return error.issues.find((issue) => issue.message)?.message ?? null;
}

/** Maps the database scope trigger errors to the user message. */
export function spendMessageFromError(message: string): string | null {
  return /FORMBOOK_SPEND:/.test(message) ? SPEND_MESSAGES.wrongForm : null;
}
