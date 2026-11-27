import type { ReactNode } from "react";
import { CONTACT_EMAIL } from "@/lib/billing/plans";
import { LEGAL_LAST_UPDATED, LEGAL_REVIEW_PENDING } from "@/lib/legal";
import { MAKER_FOOTER_LINE } from "@/lib/marketing/site";
import { DocumentMasthead, LegalNavigation } from "./document-layout";
import styles from "./document-layout.module.css";

/** Shared layout for /terms, /privacy and /dpa. */
export function LegalPage({ title, current, intro, children }: {
  title: string; current: string; intro?: ReactNode; children: ReactNode;
}) {
  return (
    <main className={`jardin-ui ${styles.page}`}>
      <div className={styles.container}>
        <DocumentMasthead />
        <header className={styles.hero}>
          <h1>{title}</h1>
          <p className={styles.date}>Last updated: {LEGAL_LAST_UPDATED}</p>
        </header>
        <div className={styles.columns}>
          <div className={styles.side}><LegalNavigation current={current} /></div>
          <article className={styles.article}>
            {LEGAL_REVIEW_PENDING && (
              <p className={styles.notice}>Draft for review. This page is not legal advice and may change before it is final.</p>
            )}
            {intro && <div className={styles.intro}>{intro}</div>}
            {children}
          </article>
        </div>
        <footer className={styles.footer}>
          <p>
            Questions about this page? Email{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
          <p className={styles.maker}>{MAKER_FOOTER_LINE}</p>
        </footer>
      </div>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul>;
}
