import Link from "next/link";
import type { ReactNode } from "react";
import { CONTACT_EMAIL } from "@/lib/billing/plans";
import { LEGAL_LAST_UPDATED, LEGAL_REVIEW_PENDING } from "@/lib/legal";

/** Shared layout for /terms, /privacy and /dpa. */
export function LegalPage({ title, intro, children }: { title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold text-primary">
          <Link href="/" className="hover:underline">
            FormBook
          </Link>
          , a tool from Gondal Tech
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {LEGAL_LAST_UPDATED}</p>

        {LEGAL_REVIEW_PENDING ? (
          <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            Draft for review by Gondal Tech. This page is not legal advice and may change before it is final.
          </div>
        ) : null}

        {intro ? <div className="mt-6 text-sm leading-6 text-slate-700">{intro}</div> : null}

        <div className="mt-8 space-y-8 text-sm leading-6 text-slate-700">{children}</div>

        <p className="mt-10 border-t pt-6 text-sm text-slate-600">
          Questions about this page? Email{" "}
          <a className="font-semibold underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <nav className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-500">
          <Link className="hover:text-slate-900 hover:underline" href="/terms">
            Terms
          </Link>
          <Link className="hover:text-slate-900 hover:underline" href="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-slate-900 hover:underline" href="/dpa">
            Data Processing Addendum
          </Link>
        </nav>
      </div>
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
