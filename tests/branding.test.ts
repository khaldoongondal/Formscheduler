import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { CONTACT_EMAIL, FALLBACK_CONTACT_EMAIL, contactEmailFrom } from "@/lib/billing/plans";
import { PLAN_COPY } from "@/lib/billing/plan-copy";
import { HOME_COPY, homeFaq } from "@/lib/marketing/home-copy";
import { DEFAULT_APP_URL, MAKER_FOOTER_LINE, SITE_DESCRIPTION } from "@/lib/marketing/site";
import { SETUP_CALL_COPY } from "@/lib/onboarding/checklist";

const ROOT = process.cwd();
const EM_DASH = String.fromCharCode(0x2014);

/** Source text with line endings normalised and comments removed. */
function code(file: string): string {
  return readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function rel(...parts: string[]): string {
  return path.join(ROOT, ...parts);
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

function resolveAlias(spec: string): string | null {
  const base = path.join(ROOT, spec.slice(2));
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Every file a public form route can load, following "@/" imports. */
function publicFormClosure(): { roots: string[]; all: string[] } {
  const roots = [
    ...["book", "embed", "t", "report", "preview"].flatMap((dir) => filesUnder(rel("app", dir))),
    ...filesUnder(rel("components", "booking"))
  ];
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const match of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](@\/[^"']+)["']/g)) {
      const target = resolveAlias(match[1]);
      if (target) queue.push(target);
    }
  }
  return { roots, all: [...seen] };
}

describe("company name on public form pages", () => {
  const { roots, all } = publicFormClosure();

  it("finds the public form routes and booking components", () => {
    assert.ok(roots.length >= 15, `only ${roots.length} root files found`);
    assert.ok(all.length > roots.length);
  });

  it("never names Gondal Tech in any text a form visitor can see", () => {
    // Case sensitive: internal identifiers such as useGondalAttributionFields
    // and reserved slug words are not visible text and are allowed.
    for (const file of all) {
      assert.doesNotMatch(code(file), /\bGondal\b/, path.relative(ROOT, file));
    }
  });

  it("keeps the company name and the contact address out of the form routes and booking components", () => {
    for (const file of roots) {
      const text = code(file);
      assert.doesNotMatch(text, /gondal/i, path.relative(ROOT, file));
      assert.doesNotMatch(text, /CONTACT_EMAIL/, path.relative(ROOT, file));
    }
  });

  it("keeps the badge as Powered by FormBook", () => {
    const badge = code(rel("components", "booking", "powered-by-badge.tsx"));
    assert.match(badge, /Powered by FormBook/);
  });
});

describe("maker footer line", () => {
  it("has the agreed wording, with no em dash", () => {
    assert.equal(MAKER_FOOTER_LINE, "FormBook is made by Gondal Tech.");
    assert.ok(!MAKER_FOOTER_LINE.includes(EM_DASH));
  });

  it("is the one source for the home, help and legal footers", () => {
    assert.equal(HOME_COPY.footerLine, MAKER_FOOTER_LINE);
    for (const file of [
      rel("components", "legal", "legal-page.tsx"),
      rel("app", "help", "connections", "page.tsx")
    ]) {
      assert.match(code(file), /\{MAKER_FOOTER_LINE\}/, file);
    }
  });

  it("is the only place the product copy names the company", () => {
    const { footerLine, ...rest } = HOME_COPY;
    void footerLine;
    assert.doesNotMatch(JSON.stringify(rest), /Gondal/);
    assert.doesNotMatch(JSON.stringify(homeFaq({ googleCalendar: true }, undefined, "help@example.com")), /Gondal/);
    assert.doesNotMatch(SITE_DESCRIPTION, /Gondal/);
    assert.doesNotMatch(JSON.stringify({ ...PLAN_COPY, contactEmail: "" }), /Gondal/);
    assert.doesNotMatch(JSON.stringify(SETUP_CALL_COPY), /Gondal/);
  });

  it("keeps the company out of the signed-in header, login and signup", () => {
    for (const file of [
      rel("app", "(admin)", "admin", "layout.tsx"),
      rel("app", "login", "page.tsx"),
      rel("app", "signup", "page.tsx"),
      rel("app", "(home)", "opengraph-image.tsx")
    ]) {
      assert.doesNotMatch(code(file), /Gondal/, file);
    }
  });

  it("legal pages drop the tagline but still name the company in the body", () => {
    assert.doesNotMatch(code(rel("components", "legal", "legal-page.tsx")), /a tool from Gondal Tech|review by Gondal/);
    for (const page of ["terms", "privacy", "dpa"]) {
      const text = code(rel("app", page, "page.tsx"));
      assert.doesNotMatch(text, /a tool from Gondal Tech/, page);
      assert.match(text, /Gondal Tech/, page);
      assert.doesNotMatch(text.match(/description:\s*"[^"]*"/)?.[0] ?? "", /Gondal/, page);
    }
  });
});

describe("main address", () => {
  it("is app.formbook.ca", () => {
    assert.equal(DEFAULT_APP_URL, "https://app.formbook.ca");
  });
});

describe("contact address", () => {
  it("uses FORMBOOK_SUPPORT_EMAIL when it is a valid address", () => {
    assert.equal(contactEmailFrom("support@example.com"), "support@example.com");
    assert.equal(contactEmailFrom("  support@example.com  "), "support@example.com");
  });

  it("falls back to the built-in address when unset or invalid", () => {
    assert.equal(contactEmailFrom(undefined), FALLBACK_CONTACT_EMAIL);
    assert.equal(contactEmailFrom(null), FALLBACK_CONTACT_EMAIL);
    assert.equal(contactEmailFrom(""), FALLBACK_CONTACT_EMAIL);
    assert.equal(contactEmailFrom("   "), FALLBACK_CONTACT_EMAIL);
    assert.equal(contactEmailFrom("not an email"), FALLBACK_CONTACT_EMAIL);
    assert.equal(contactEmailFrom("a@b"), FALLBACK_CONTACT_EMAIL);
    assert.equal(contactEmailFrom(`${"a".repeat(250)}@example.com`), FALLBACK_CONTACT_EMAIL);
  });

  it("CONTACT_EMAIL follows the environment", () => {
    assert.equal(CONTACT_EMAIL, contactEmailFrom(process.env.FORMBOOK_SUPPORT_EMAIL));
  });
});
