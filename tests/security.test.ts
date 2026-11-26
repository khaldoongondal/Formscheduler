import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getClientIp } from "@/lib/security/client-ip";
import { sniffImageMime, EXTENSION_BY_MIME } from "@/lib/security/image-sniff";
import { DAILY_CAPS, IP_LIMITS } from "@/lib/security/limits";
import { randomSuffix } from "@/lib/security/random";
import {
  buildBucketKey,
  hashSubject,
  isOverLimit,
  utcDayStartSeconds,
  windowResetSeconds,
  windowStartSeconds
} from "@/lib/security/rate-limit-core";
import { safeNextPath } from "@/lib/security/safe-redirect";

function headersOf(values: Record<string, string>) {
  return new Headers(values);
}

describe("getClientIp", () => {
  it("prefers the Vercel header over a spoofed x-forwarded-for", () => {
    const headers = headersOf({
      "x-vercel-forwarded-for": "203.0.113.7",
      "x-real-ip": "198.51.100.2",
      "x-forwarded-for": "6.6.6.6, 203.0.113.7"
    });
    assert.equal(getClientIp(headers), "203.0.113.7");
  });

  it("uses x-real-ip next", () => {
    const headers = headersOf({ "x-real-ip": "198.51.100.2", "x-forwarded-for": "6.6.6.6" });
    assert.equal(getClientIp(headers), "198.51.100.2");
  });

  it("uses the first x-forwarded-for entry last", () => {
    assert.equal(getClientIp(headersOf({ "x-forwarded-for": " 192.0.2.1 , 10.0.0.1" })), "192.0.2.1");
  });

  it("strips an IPv4 port and lowercases IPv6", () => {
    assert.equal(getClientIp(headersOf({ "x-real-ip": "192.0.2.9:51234" })), "192.0.2.9");
    assert.equal(getClientIp(headersOf({ "x-real-ip": "2001:DB8::1" })), "2001:db8::1");
    assert.equal(getClientIp(headersOf({ "x-real-ip": "[2001:DB8::1]:443" })), "2001:db8::1");
  });

  it("returns unknown when no header is present", () => {
    assert.equal(getClientIp(new Headers()), "unknown");
  });

  it("caps the length at 64 characters", () => {
    assert.equal(getClientIp(headersOf({ "x-real-ip": "a".repeat(200) })).length, 64);
  });
});

describe("rate limit window maths", () => {
  it("computes the window start", () => {
    assert.equal(windowStartSeconds(1_700_000_059_999, 60), 1_700_000_040);
  });

  it("computes seconds until reset", () => {
    assert.equal(windowResetSeconds(1_700_000_040_000, 60), 60);
    assert.equal(windowResetSeconds(1_700_000_099_500, 60), 1);
    assert.equal(windowResetSeconds(1_700_000_099_999, 60), 1);
  });

  it("computes the UTC day start", () => {
    assert.equal(
      utcDayStartSeconds(Date.parse("2026-11-26T23:59:59Z")),
      Date.parse("2026-11-26T00:00:00Z") / 1000
    );
  });

  it("allows exactly the limit", () => {
    assert.equal(isOverLimit(5, 5), false);
    assert.equal(isOverLimit(6, 5), true);
  });
});

describe("bucket keys and hashing", () => {
  it("builds scope:subject:window keys", () => {
    assert.equal(buildBucketKey("analytics", "abc", 1_700_000_040), "analytics:abc:1700000040");
    assert.equal(buildBucketKey("cap-lead", "form-1", 0), "cap-lead:form-1:0");
  });

  it("rejects an invalid scope", () => {
    assert.throws(() => buildBucketKey("Bad Scope", "abc", 0));
    assert.throws(() => buildBucketKey("", "abc", 0));
    assert.throws(() => buildBucketKey("a".repeat(41), "abc", 0));
  });

  it("hashes deterministically to 32 hex characters, salted", () => {
    const first = hashSubject("203.0.113.7", "salt-a");
    assert.equal(first, hashSubject("203.0.113.7", "salt-a"));
    assert.match(first, /^[0-9a-f]{32}$/);
    assert.notEqual(first, hashSubject("203.0.113.7", "salt-b"));
  });

  it("keeps every key within the 200 character column limit", () => {
    const subject = hashSubject("x", "y");
    for (const scope of [...Object.keys(IP_LIMITS), "cap-lead", "cap-analytics", "cap-report"]) {
      assert.ok(buildBucketKey(scope, subject, 1_800_000_000).length <= 200);
    }
    const tenantKey = buildBucketKey("cap-analytics", "tenant-00000000-0000-0000-0000-000000000001", 1_800_000_000);
    assert.ok(tenantKey.length <= 200);
  });

  it("defines positive limits and caps", () => {
    for (const { limit, windowSeconds } of Object.values(IP_LIMITS)) {
      assert.ok(limit > 0 && windowSeconds > 0 && windowSeconds <= 172800);
    }
    for (const cap of Object.values(DAILY_CAPS)) assert.ok(cap > 0);
  });
});

describe("safeNextPath", () => {
  it("accepts same-site paths with query and hash", () => {
    assert.equal(safeNextPath("/admin/funnels?x=1#y"), "/admin/funnels?x=1#y");
  });

  it("rejects other origins and tricks", () => {
    for (const value of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "/admin\nSet-Cookie: x",
      "/admin\\path",
      "admin/funnels"
    ]) {
      assert.equal(safeNextPath(value), "/admin/funnels", value);
    }
  });

  it("falls back for empty and non-string values", () => {
    assert.equal(safeNextPath(""), "/admin/funnels");
    assert.equal(safeNextPath(undefined), "/admin/funnels");
    assert.equal(safeNextPath(null, "/login"), "/login");
  });
});

describe("randomSuffix", () => {
  it("has the requested length and alphabet", () => {
    assert.match(randomSuffix(), /^[a-z0-9]{6}$/);
    assert.match(randomSuffix(10), /^[a-z0-9]{10}$/);
  });

  it("rarely repeats", () => {
    const values = new Set(Array.from({ length: 1000 }, () => randomSuffix()));
    assert.ok(values.size > 990);
  });
});

describe("sniffImageMime", () => {
  it("detects PNG, JPEG and WebP", () => {
    assert.equal(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])), "image/png");
    assert.equal(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
    const webp = new Uint8Array([...Buffer.from("RIFF"), 0x24, 0, 0, 0, ...Buffer.from("WEBP"), 0, 0, 0, 0]);
    assert.equal(sniffImageMime(webp), "image/webp");
  });

  it("rejects SVG text and GIF", () => {
    assert.equal(sniffImageMime(new Uint8Array(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'>"))), null);
    assert.equal(sniffImageMime(new Uint8Array(Buffer.from("GIF89a\u0000\u0000"))), null);
    assert.equal(sniffImageMime(new Uint8Array([])), null);
  });

  it("maps types to extensions", () => {
    assert.deepEqual(EXTENSION_BY_MIME, { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" });
  });
});
