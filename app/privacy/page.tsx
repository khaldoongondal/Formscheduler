import Link from "next/link";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { CONTACT_EMAIL } from "@/lib/billing/plans";

export const metadata = {
  title: "Privacy Policy",
  description: "How FormBook, a tool from Gondal Tech, handles personal data."
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      intro={
        <p>
          This policy explains how Gondal Tech handles personal data in FormBook. It covers two groups of people:
          businesses that hold a FormBook account, and people who fill in a form that one of those businesses published.
        </p>
      }
    >
      <LegalSection title="1. Account holders">
        <p>When you create an account we collect:</p>
        <LegalList
          items={[
            "your name, email address, phone number, business name and website, as entered at signup;",
            "sign-in data, such as your email address, a protected version of your password and sign-in times;",
            "usage data, such as the forms you create, settings you change and basic technical details about your browser."
          ]}
        />
        <p>We use this data to:</p>
        <LegalList
          items={[
            "run FormBook and keep your account secure;",
            "contact you about your account, including verification and password emails, and the optional free setup call;",
            "follow up with you about Gondal Tech services. You can opt out of this at any time by emailing us."
          ]}
        />
        <p>
          We keep your account details in Gondal Tech&apos;s own CRM, which runs on GoHighLevel, to manage your account and
          follow up with you. We send it your name, email address, phone number, business name and website, your plan, the
          dates you reach steps such as verifying your email, connecting a tool, activating a form, and getting your first
          lead or booking, and simple counts such as how many forms, Meta pixels, connections, leads and bookings your
          account has. We never send the answers people give in your forms.
        </p>
      </LegalSection>

      <LegalSection title="2. People who fill in a form">
        <p>
          Each form belongs to the business that published it. That business is the controller of the answers you give
          and decides what happens to them. FormBook processes your answers on that business&apos;s instructions, for
          example to save your details, check whether a call is a fit, and book a call in the business&apos;s
          calendar. Along with your answers, the form records your IP address and browser details. Questions about your data, including requests to see or delete it, should go to that business
          first. If you cannot reach them, email us and we will pass your request on.
        </p>
      </LegalSection>

      <LegalSection title="3. Subprocessors">
        <p>We use these services to run FormBook:</p>
        <LegalList
          items={[
            "Supabase: database and sign-in.",
            "Vercel: hosting.",
            "GoHighLevel: the customer's own CRM and calendar, where leads and bookings are sent, and Gondal Tech's own CRM for account emails and account management.",
            "Google Calendar, Cal.com and Calendly: only when a customer connects one of them as the calendar for a form. Bookings are created in the customer's own account.",
            "HubSpot: only when a customer connects it as the CRM for a form. Lead details are sent to the customer's own HubSpot account.",
            "Webhook addresses: when a customer chooses a webhook as the CRM for a form, FormBook sends lead details to the web address the customer chose.",
            "Cloudflare Turnstile, when enabled: a check that a signup comes from a person and not a bot.",
            "Meta: only when a customer connects a Meta pixel to a form."
          ]}
        />
      </LegalSection>

      <LegalSection title="4. Data sent to Meta">
        <p>
          When a customer connects a Meta pixel to a form, FormBook sends form events and hashed contact data (such as
          a hashed email address and phone number) to Meta on that customer&apos;s instruction, and only to the pixel the
          customer supplied. The customer is responsible for telling people about this and getting any consent it needs.
        </p>
        <p>
          When a customer connects a Meta pixel, FormBook sends form events to Meta with hashed contact details (such as
          email and phone), the visitor&apos;s IP address and browser details, and Meta click and browser IDs when present.
        </p>
      </LegalSection>

      <LegalSection title="5. Retention">
        <LegalList
          items={[
            "Account data is kept while the account is open and for a reasonable period after it closes, for example to answer questions or meet legal duties.",
            "Lead data is kept until the customer deletes it or asks us to delete it.",
            "Security logs and rate-limit counters are short-lived and removed automatically."
          ]}
        />
      </LegalSection>

      <LegalSection title="6. Your rights and deletion requests">
        <p>
          Depending on where you live, you may have the right to see, correct or delete your personal data, or to
          object to how it is used. Account holders can make these requests by emailing{" "}
          <a className="font-semibold underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          . People who filled in a form should contact the business that owns the form, as explained above.
        </p>
      </LegalSection>

      <LegalSection title="7. Cookies and local storage">
        <LegalList
          items={[
            "The FormBook admin uses sign-in cookies to keep you signed in.",
            "Public forms keep a random visitor id in your browser's local storage so the business can count views and starts for its form."
          ]}
        />
      </LegalSection>

      <LegalSection title="8. Changes and contact">
        <p>
          We may update this policy and will change the date at the top of the page when we do. Questions go to{" "}
          {CONTACT_EMAIL}. See also the{" "}
          <Link className="font-semibold underline underline-offset-2" href="/dpa">
            Data Processing Addendum
          </Link>{" "}
          and the{" "}
          <Link className="font-semibold underline underline-offset-2" href="/terms">
            Terms of Service
          </Link>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
