import Link from "next/link";
import { BrandLogo } from "@/components/brand/brand-logo";
import styles from "./document-layout.module.css";

export function DocumentMasthead() {
  return (
    <header className={styles.masthead}>
      <Link href="/" aria-label="FormBook home">
        <BrandLogo className={styles.logo} />
      </Link>
    </header>
  );
}

export function LegalNavigation({ current }: { current?: string }) {
  return (
    <nav aria-label="Legal documents" className={styles.legalNav}>
      {[
        ["/terms", "Terms"],
        ["/privacy", "Privacy"],
        ["/dpa", "Data Processing Addendum"]
      ].map(([href, label]) => (
        <Link href={href} key={href} aria-current={current === href ? "page" : undefined}>{label}</Link>
      ))}
    </nav>
  );
}
