/**
 * Sprint 4 P4.10: the public product page copy.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTACT_EMAIL, PLANS, formatPlanPrice } from "@/lib/billing/plans";
import {
  HOME_COPY,
  PUBLIC_PROOF,
  homeFaq,
  homeSteps,
  publicIntegrations,
  publicPlanCards
} from "@/lib/marketing/home-copy";
import { DEFAULT_APP_URL, ROBOTS_DISALLOW, SITEMAP_PATHS, SITE_DESCRIPTION, SITE_TITLE, siteUrl } from "@/lib/marketing/site";

const EM_DASH = String.fromCharCode(0x2014);

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectStrings(item, out));
  return out;
}

/** Removes every value interpolated from PLANS, CONTACT_EMAIL or the integration names. */
function stripInterpolated(text: string): string {
  const values = new Set<string>([CONTACT_EMAIL]);
  for (const plan of Object.values(PLANS)) {
    values.add(formatPlanPrice(plan));
    values.add(String(plan.maxActiveForms));
    values.add(String(plan.maxDraftForms));
    values.add(String(plan.maxPixels));
  }
  const integrations = publicIntegrations({ googleCalendar: true });
  for (const name of [...integrations.calendars, ...integrations.crms]) values.add(name);
  let result = text;
  for (const value of [...values].sort((a, b) => b.length - a.length)) result = result.split(value).join("");
  return result;
}

describe("publicPlanCards", () => {
  it("reads every number and price from PLANS", () => {
    const [free, scaling] = publicPlanCards();
    assert.equal(free.id, "free");
    assert.equal(free.name, PLANS.free.name);
    assert.equal(free.price, formatPlanPrice(PLANS.free));
    assert.equal(free.lines[0], `${PLANS.free.maxActiveForms} active forms`);
    assert.equal(free.lines[1], `Up to ${PLANS.free.maxDraftForms} drafts`);
    assert.equal(scaling.id, "scaling");
    assert.equal(scaling.price, formatPlanPrice(PLANS.scaling));
    assert.equal(scaling.lines[0], `${PLANS.scaling.maxActiveForms} active forms`);
    assert.equal(scaling.lines[1], `Up to ${PLANS.scaling.maxDraftForms} drafts`);
    assert.equal(scaling.lines[2], `${PLANS.scaling.maxPixels} Meta pixels`);
    assert.equal(scaling.lines.at(-1), "No FormBook badge");
    assert.match(free.lines.at(-1) ?? "", /Powered by FormBook/);
  });

  it("uses the singular for one pixel", () => {
    assert.equal(PLANS.free.maxPixels, 1);
    assert.equal(publicPlanCards()[0].lines[2], "1 Meta pixel");
  });

  it("follows a changed plan table", () => {
    const plans = {
      free: { ...PLANS.free, maxActiveForms: 5, maxPixels: 2 },
      scaling: { ...PLANS.scaling, monthlyPriceCents: 2500 }
    };
    const [free, scaling] = publicPlanCards(plans);
    assert.equal(free.lines[0], "5 active forms");
    assert.equal(free.lines[2], "2 Meta pixels");
    assert.equal(scaling.price, "$25.00 USD a month");
  });
});

describe("publicIntegrations", () => {
  it("lists Google Calendar only when it is enabled", () => {
    assert.deepEqual(publicIntegrations({ googleCalendar: false }).calendars, ["GoHighLevel", "Cal.com", "Calendly"]);
    assert.deepEqual(publicIntegrations({ googleCalendar: true }).calendars, [
      "GoHighLevel",
      "Google Calendar",
      "Cal.com",
      "Calendly"
    ]);
    assert.equal(publicIntegrations({ googleCalendar: false }).crms.length, 3);
  });

  it("matches the how-it-works step", () => {
    assert.doesNotMatch(homeSteps({ googleCalendar: false })[0].body, /Google Calendar/);
    assert.match(homeSteps({ googleCalendar: true })[0].body, /Google Calendar/);
    assert.equal(homeSteps({ googleCalendar: true }).length, 3);
  });
});

describe("PUBLIC_PROOF", () => {
  it("stays hidden until the owner fills it", () => {
    assert.equal(PUBLIC_PROOF.leadToBookingRate, null);
    assert.equal(PUBLIC_PROOF.eventMatchQuality, null);
  });
});

describe("home copy rules", () => {
  const faqs = [homeFaq({ googleCalendar: false }), homeFaq({ googleCalendar: true })];

  it("has no em dash anywhere", () => {
    for (const text of collectStrings([HOME_COPY, faqs, homeSteps({ googleCalendar: true }), publicPlanCards()])) {
      assert.ok(!text.includes(EM_DASH), text);
    }
    assert.ok(!SITE_TITLE.includes(EM_DASH));
    assert.ok(!SITE_DESCRIPTION.includes(EM_DASH));
  });

  it("carries no number except values interpolated from PLANS or CONTACT_EMAIL", () => {
    for (const text of collectStrings([HOME_COPY, faqs, homeSteps({ googleCalendar: true }), publicPlanCards()])) {
      assert.doesNotMatch(stripInterpolated(text), /[0-9]/, text);
    }
  });

  it("has seven FAQ entries with answers", () => {
    for (const faq of faqs) {
      assert.equal(faq.length, 7);
      for (const entry of faq) {
        assert.ok(entry.question.trim().length > 0);
        assert.ok(entry.answer.trim().length > 0);
      }
    }
  });

  it("interpolates the plan figures into the FAQ", () => {
    const [first, second, , , , sixth, seventh] = homeFaq({ googleCalendar: false });
    assert.match(first.answer, new RegExp(`${PLANS.free.maxActiveForms} active forms`));
    assert.ok(first.answer.includes(formatPlanPrice(PLANS.scaling)));
    assert.match(second.answer, new RegExp(`Up to ${PLANS.scaling.maxActiveForms} active forms`));
    assert.ok(sixth.answer.includes(CONTACT_EMAIL));
    assert.match(seventh.answer, /end of the paid period/);
  });
});

describe("site metadata helpers", () => {
  it("falls back to the production address", () => {
    assert.equal(siteUrl(undefined).toString(), `${DEFAULT_APP_URL}/`);
    assert.equal(siteUrl("not a url").toString(), `${DEFAULT_APP_URL}/`);
    assert.equal(siteUrl("ftp://example.com").toString(), `${DEFAULT_APP_URL}/`);
    assert.equal(siteUrl("https://app.example.com/some/path").toString(), "https://app.example.com/");
  });

  it("keeps private paths out of search and lists the public pages", () => {
    for (const path of ["/admin/", "/api/", "/preview/", "/auth/", "/embed/"]) {
      assert.ok((ROBOTS_DISALLOW as readonly string[]).includes(path), path);
    }
    assert.ok(SITEMAP_PATHS.includes("/"));
    for (const path of SITEMAP_PATHS) {
      assert.ok(!ROBOTS_DISALLOW.some((blocked) => path.startsWith(blocked)), path);
    }
  });
});
