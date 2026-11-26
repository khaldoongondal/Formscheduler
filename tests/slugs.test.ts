import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SLUG_BLOCKED_MESSAGE,
  SLUG_FORMAT_MESSAGE,
  SLUG_MAX,
  SLUG_RESERVED_MESSAGE,
  buildCopySlug,
  checkSlug
} from "@/lib/funnels/slugs";

const EM_DASH = String.fromCharCode(0x2014);

describe("checkSlug", () => {
  it("accepts a valid slug", () => {
    assert.deepEqual(checkSlug("growth-call"), { ok: true, slug: "growth-call" });
  });

  it("normalises case and whitespace", () => {
    assert.deepEqual(checkSlug("  Growth-Call "), { ok: true, slug: "growth-call" });
  });

  it("reserves app routes", () => {
    for (const slug of ["admin", "signup", "embed", "report", "dpa"]) {
      assert.deepEqual(checkSlug(slug), { ok: false, message: SLUG_RESERVED_MESSAGE }, slug);
    }
  });

  it("blocks sign-in and payment lookalikes", () => {
    for (const slug of ["paypal-login", "my-bank-offer", "apple-id-help", "verify-account-now"]) {
      assert.deepEqual(checkSlug(slug), { ok: false, message: SLUG_BLOCKED_MESSAGE }, slug);
    }
  });

  it("uses whole tokens, not substrings", () => {
    assert.equal(checkSlug("applesauce-recipes").ok, true);
    assert.equal(checkSlug("bankside-cafe").ok, true);
  });

  it("rejects bad formats", () => {
    for (const slug of ["a", "ab", "-bad", "bad-", "two--hyphens", "has space", "under_score", "x".repeat(81)]) {
      assert.deepEqual(checkSlug(slug), { ok: false, message: SLUG_FORMAT_MESSAGE }, slug);
    }
  });

  it("messages have no em dash", () => {
    for (const message of [SLUG_FORMAT_MESSAGE, SLUG_RESERVED_MESSAGE, SLUG_BLOCKED_MESSAGE]) {
      assert.ok(!message.includes(EM_DASH));
    }
  });
});

describe("buildCopySlug", () => {
  it("appends -copy-suffix", () => {
    assert.equal(buildCopySlug("growth-call", "abc123"), "growth-call-copy-abc123");
  });

  it("keeps an 80 character source within the limit and valid", () => {
    const source = `${"a".repeat(60)}-${"b".repeat(19)}`;
    assert.equal(source.length, 80);
    const copy = buildCopySlug(source, "abc123");
    assert.ok(copy.length <= SLUG_MAX);
    assert.equal(checkSlug(copy).ok, true);
  });

  it("does not leave a trailing hyphen after trimming", () => {
    const source = `${"a".repeat(67)}-${"b".repeat(12)}`;
    const copy = buildCopySlug(source, "abc123");
    assert.ok(!copy.includes("--"));
    assert.equal(checkSlug(copy).ok, true);
  });
});
