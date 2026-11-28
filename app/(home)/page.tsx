import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, CalendarDays, Check, ListFilter, Radio, Split, Workflow, Zap } from "lucide-react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { parseOwnerLink } from "@/lib/billing/account-ref";
import { CONTACT_EMAIL } from "@/lib/billing/plans";
import { HOME_COPY, PUBLIC_PROOF, homeFaq, homeSteps, publicIntegrations, publicPlanCards } from "@/lib/marketing/home-copy";
import { HOME_METADATA } from "@/lib/marketing/site";
import { FormPreview } from "./form-preview";
import styles from "./home.module.css";

export const metadata: Metadata = HOME_METADATA;

const pillarIcons = [ListFilter, Split, Radio];
const [headline, ending] = HOME_COPY.headline.split(/(?=in one form\.$)/);

function SignupLink({ label = HOME_COPY.primaryCta.label, light = false }: { label?: string; light?: boolean }) {
  return <Link className={`${styles.cta} ${light ? styles.ctaLight : ""}`} href={HOME_COPY.primaryCta.href}>{label}<ArrowRight size={16} aria-hidden="true" /></Link>;
}

export default function HomePage() {
  const devOpts = { allowHttpLocalhost: process.env.NODE_ENV !== "production" };
  const videoUrl = parseOwnerLink(process.env.FORMBOOK_DEMO_VIDEO_URL, devOpts)?.toString() ?? null;
  const googleCalendar = Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID?.trim());
  const integrations = publicIntegrations({ googleCalendar });
  const steps = homeSteps({ googleCalendar });
  const faq = homeFaq({ googleCalendar });
  const plans = publicPlanCards();

  return (
    <div className={`jardin-ui ${styles.home}`}>
      <a href="#main" className={styles.skip}>{HOME_COPY.skipLink}</a>
      <header className={styles.header}>
        <div className={`${styles.wrap} ${styles.navbar}`}>
          <Link href="/" aria-label="FormBook home"><BrandLogo className={styles.logo} /></Link>
          <nav className={styles.sectionNav} aria-label="On this page">
            <a href="#product">Product</a><a href="#how-it-works">{HOME_COPY.stepsTitle}</a><a href="#plans">{HOME_COPY.plansTitle}</a>
          </nav>
          <nav className={styles.accountNav} aria-label="Account">
            <Link href={HOME_COPY.secondaryCta.href}>{HOME_COPY.secondaryCta.label}</Link>
            <SignupLink />
          </nav>
        </div>
      </header>

      <main id="main">
        <section className={`${styles.wrap} ${styles.hero}`} aria-labelledby="hero-title">
          <div className={styles.heroCopy}>
            <p className={styles.eyebrow}><span className={styles.irisRule} aria-hidden="true" />{HOME_COPY.eyebrow}</p>
            <h1 id="hero-title">{headline}{ending && <em>{ending}</em>}</h1>
            <p className={styles.subhead}>{HOME_COPY.subhead}</p>
            <div className={styles.heroActions}>
              <SignupLink />
              {videoUrl ? (
                <a className={styles.textAction} href={videoUrl} target="_blank" rel="noopener noreferrer">{HOME_COPY.videoCta}<ArrowUpRight size={16} aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span></a>
              ) : (
                <a className={styles.textAction} href="#how-it-works">{HOME_COPY.stepsTitle}<ArrowDown size={15} aria-hidden="true" /></a>
              )}
            </div>
          </div>
        </section>
        <section className={styles.wrap} aria-label="Interactive FormBook example">
          <div className={styles.previewPanel}>
            <div className={styles.previewIntro}>
              <p className={styles.eyebrow}>Example form</p>
              <h2>A thoughtful first impression.</h2>
              <ol>{["Qualify", "Book", "Measure"].map((step, index) => (
                <li key={step}><span>{String(index + 1).padStart(2, "0")}</span>{step}</li>
              ))}</ol>
            </div>
            <FormPreview />
          </div>
        </section>

        <section aria-labelledby="integrations-title" className={styles.integrationStrip}>
          <div className={`${styles.wrap} ${styles.integrations}`}>
            <h2 id="integrations-title">{HOME_COPY.integrationsTitle}</h2>
            {[
              { label: HOME_COPY.calendarsLabel, icon: CalendarDays, items: integrations.calendars },
              { label: HOME_COPY.crmsLabel, icon: Workflow, items: integrations.crms.slice(0, 2) },
              { label: "Automation", icon: Zap, items: integrations.crms.slice(2) }
            ].map(({ label, icon: Icon, items }) => (
              <div className={styles.integrationGroup} key={label}>
                <h3><Icon aria-hidden="true" size={16} />{label}</h3>
                <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
              </div>
            ))}
          </div>
        </section>

        <section id="product" aria-labelledby="pillars-title" className={`${styles.wrap} ${styles.section}`}>
          <h2 className={styles.display} id="pillars-title">{HOME_COPY.pillarsTitle}</h2>
          <div className={styles.pillars}>
            {HOME_COPY.pillars.map((pillar, index) => {
              const Icon = pillarIcons[index];
              return (
                <article key={pillar.title} className={styles.pillar}>
                  <div className={styles.iconTile}><Icon size={22} strokeWidth={1.5} aria-hidden="true" /></div>
                  <h3>{pillar.title}</h3><p>{pillar.body}</p>
                </article>
              );
            })}
          </div>
        </section>

        <section aria-labelledby="metrics-title" className={styles.metricsBand}>
          <div className={`${styles.wrap} ${styles.metricLayout}`}>
            <h2 className={styles.display} id="metrics-title">{HOME_COPY.metricsTitle}</h2>
            <div>
              {HOME_COPY.metrics.map((metric) => {
                const proof = PUBLIC_PROOF[metric.key];
                return (
                  <article key={metric.key} className={styles.metric}>
                    <h3>{metric.title}</h3><p>{metric.body}</p>
                    {proof && <p className={styles.proof}><strong>{proof.value}</strong> {proof.context}</p>}
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="steps-title" className={`${styles.wrap} ${styles.section} ${styles.splitSection}`}>
          <h2 className={styles.display} id="steps-title">{HOME_COPY.stepsTitle}</h2>
          <ol className={styles.steps}>
            {steps.map((step, index) => (
              <li key={step.title}>
                <span className={styles.stepNumber} aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <div><h3>{step.title}</h3><p>{step.body}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section id="plans" aria-labelledby="plans-title" className={styles.planBand}>
          <div className={`${styles.wrap} ${styles.section}`}>
            <div className={styles.planHeading}><h2 className={styles.display} id="plans-title">{HOME_COPY.plansTitle}</h2><p>{HOME_COPY.plansNote}</p></div>
            <div className={styles.plans}>
              {plans.map((plan) => (
                <article key={plan.id} className={styles.plan}>
                  <div className={styles.planTitle}><h3>{plan.name}</h3><p>{plan.price}</p></div>
                  <ul>{plan.lines.map((line) => <li key={line}><Check size={16} aria-hidden="true" />{line}</li>)}</ul>
                  <SignupLink label={plan.id === "free" ? HOME_COPY.freeCardCta : HOME_COPY.scalingCardCta} />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="faq-title" className={`${styles.wrap} ${styles.section} ${styles.splitSection}`}>
          <h2 className={styles.display} id="faq-title">{HOME_COPY.faqTitle}</h2>
          <div className={styles.faq}>
            {faq.map((entry) => (
              <details key={entry.question}><summary>{entry.question}<span aria-hidden="true">+</span></summary><p>{entry.answer}</p></details>
            ))}
          </div>
        </section>

        <section aria-labelledby="final-cta-title" className={styles.closing}>
          <div className={`${styles.wrap} ${styles.closingInner}`}>
            <h2 id="final-cta-title" className={styles.display}>{HOME_COPY.finalCtaTitle}</h2><SignupLink light label={HOME_COPY.finalCta} />
          </div>
        </section>
      </main>

      <footer className={`${styles.wrap} ${styles.footer}`}>
        <Link href="/" aria-label="FormBook home"><BrandLogo className={styles.footerLogo} /></Link>
        <nav aria-label="Footer">{HOME_COPY.footerLinks.map((link) => <Link key={link.href} href={link.href}>{link.label}</Link>)}</nav>
        <div className={styles.footerBottom}><p>{HOME_COPY.footerLine}</p><p>{HOME_COPY.footerContact} <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></p></div>
      </footer>
    </div>
  );
}
