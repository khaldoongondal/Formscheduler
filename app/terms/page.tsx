import Link from "next/link";
import { PRODUCT_ICONS } from "@/lib/marketing/site";
import { LegalList, LegalPage, LegalSection } from "@/components/legal/legal-page";
import { CONTACT_EMAIL, PLANS, formatPlanPrice } from "@/lib/billing/plans";

export const metadata = {
  icons: PRODUCT_ICONS,
  title: "Terms of Service",
  description: "The terms for using FormBook."
};

const free = PLANS.free;
const scaling = PLANS.scaling;

function pixelText(count: number): string {
  return `${count} Meta ${count === 1 ? "pixel" : "pixels"}`;
}

export default function TermsPage() {
  return (
    <LegalPage
      current="/terms"
      title="Terms of Service"
      intro={
        <p>
          These terms apply when you create a FormBook account or use FormBook to publish forms. If you use FormBook
          for a business, you confirm that you can accept these terms for that business.
        </p>
      }
    >
      <LegalSection title="1. Who we are">
        <p>
          FormBook is provided by Gondal Tech (&quot;Gondal Tech&quot;, &quot;we&quot;, &quot;us&quot;), which is the
          party to these terms with you. It lets
          businesses build short qualifying forms and booking pages that save leads and book calls into the
          business&apos;s own GoHighLevel account. You can reach us at{" "}
          <a className="font-semibold underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts">
        <LegalList
          items={[
            "Give accurate details when you sign up and keep them up to date.",
            "You must verify your email address before the account works.",
            "One person is responsible for each account and for everything done with it.",
            "Keep your password safe and tell us straight away if you think someone else has used your account."
          ]}
        />
      </LegalSection>

      <LegalSection title="3. Plans">
        <LegalList
          items={[
            `${free.name}: ${formatPlanPrice(free)}. Up to ${free.maxActiveForms} active forms, ${free.maxDraftForms} drafts and ${pixelText(free.maxPixels)}.`,
            `${scaling.name}: ${formatPlanPrice(scaling)}. Up to ${scaling.maxActiveForms} active forms, ${scaling.maxDraftForms} drafts and ${pixelText(scaling.maxPixels)}.`
          ]}
        />
        <p>
          The {scaling.name} plan is billed monthly through a secure payment page. You can cancel from the Manage
          billing link on your Plan page or by emailing us; your account then moves to the {free.name} plan at the end
          of the paid period. We may change plan limits or prices and will give you notice before a change affects
          your account. When your account moves to a plan with lower limits, nothing is deleted: forms and Meta pixels
          above the new limits are frozen and stop taking leads and sending events until you upgrade or choose which
          ones stay active.
        </p>
        <p>
          Refunds: if you ask for a refund, your {scaling.name} plan ends straight away and your account moves to the{" "}
          {free.name} plan. We refund the amount you paid for the current billing period minus a charge for the days
          already used. The charge for each day is the monthly price divided by the number of days in that billing
          period. We issue the refund to the card or account you paid with.
        </p>
      </LegalSection>

      <LegalSection title="4. The FormBook badge">
        <p>
          Forms on the free {free.name} plan may show a small &quot;Powered by FormBook&quot; link under the form.
          Forms on the {scaling.name} plan do not show it.
        </p>
      </LegalSection>

      <LegalSection title="5. Your content and your leads">
        <p>
          You own your forms, your content and the lead data your forms collect. You give Gondal Tech the rights we
          need to host, process, display and send that content and data in order to run FormBook for you, as described
          in the{" "}
          <Link className="font-semibold underline underline-offset-2" href="/privacy">
            Privacy Policy
          </Link>{" "}
          and the{" "}
          <Link className="font-semibold underline underline-offset-2" href="/dpa">
            Data Processing Addendum
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection title="6. Acceptable use">
        <p>You must not use FormBook to:</p>
        <LegalList
          items={[
            "run phishing, or trick people into giving away sign-in details or money;",
            "collect passwords, payment card numbers or bank login details through a form;",
            "send or support spam;",
            "pretend to be another person, business or organisation;",
            "publish or collect anything illegal;",
            "mislead people about who is collecting their data or why;",
            "probe, overload or disrupt FormBook or try to get around its limits."
          ]}
        />
      </LegalSection>

      <LegalSection title="7. Third-party services">
        <p>
          GoHighLevel, and Meta if you connect a pixel, are your own accounts with those companies. Your use of them is
          under their terms, and they are responsible for their own services. We are not responsible for changes or
          outages on their side.
        </p>
      </LegalSection>

      <LegalSection title="8. Suspension and takedown">
        <p>
          We may take down a form, or suspend an account, that breaks these terms or puts people at risk. Where it is
          safe to do so, we will tell you why. Anyone can report a form with the &quot;Report this form&quot; link
          shown under every public form, and we review every report.
        </p>
      </LegalSection>

      <LegalSection title="9. Ending the service and deletion requests">
        <p>
          You can stop using FormBook at any time and ask us to delete your account and data by emailing{" "}
          {CONTACT_EMAIL}. We may end the service for an account with notice, or straight away for a serious breach of
          these terms. Data already sent to your GoHighLevel or Meta accounts stays there under your control.
        </p>
      </LegalSection>

      <LegalSection title="10. Disclaimers and limitation of liability">
        <p>
          FormBook is provided as it is and as available. We work to keep it running and secure, but we do not promise
          that it will always be available, free of errors, or that it will produce any particular business result.
        </p>
        <p>
          To the extent the law allows, Gondal Tech is not liable for indirect or consequential losses, such as lost
          profits, lost leads or lost data, and our total liability is limited to the amount you paid us for FormBook
          in the period before the claim. Nothing in these terms limits liability that cannot be limited by law.
        </p>
      </LegalSection>

      <LegalSection title="11. Changes to these terms and governing law">
        <p>
          We may update these terms. We will change the date at the top of this page and tell account holders by email
          about important changes. Continuing to use FormBook after a change means you accept the new terms.
        </p>
        <p>These terms are governed by the laws of [Owner to confirm governing law].</p>
      </LegalSection>

      <LegalSection title="12. Contact">
        <p>
          Questions about these terms go to{" "}
          <a className="font-semibold underline underline-offset-2" href={`mailto:${CONTACT_EMAIL}`}>
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
