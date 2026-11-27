import Link from "next/link";
import {
  HELP_COPY,
  WEBHOOK_EXAMPLE_JSON,
  WEBHOOK_VERIFY_SNIPPET,
  supportEmailFrom
} from "@/lib/help/connections-copy";
import { PROVIDERS } from "@/lib/connections/registry";

export const metadata = {
  title: HELP_COPY.metaTitle,
  description: HELP_COPY.metaDescription
};

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-5 text-slate-800">
      <code>{children}</code>
    </pre>
  );
}

/** Public help page: no data access, the same for every visitor. */
export default function ConnectionsHelpPage() {
  const supportEmail = supportEmailFrom(process.env.FORMBOOK_SUPPORT_EMAIL);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <p className="text-sm font-semibold text-primary">
          <Link href="/" className="hover:underline">
            FormBook
          </Link>
          , a tool from Gondal Tech
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900">{HELP_COPY.title}</h1>
        <p className="mt-2 text-sm text-slate-500">{HELP_COPY.subtitle}</p>

        <nav aria-label={HELP_COPY.contentsHeading} className="mt-8 rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-900">{HELP_COPY.contentsHeading}</h2>
          <ul className="mt-2 grid gap-1.5 text-sm sm:grid-cols-2">
            {HELP_COPY.sections.map((section) => (
              <li key={section.anchor}>
                <a className="text-slate-700 underline underline-offset-2 hover:text-slate-950" href={`#${section.anchor}`}>
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-10 space-y-10 text-sm leading-6 text-slate-700">
          {HELP_COPY.sections.map((section) => (
            <section key={section.anchor} id={section.anchor} className="scroll-mt-8 space-y-3">
              <h2 className="text-lg font-semibold text-slate-900">{section.title}</h2>
              <p>{section.intro}</p>
              {section.steps?.length ? (
                <ol className="list-decimal space-y-1.5 pl-5">
                  {section.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              ) : null}
              {section.notes?.length ? (
                <ul className="list-disc space-y-1.5 pl-5">
                  {section.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : null}
              {section.anchor === PROVIDERS.webhook.helpAnchor ? (
                <>
                  <h3 className="pt-2 text-base font-semibold text-slate-900">{HELP_COPY.exampleHeading}</h3>
                  <CodeBlock>{WEBHOOK_EXAMPLE_JSON}</CodeBlock>
                  <h3 className="pt-2 text-base font-semibold text-slate-900">{HELP_COPY.verifyHeading}</h3>
                  <CodeBlock>{WEBHOOK_VERIFY_SNIPPET}</CodeBlock>
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
        </div>

        <nav className="mt-12 flex flex-wrap gap-x-5 gap-y-2 border-t pt-6 text-sm text-slate-500">
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
