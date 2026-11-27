import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CURRENCIES,
  SPEND_MESSAGES,
  centsToInput,
  firstZodMessage,
  formatMoney,
  parseAmountToCents,
  selectEntriesForRange,
  spendEntrySchema,
  spendMessageFromError,
  testSpendSchema
} from "@/lib/spend/money";

const EM_DASH = String.fromCharCode(0x2014);

describe("parseAmountToCents", () => {
  it("accepts common formats", () => {
    assert.deepEqual(parseAmountToCents("1,234.56"), { ok: true, cents: 123456 });
    assert.deepEqual(parseAmountToCents("$1234.5"), { ok: true, cents: 123450 });
    assert.deepEqual(parseAmountToCents("1234"), { ok: true, cents: 123400 });
    assert.deepEqual(parseAmountToCents(" 0.99 "), { ok: true, cents: 99 });
    assert.deepEqual(parseAmountToCents("1000000000.00"), { ok: true, cents: 100_000_000_000 });
  });

  it("rejects negatives, extra decimals, letters and too large amounts", () => {
    for (const input of ["-5", "1.234", "abc", "1000000000.01", "", "12a", "1.2.3", "99999999999"]) {
      const result = parseAmountToCents(input);
      assert.equal(result.ok, false, input);
      if (!result.ok) assert.equal(result.message, SPEND_MESSAGES.amount);
    }
  });
});

describe("selectEntriesForRange", () => {
  const entries = [
    { periodStart: "2026-11-01", periodEnd: "2026-11-07", amountCents: 10_000, currency: "USD" },
    { periodStart: "2026-11-24", periodEnd: "2026-11-30", amountCents: 5_000, currency: "USD" },
    { periodStart: "2026-10-28", periodEnd: "2026-11-02", amountCents: 7_000, currency: "USD" },
    { periodStart: "2026-11-29", periodEnd: "2026-12-03", amountCents: 3_000, currency: "USD" },
    { periodStart: "2026-11-10", periodEnd: "2026-11-12", amountCents: 2_000, currency: "CAD" },
    { periodStart: "2026-09-01", periodEnd: "2026-09-30", amountCents: 9_000, currency: "USD" }
  ];

  it("includes entries that touch both edges and leaves out overlaps", () => {
    const result = selectEntriesForRange(entries, "2026-11-01", "2026-11-30");
    assert.equal(result.included.length, 3);
    assert.deepEqual(result.totals, { USD: 15_000, CAD: 2_000 });
    // The October and December overlaps are left out; September is unrelated.
    assert.equal(result.excludedCount, 2);
  });

  it("returns nothing for an empty range of entries", () => {
    assert.deepEqual(selectEntriesForRange([], "2026-11-01", "2026-11-30"), { included: [], totals: {}, excludedCount: 0 });
  });
});

describe("formatMoney", () => {
  it("formats with Intl en-US", () => {
    assert.equal(formatMoney(123456, "USD"), "$1,234.56");
    assert.equal(formatMoney(15_000, "USD"), "$150.00");
    assert.equal(formatMoney(123456, "CAD"), "CA$1,234.56");
    assert.equal(centsToInput(123450), "1234.50");
  });

  it("knows the five currencies", () => {
    assert.deepEqual([...CURRENCIES], ["USD", "CAD", "EUR", "GBP", "AUD"]);
  });
});

describe("spend schemas", () => {
  const valid = { amount: "1250.50", currency: "USD", period_start: "2026-11-01", period_end: "2026-11-07", note: "" };

  it("parses a valid entry to cents and a null note", () => {
    const parsed = spendEntrySchema.parse(valid);
    assert.equal(parsed.amount, 125050);
    assert.equal(parsed.note, null);
  });

  it("accepts a one-day period", () => {
    assert.equal(spendEntrySchema.safeParse({ ...valid, period_end: "2026-11-01" }).success, true);
  });

  it("rejects an end date before the start date", () => {
    const result = spendEntrySchema.safeParse({ ...valid, period_end: "2026-10-31" });
    assert.equal(result.success, false);
    if (!result.success) assert.equal(firstZodMessage(result.error), SPEND_MESSAGES.dateOrder);
  });

  it("rejects bad dates, currencies, amounts and long notes with plain messages", () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ ...valid, period_start: "2026-02-30" }, SPEND_MESSAGES.startDate],
      [{ ...valid, currency: "JPY" }, SPEND_MESSAGES.currency],
      [{ ...valid, amount: "-1" }, SPEND_MESSAGES.amount],
      [{ ...valid, note: "x".repeat(201) }, SPEND_MESSAGES.note]
    ];
    for (const [input, message] of cases) {
      const result = spendEntrySchema.safeParse(input);
      assert.equal(result.success, false);
      if (!result.success) assert.equal(firstZodMessage(result.error), message);
    }
  });

  it("parses test spend without a period", () => {
    const parsed = testSpendSchema.parse({ amount: "18,000", currency: "EUR", note: " launch " });
    assert.deepEqual(parsed, { amount: 1_800_000, currency: "EUR", note: "launch" });
  });

  it("maps database scope errors and keeps copy free of em dashes", () => {
    assert.equal(spendMessageFromError("FORMBOOK_SPEND:not_member"), SPEND_MESSAGES.wrongForm);
    assert.equal(spendMessageFromError("other error"), null);
    for (const message of Object.values(SPEND_MESSAGES)) assert.equal(message.includes(EM_DASH), false);
  });
});
