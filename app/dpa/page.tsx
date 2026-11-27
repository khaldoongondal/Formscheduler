import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { CONTACT_EMAIL } from "@/lib/billing/plans";

export const metadata = {
  title: "Data Processing Addendum",
  description: "How Gondal Tech processes lead data for FormBook customers."
};

export default function DpaPage() {
  return (
    <LegalPage
      title="Data Processing Addendum"
      intro={
        <p>
          This addendum forms part of the{" "}
          <Link className="font-semibold underline underline-offset-2" href="/terms">
            Terms of Service
          </Link>{" "}
          between Gondal Tech and each FormBook customer. It applies to the free and paid plans.
        </p>
      }
    >
      <LegalSection title="1. Parties and roles">
        <p>
          The customer is the controller of the personal data collected through its forms. Gondal Tech is the processor
          and handles that data only to provide FormBook to the customer.
        </p>
      </LegalSection>

      <LegalSection title="2. Subject matter, duration, nature and purpose">
        <p>
          Gondal Tech hosts the customer&apos;s forms, stores the answers, checks whether a lead is a fit using the
          customer&apos;s rules, books calls and sends leads to the customer&apos;s connected accounts. Processing lasts
          for as long as the customer uses FormBook, plus the time needed to return or delete the data.
        </p>
        <p>Data subjects are the people who fill in the customer&apos;s forms. The data can include:</p>
        <LegalList
          items={[
            "contact details, such as name, email address and phone number;",
            "answers to the customer's questions;",
            "booking details, such as the chosen time and time zone;",
            "tracking parameters, such as the page and campaign a visitor came from;",
            "the visitor's IP address, and a country derived from it;",
            "browser details, such as the browser type."
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Customer duties">
        <LegalList
          items={[
            "Have a lawful basis for collecting the data, and get consent where the law requires it.",
            "Publish its own privacy notice where the form appears, naming the customer as the business collecting the data.",
            "Do not collect sensitive data, passwords or payment card numbers through a form.",
            "Follow Meta's terms when connecting a Meta pixel, and tell people about it where required."
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Processor duties">
        <p>Gondal Tech will:</p>
        <LegalList
          items={[
            "process the data only on the customer's documented instructions. The customer's form settings and connection settings are those instructions;",
            "make sure people with access to the data are bound by confidentiality;",
            "keep security measures in place, including encrypted storage of GoHighLevel tokens, access controls and rate limiting;",
            "help the customer answer requests from data subjects, as far as FormBook makes this possible;",
            "tell the customer without undue delay after becoming aware of a personal data breach affecting its data."
          ]}
        />
      </LegalSection>

      <LegalSection title="5. Subprocessors">
        <p>The customer agrees that Gondal Tech may use these subprocessors:</p>
        <LegalList
          items={[
            "Supabase: database and sign-in.",
            "Vercel: hosting.",
            "GoHighLevel: the customer's own CRM and calendar, and Gondal Tech's own CRM for account emails.",
            "Cloudflare Turnstile, when enabled: bot checks at signup.",
            "Meta: only when the customer connects a Meta pixel."
          ]}
        />
        <p>
          Gondal Tech will give notice of a new subprocessor by updating this page and emailing account holders, so the
          customer can object before the change takes effect.
        </p>
      </LegalSection>

      <LegalSection title="6. Meta">
        <p>
          Hashed contact data and event data go to Meta only on the customer&apos;s instruction, and only to the pixel
          the customer supplies. Gondal Tech does not use this data for its own purposes.
        </p>
      </LegalSection>

      <LegalSection title="7. Acceptable use">
        <p>
          Phishing and spam are not allowed, along with the other uses listed in the Terms of Service. Gondal Tech may
          take down any form that breaks these rules or puts people at risk.
        </p>
      </LegalSection>

      <LegalSection title="8. International transfers">
        <p>[Owner to confirm transfer mechanism]</p>
      </LegalSection>

      <LegalSection title="9. Return and deletion">
        <p>
          When the service ends, Gondal Tech will delete the customer&apos;s data, or return it first if the customer
          asks, unless the law requires us to keep it. Deletion requests go to{" "}
          <a className="font-semibold underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="10. Audits">
        <p>
          On reasonable written request, Gondal Tech will give the customer the information needed to show that it
          meets this addendum.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
