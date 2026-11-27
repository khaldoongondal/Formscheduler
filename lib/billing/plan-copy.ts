/**
 * Copy for the Plan page, the plan usage card and the upgrade prompts.
 * Pure: no Next.js or Supabase imports.
 */

import { CONTACT_EMAIL, PLANS, formatPlanPrice } from "@/lib/billing/plans";

export const UPGRADE_PHRASE = "upgrade to Scaling";

/** True for the free-plan limit messages that end with the upgrade offer. */
export function isUpgradeableLimitMessage(message: string | null | undefined): boolean {
  return typeof message === "string" && message.includes(UPGRADE_PHRASE);
}

const free = PLANS.free;
const scaling = PLANS.scaling;

export const PLAN_COPY = {
  pageTitle: "Plan",
  navLabel: "Plan",
  eyebrow: "Account",
  heading: "Your plan",
  intro: "See what your plan includes, how much of it you use, and how to change it.",
  upgradeHint: "See plans and upgrade",
  usageNeedMore: "Need more? Upgrade to Scaling.",
  usageActiveFull: (max: number) => `You are using all ${max} active forms. Switch a form to draft to activate another.`,
  usageDraftsFull: (max: number) => `You are using all ${max} drafts. Delete a draft to create a new form.`,
  upgradeTitle: "Upgrade to Scaling",
  upgradePrice: `${formatPlanPrice(scaling)}, billed monthly through a Gondal Tech payment page.`,
  addsHeading: "What Scaling adds",
  addsItems: [
    `Up to ${scaling.maxActiveForms} active forms (you have ${free.maxActiveForms} now)`,
    `Up to ${scaling.maxDraftForms} drafts (${free.maxDraftForms} now)`,
    `Up to ${scaling.maxPixels} Meta pixels (${free.maxPixels} now)`,
    'No "Powered by FormBook" badge on your forms'
  ],
  upgradeButton: "Upgrade to Scaling",
  upgradeNote:
    "You finish the payment on a Gondal Tech page. Your plan changes here once the payment is confirmed. If you can, pay with the email address you use for FormBook.",
  upgradeByEmail: "To move to Scaling, email",
  billingTitle: "Billing",
  onScaling: "You are on the Scaling plan.",
  manageBilling: "Manage billing",
  manageBillingNote:
    "Update your card, see invoices or cancel. If you cancel, you keep Scaling until the end of the paid period, then your account moves to Bootstrapping.",
  billingByEmail: "To change or cancel your plan, email",
  downgradeNote:
    "If your plan moves to Bootstrapping, nothing is deleted. Forms and Meta pixels above the free limits are frozen until you upgrade again or choose which ones stay active.",
  frozenHeading: "Frozen forms and Meta pixels",
  frozenIntro: "These were frozen when your plan changed. They do not take leads or send events. Nothing was deleted.",
  openForm: "Open form",
  seePlans: "See plans",
  contactEmail: CONTACT_EMAIL
} as const;
