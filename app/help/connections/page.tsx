import { DocumentMasthead, LegalNavigation } from "@/components/legal/document-layout";
import styles from "@/components/legal/document-layout.module.css";
import {
  HELP_COPY,
  WEBHOOK_EXAMPLE_JSON,
  WEBHOOK_VERIFY_SNIPPET,
  supportEmailFrom
} from "@/lib/help/connections-copy";
import { PROVIDERS } from "@/lib/connections/registry";
import { MAKER_FOOTER_LINE, PRODUCT_ICONS } from "@/lib/marketing/site";

export const metadata = {
  icons: PRODUCT_ICONS,
  title: HELP_COPY.metaTitle,
  description: HELP_COPY.metaDescription
};

function CodeBlock({ children, label }: { children: string; label: string }) {
  return (
    <pre tabIndex={0} aria-label={label}>
      <code>{children}</code>
    </pre>
  );
}

/** Public help page: no data access, the same for every visitor. */
export default function ConnectionsHelpPage() {
  const supportEmail = supportEmailFrom(process.env.FORMBOOK_SUPPORT_EMAIL);

  return (
    <main className={`jardin-ui ${styles.page}`}>
      <div className={styles.container}>
        <DocumentMasthead />
        <header className={styles.hero}>
          <p className={styles.kicker}>{HELP_COPY.subtitle}</p>
          <h1>{HELP_COPY.title}</h1>
        </header>
        <div className={styles.columns}>
          <nav aria-label={HELP_COPY.contentsHeading} className={styles.side}>
            <h2>{HELP_COPY.contentsHeading}</h2>
            <ul>
              {HELP_COPY.sections.map((section) => (
                <li key={section.anchor}>
                  <a href={`#${section.anchor}`}>
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <article className={styles.article}>
            {HELP_COPY.sections.map((section) => (
              <section key={section.anchor} id={section.anchor}>
                <h2>{section.title}</h2>
                <p>{section.intro}</p>
                {section.steps?.length ? (
                  <ol>
                    {section.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ) : null}
                {section.notes?.length ? (
                  <ul>
                    {section.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                ) : null}
                {section.anchor === PROVIDERS.webhook.helpAnchor ? (
                  <>
                    <h3>{HELP_COPY.exampleHeading}</h3>
                    <CodeBlock label={HELP_COPY.exampleHeading}>{WEBHOOK_EXAMPLE_JSON}</CodeBlock>
                    <h3>{HELP_COPY.verifyHeading}</h3>
                    <CodeBlock label={HELP_COPY.verifyHeading}>{WEBHOOK_VERIFY_SNIPPET}</CodeBlock>
                  </>
                ) : null}
                {section.anchor === "troubleshooting" && supportEmail ? (
                  <p>
                    {HELP_COPY.supportLine}{" "}
                    <a className="font-semibold underline underline-offset-2" href={`mailto:${supportEmail}`}>
                      {supportEmail}
                    </a>
                    .
                  </p>
                ) : null}
              </section>
            ))}
          </article>
        </div>
        <footer className={styles.footer}>
          <LegalNavigation />
          <p className={styles.maker}>{MAKER_FOOTER_LINE}</p>
        </footer>
      </div>
    </main>
  );
}
