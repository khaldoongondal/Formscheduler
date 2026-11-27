import Link from "next/link";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import styles from "./auth-shell.module.css";

export function AuthShell({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <main className={`jardin-ui ${styles.page}`}>
      <div className={styles.spread}>
        <div className={styles.cover}>
          <Link className={styles.brand} href="/" aria-label="FormBook home">
            <BrandLogo className={styles.logo} />
          </Link>
        </div>
        <section className={styles.formPage} aria-labelledby="auth-title">
          <header className={styles.heading}>
            <h1 id="auth-title">{title}</h1>
            {description && <p>{description}</p>}
          </header>
          <div className={styles.content}>{children}</div>
        </section>
      </div>
    </main>
  );
}
