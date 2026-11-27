/**
 * Copy for the public product page at "/". Pure: no Next.js or Supabase
 * imports, so node:test can load it.
 *
 * Every number on the page comes from PLANS (plan limits and price) or from
 * PUBLIC_PROOF, which stays null until the owner fills it with a real figure.
 */

import { CONTACT_EMAIL, PLANS, formatPlanPrice, type PlanDefinition, type PlanId } from "@/lib/billing/plans";
import { MAKER_FOOTER_LINE } from "@/lib/marketing/site";

export type PublicProofEntry = { value: string; context: string };

/**
 * Real figures only, filled in by the owner. Each stays hidden while null.
 * leadToBookingRate: for example a figure from Gondal Tech's own funnel, with
 * the dates in `context`. eventMatchQuality: must be read from Meta Events
 * Manager first.
 */
export const PUBLIC_PROOF: {
  leadToBookingRate: PublicProofEntry | null;
  eventMatchQuality: PublicProofEntry | null;
} = { leadToBookingRate: null, eventMatchQuality: null };

export const HOME_COPY = {
  eyebrow: "For call-booking funnels",
  headline: "Qualify, book and measure every lead in one form.",
  subhead:
    "FormBook is for founders and business owners who run call-booking funnels. It asks your questions, books the call in your calendar, sends the lead to your CRM, and shows you how many of your leads go on to book.",
  primaryCta: { label: "Create a free account", href: "/signup" },
  secondaryCta: { label: "Sign in", href: "/login" },
  videoCta: "Watch the walkthrough",
  brandName: "FormBook",
  metricsTitle: "Two numbers FormBook helps you watch",
  metrics: [
    {
      key: "leadToBookingRate",
      title: "Lead-to-booking rate",
      body: "The share of captured leads who book a call. FormBook tracks it for every form and every split test, so you can see which form books more of the people who fill it in."
    },
    {
      key: "eventMatchQuality",
      title: "Event match quality",
      body: "Meta's score for how well your events match people on Meta. FormBook sends each event from the server with hashed contact details, click IDs and browser details, the information Meta uses for matching. You read your score in Meta Events Manager."
    }
  ] as const,
  pillarsTitle: "What it does",
  pillars: [
    {
      title: "Qualify and book in one form",
      body: "Ask your questions, save the lead as soon as they share their details, and show your calendar only to people who fit. Bookings go into your calendar and every lead goes to your CRM."
    },
    {
      title: "Split test your forms",
      body: "Send one link or embed to two or three forms. Visitors are split evenly and see the same form when they come back. Compare views, starts, leads, qualified leads and bookings for each form, with a note when the sample is too small to call."
    },
    {
      title: "Server-side Meta events, with hold and fire",
      body: "Send form view, form start, lead, qualified, disqualified and booked call events from the server. Send them automatically, or hold them and fire them when you choose. Every event is in a log you can read."
    }
  ] as const,
  stepsTitle: "How it works",
  integrationsTitle: "Works with",
  calendarsLabel: "Calendars",
  crmsLabel: "CRMs",
  plansTitle: "Plans",
  plansNote: "Prices in US dollars.",
  freeCardCta: "Create a free account",
  scalingCardCta: "Start free, upgrade any time",
  setupCallLine: "Every account can book a free setup call with the founder.",
  setupCallLink: "Book a setup call",
  faqTitle: "Questions",
  finalCtaTitle: "Ready to try it?",
  finalCta: "Create a free account",
  footerLinks: [
    { label: "Help", href: "/help/connections" },
    { label: "Terms", href: "/terms" },
    { label: "Privacy", href: "/privacy" },
    { label: "Data Processing Addendum", href: "/dpa" },
    { label: "Sign in", href: "/login" },
    { label: "Create an account", href: "/signup" }
  ] as const,
  footerContact: "Contact:",
  footerLine: MAKER_FOOTER_LINE,
  skipLink: "Skip to content"
} as const;

export type PublicIntegrations = { calendars: string[]; crms: string[] };

export function publicIntegrations(opts: { googleCalendar: boolean }): PublicIntegrations {
  return {
    calendars: ["GoHighLevel", ...(opts.googleCalendar ? ["Google Calendar"] : []), "Cal.com", "Calendly"],
    crms: ["GoHighLevel", "HubSpot", "Webhooks for n8n, Zapier, Make and other tools"]
  };
}

function pixelLine(count: number): string {
  return `${count} Meta ${count === 1 ? "pixel" : "pixels"}`;
}

export type PublicPlanCard = { id: PlanId; name: string; price: string; lines: string[] };

export function publicPlanCards(plans: Record<PlanId, PlanDefinition> = PLANS): PublicPlanCard[] {
  const shared = "Split tests, every integration and server-side Meta events";
  const card = (plan: PlanDefinition, last: string): PublicPlanCard => ({
    id: plan.id,
    name: plan.name,
    price: formatPlanPrice(plan),
    lines: [
      `${plan.maxActiveForms} active forms`,
      `Up to ${plan.maxDraftForms} drafts`,
      pixelLine(plan.maxPixels),
      shared,
      last
    ]
  });
  return [
    card(plans.free, 'A small "Powered by FormBook" badge on your forms'),
    card(plans.scaling, "No FormBook badge")
  ];
}

export type HomeStep = { title: string; body: string };

export function homeSteps(opts: { googleCalendar: boolean }): HomeStep[] {
  const calendars = ["GoHighLevel", ...(opts.googleCalendar ? ["Google Calendar"] : []), "Cal.com", "Calendly", "HubSpot"];
  return [
    { title: "Connect your calendar and CRM.", body: `${calendars.join(", ")} or a webhook.` },
    {
      title: "Build your form from a template or from scratch.",
      body: "Choose your questions, which answers end the form, and your colors."
    },
    {
      title: "Embed it on your site or share the link, then watch leads and bookings come in.",
      body: "See views, starts, leads and bookings for each form."
    }
  ];
}

export type FaqEntry = { question: string; answer: string };

function joinList(items: string[]): string {
  return items.join(", ");
}

/**
 * The seven FAQ entries. Plan numbers, prices, the contact address and the
 * integration names are interpolated; nothing else carries a number.
 */
export function homeFaq(
  opts: { googleCalendar: boolean },
  plans: Record<PlanId, PlanDefinition> = PLANS,
  contactEmail: string = CONTACT_EMAIL
): FaqEntry[] {
  const f = plans.free;
  const s = plans.scaling;
  const integrations = publicIntegrations(opts);
  return [
    {
      question: "Is FormBook free?",
      answer: `Yes. The ${f.name} plan is free and includes ${f.maxActiveForms} active forms, up to ${f.maxDraftForms} drafts and ${pixelLine(f.maxPixels)}. ${s.name} costs ${formatPlanPrice(s)} and raises those limits.`
    },
    {
      question: `What does ${s.name} add?`,
      answer: `Up to ${s.maxActiveForms} active forms, ${s.maxDraftForms} drafts and ${pixelLine(s.maxPixels)}, and no FormBook badge on your forms.`
    },
    {
      question: "Which calendars and CRMs work with FormBook?",
      answer: `Calendars: ${joinList(integrations.calendars)}. CRMs: ${joinList(integrations.crms)}.`
    },
    {
      question: "What happens to my forms if I move back to the free plan?",
      answer:
        "Nothing is deleted. Forms and Meta pixels above the free limits are frozen. You choose which ones stay active, and frozen items come back when you upgrade again."
    },
    {
      question: "Do I need a Meta pixel?",
      answer:
        "No. Meta events are optional. If you add a pixel, you paste your own pixel ID and access token, and you decide which events are sent."
    },
    {
      question: "How do I get in touch?",
      answer: `Email ${contactEmail} with any question.`
    },
    {
      question: `How do I cancel ${s.name}?`,
      answer: `Use Manage billing on your Plan page, or email ${contactEmail}. You keep ${s.name} until the end of the paid period, then your account moves to the free plan and nothing is deleted.`
    }
  ];
}
