import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserData,
  normalizeCity,
  normalizeCountry,
  normalizeEmail,
  normalizeExternalId,
  normalizeName,
  normalizePhone,
  normalizeRegion,
  sha256Hex
} from "@/lib/meta/hash";

const VECTORS = {
  email: "973dfe463ec85785f5f95af5ba3906eedb2d931c24e69824a89ea65dba4e813b",
  phone: "676ba87cf06b7ab956f275a804660c3a1abea48fa8a50329c03f80740472dfc7",
  john: "96d9632f363564cc3032521409cf22a852f2032eec099ed5967c0d000cec607a",
  doe: "799ef92a11af918e3fb741df42934f3b568ed2d93ac1df74f1b8d41a27932a6f",
  montreal: "94a2d00996233e393e547a3ad49fa82efeeac1210a8fdf11dde35a23b7333ac0",
  on: "b8d31e852725afb1e26d53bab6095b2bff1749c9275be13ed1c05a56ed31ec09",
  ca: "6959097001d10501ac7d54c0bdb8db61420f658f2922cc26e46d536119a31126",
  externalId: "d1bfaf4aff653cb27984b7d978e51a7d406d1572df95d205c254beb18dc134d3"
};

describe("normalising and hashing (known vectors)", () => {
  it("email", () => {
    assert.equal(sha256Hex("test@example.com"), VECTORS.email);
    assert.equal(normalizeEmail("  Test@Example.com "), "test@example.com");
    assert.equal(normalizeEmail("no-at-sign"), null);
  });

  it("phone", () => {
    assert.equal(normalizePhone("+1 (416) 555-0100"), "14165550100");
    assert.equal(sha256Hex("14165550100"), VECTORS.phone);
    assert.equal(normalizePhone("12-34"), null);
  });

  it("names", () => {
    assert.equal(normalizeName(" John "), "john");
    assert.equal(sha256Hex("john"), VECTORS.john);
    assert.equal(sha256Hex(normalizeName("Doe")!), VECTORS.doe);
  });

  it("city with accents folded", () => {
    assert.equal(normalizeCity("Montréal"), "montreal");
    assert.equal(sha256Hex("montreal"), VECTORS.montreal);
    assert.equal(normalizeCity("St. John's"), "stjohns");
  });

  it("region and country", () => {
    assert.equal(normalizeRegion("ON"), "on");
    assert.equal(sha256Hex("on"), VECTORS.on);
    assert.equal(normalizeCountry("CA"), "ca");
    assert.equal(sha256Hex("ca"), VECTORS.ca);
    assert.equal(normalizeCountry("1A"), null);
  });

  it("external id is lowercased before hashing", () => {
    assert.equal(sha256Hex(normalizeExternalId("3F2504E0-4F89-11D3-9A0C-0305E82C3301")!), VECTORS.externalId);
  });
});

describe("buildUserData", () => {
  it("leaves out empty and whitespace values", () => {
    const { userData, matchKeys } = buildUserData({
      email: "   ",
      phone: "",
      firstName: null,
      lastName: undefined,
      city: " ",
      clientIp: " ",
      userAgent: "",
      fbc: null,
      fbp: undefined,
      externalIds: ["", "  ", null]
    });
    assert.deepEqual(userData, {});
    assert.deepEqual(matchKeys, []);
  });

  it("orders keys, hashes into arrays, keeps IP, browser, fbc and fbp plain", () => {
    const { userData, matchKeys } = buildUserData({
      email: "Test@Example.com",
      phone: "+1 416 555 0100",
      firstName: "John",
      lastName: "Doe",
      city: "Montréal",
      region: "ON",
      country: "CA",
      externalIds: ["3F2504E0-4F89-11D3-9A0C-0305E82C3301"],
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0 (Example)",
      fbc: "fb.1.1700000000000.AbCdEf",
      fbp: "fb.1.1700000000000.123456789"
    });
    assert.deepEqual(matchKeys, [
      "em",
      "ph",
      "fn",
      "ln",
      "ct",
      "st",
      "country",
      "external_id",
      "client_ip_address",
      "client_user_agent",
      "fbc",
      "fbp"
    ]);
    assert.deepEqual(userData.em, [VECTORS.email]);
    assert.deepEqual(userData.ph, [VECTORS.phone]);
    assert.deepEqual(userData.fn, [VECTORS.john]);
    assert.deepEqual(userData.ln, [VECTORS.doe]);
    assert.deepEqual(userData.ct, [VECTORS.montreal]);
    assert.deepEqual(userData.st, [VECTORS.on]);
    assert.deepEqual(userData.country, [VECTORS.ca]);
    assert.deepEqual(userData.external_id, [VECTORS.externalId]);
    assert.equal(userData.client_ip_address, "203.0.113.7");
    assert.equal(userData.client_user_agent, "Mozilla/5.0 (Example)");
    assert.equal(userData.fbc, "fb.1.1700000000000.AbCdEf");
    assert.equal(userData.fbp, "fb.1.1700000000000.123456789");
  });

  it("de-duplicates external ids after normalising", () => {
    const { userData } = buildUserData({ externalIds: ["Visitor-ABC123", "visitor-abc123 ", "other-id-1"] });
    assert.deepEqual(userData.external_id, [sha256Hex("visitor-abc123"), sha256Hex("other-id-1")]);
  });
});
