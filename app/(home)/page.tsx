import type { Metadata } from "next";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, Check, ExternalLink, Radio, Route, Split } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseOwnerLink } from "@/lib/billing/account-ref";
import { CONTACT_EMAIL } from "@/lib/billing/plans";
import {
  HOME_COPY,
  PUBLIC_PROOF,
  homeFaq,
  homeSteps,
  publicIntegrations,
  publicPlanCards
} from "@/lib/marketing/home-copy";
import { HOME_METADATA } from "@/lib/marketing/site";

// The product metadata, share card (opengraph-image.tsx and twitter-image.tsx
// in this route group) and og:url apply to the home page only.
export const metadata: Metadata = HOME_METADATA;

const PILLAR_ICONS: LucideIcon[] = [Route, Split, Radio];
const container = "mx-auto w-full max-w-6xl px-4 sm:px-6";
const card = "rounded-lg border bg-white p-6 shadow-sm";
const focusRing =
  "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";
const textLink = `${focusRing} hover:text-slate-950 hover:underline`;

export default function HomePage() {
  const devOpts = { allowHttpLocalhost: process.env.NODE_ENV !== "production" };
  const videoUrl = parseOwnerLink(process.env.FORMBOOK_DEMO_VIDEO_URL, devOpts)?.toString() ?? null;
  const setupCallUrl = parseOwnerLink(process.env.FORMBOOK_SETUP_CALL_URL, devOpts)?.toString() ?? null;
  const googleCalendar = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim());

  const integrations = publicIntegrations({ googleCalendar });
  const steps = homeSteps({ googleCalendar });
  const faq = homeFaq({ googleCalendar });
  const plans = publicPlanCards();

  return (
    <div className="flex min-h-screen flex-col bg-white text-slate-950">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:shadow"
      >
        {HOME_COPY.skipLink}
      </a>

      <header className="border-b bg-white">
        <div className={`${container} flex items-center justify-between gap-4 py-4`}>
          <Link href="/" className={`${focusRing} flex items-center gap-2.5 font-semibold text-slate-950`}>
            <span
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"
              aria-hidden="true"
            >
              <CalendarDays className="h-5 w-5" />
            </span>
            <span className="text-lg tracking-tight">{HOME_COPY.brandName}</span>
            <span className="hidden text-xs font-normal text-slate-600 sm:inline">{HOME_COPY.brandBy}</span>
          </Link>
          <nav aria-label="Account" className="flex items-center gap-2 sm:gap-4">
            <Link href={HOME_COPY.secondaryCta.href} className={`${textLink} text-sm font-medium text-slate-700`}>
              {HOME_COPY.secondaryCta.label}
            </Link>
            <Button asChild size="sm">
              <Link href={HOME_COPY.primaryCta.href}>{HOME_COPY.primaryCta.label}</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main id="main" className="flex-1">
        <section aria-labelledby="hero-title" className={`${container} py-16 sm:py-20`}>
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">{HOME_COPY.eyebrow}</p>
            <h1
              id="hero-title"
              className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl md:text-6xl"
            >
              {HOME_COPY.headline}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">{HOME_COPY.subhead}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href={HOME_COPY.primaryCta.href}>{HOME_COPY.primaryCta.label}</Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href={HOME_COPY.secondaryCta.href}>{HOME_COPY.secondaryCta.label}</Link>
              </Button>
              {videoUrl ? (
                <Button asChild size="lg" variant="ghost">
                  <a href={videoUrl} target="_blank" rel="noopener noreferrer">
                    {HOME_COPY.videoCta}
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section aria-labelledby="metrics-title" className="border-y bg-slate-50 py-16">
          <div className={container}>
            <h2 id="metrics-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {HOME_COPY.metricsTitle}
            </h2>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {HOME_COPY.metrics.map((metric) => {
                const proof = PUBLIC_PROOF[metric.key];
                return (
                  <div key={metric.key} className={card}>
                    <h3 className="text-lg font-semibold">{metric.title}</h3>
                    <p className="mt-2 leading-7 text-slate-600">{metric.body}</p>
                    {proof ? (
                      <p className="mt-5 border-t pt-4">
                        <span className="block text-3xl font-semibold text-slate-950">{proof.value}</span>
                        <span className="mt-1 block text-sm text-slate-600">{proof.context}</span>
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section aria-labelledby="pillars-title" className={`${container} py-16`}>
          <h2 id="pillars-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {HOME_COPY.pillarsTitle}
          </h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {HOME_COPY.pillars.map((pillar, index) => {
              const Icon = PILLAR_ICONS[index] ?? Route;
              return (
                <div key={pillar.title} className={card}>
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                  <h3 className="mt-4 text-lg font-semibold">{pillar.title}</h3>
                  <p className="mt-2 leading-7 text-slate-600">{pillar.body}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="steps-title" className="border-y bg-slate-50 py-16">
          <div className={container}>
            <h2 id="steps-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {HOME_COPY.stepsTitle}
            </h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {steps.map((step, index) => (
                <li key={step.title} className={card}>
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
                    aria-hidden="true"
                  >
                    {index + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section aria-labelledby="integrations-title" className={`${container} py-16`}>
          <h2 id="integrations-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {HOME_COPY.integrationsTitle}
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-2">
            {[
              { label: HOME_COPY.calendarsLabel, items: integrations.calendars },
              { label: HOME_COPY.crmsLabel, items: integrations.crms }
            ].map((group) => (
              <div key={group.label}>
                <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">{group.label}</h3>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {group.items.map((item) => (
                    <li key={item} className="rounded-full border bg-white px-3 py-1 text-sm text-slate-700">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section aria-labelledby="plans-title" className="border-y bg-slate-50 py-16">
          <div className={container}>
            <h2 id="plans-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {HOME_COPY.plansTitle}
            </h2>
            <p className="mt-2 text-sm text-slate-600">{HOME_COPY.plansNote}</p>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {plans.map((plan) => (
                <div key={plan.id} className={`${card} flex flex-col`}>
                  <h3 className="text-lg font-semibold">{plan.name}</h3>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{plan.price}</p>
                  <ul className="mt-5 flex-1 space-y-2">
                    {plan.lines.map((line) => (
                      <li key={line} className="flex gap-2 text-sm leading-6 text-slate-700">
                        <Check className="mt-1 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>
                  <Button asChild className="mt-6" variant={plan.id === "free" ? "default" : "outline"}>
                    <Link href="/signup">
                      {plan.id === "free" ? HOME_COPY.freeCardCta : HOME_COPY.scalingCardCta}
                    </Link>
                  </Button>
                </div>
              ))}
            </div>
            {setupCallUrl ? (
              <p className="mt-6 text-sm leading-6 text-slate-700">
                {HOME_COPY.setupCallLine}{" "}
                <a
                  href={setupCallUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${focusRing} font-semibold text-slate-950 underline underline-offset-2`}
                >
                  {HOME_COPY.setupCallLink}
                  <span className="sr-only"> (opens in a new tab)</span>
                </a>
              </p>
            ) : null}
          </div>
        </section>

        <section aria-labelledby="faq-title" className={`${container} py-16`}>
          <h2 id="faq-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {HOME_COPY.faqTitle}
          </h2>
          <div className="mt-8 max-w-3xl divide-y rounded-lg border bg-white">
            {faq.map((entry) => (
              <details key={entry.question} className="group px-5 py-4">
                <summary
                  className={`${focusRing} cursor-pointer list-none font-semibold text-slate-950 marker:hidden [&::-webkit-details-marker]:hidden`}
                >
                  <span className="flex items-center justify-between gap-4">
                    {entry.question}
                    <span className="text-primary transition-transform group-open:rotate-45" aria-hidden="true">
                      +
                    </span>
                  </span>
                </summary>
                <p className="mt-3 break-words leading-7 text-slate-600">{entry.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section aria-labelledby="final-cta-title" className="bg-slate-950 py-14">
          <div className={`${container} flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between`}>
            <h2 id="final-cta-title" className="text-2xl font-semibold tracking-tight text-white sm:text-3xl">
              {HOME_COPY.finalCtaTitle}
            </h2>
            <Button asChild size="lg" className="focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950">
              <Link href={HOME_COPY.primaryCta.href}>{HOME_COPY.finalCta}</Link>
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className={`${container} flex flex-col gap-3 py-8 text-sm text-slate-600`}>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
            {HOME_COPY.footerLinks.map((link) => (
              <Link key={link.href} href={link.href} className={textLink}>
                {link.label}
              </Link>
            ))}
          </nav>
          <p className="break-all">
            {HOME_COPY.footerContact}{" "}
            <a className={textLink} href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </p>
          <p>{HOME_COPY.footerLine}</p>
        </div>
      </footer>
    </div>
  );
}
