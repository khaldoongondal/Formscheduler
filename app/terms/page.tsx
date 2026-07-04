export const metadata = {
  title: "Terms of Service | FormBook"
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: July 3, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-slate-700">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">1. Who we are</h2>
          <p>
            FormBook (&quot;the Service&quot;) is a lead qualification and appointment
            scheduling platform operated by Gondal Tech (&quot;we&quot;, &quot;us&quot;). The Service
            lets businesses build qualification forms and booking pages that schedule appointments
            into their own CRM and calendar systems.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">2. Acceptance of terms</h2>
          <p>
            By creating an account, submitting a form, or booking an appointment through the
            Service, you agree to these Terms. If you use the Service on behalf of a business, you
            represent that you have authority to bind that business.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">3. Accounts and subscriptions</h2>
          <p>
            Business customers subscribe to a paid plan that limits the number of forms and
            calendars they may use. Fees are billed in advance and are non-refundable except where
            required by law. We may suspend accounts with unpaid balances. You are responsible for
            safeguarding your login credentials and for all activity under your account.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">4. Acceptable use</h2>
          <p>
            You may not use the Service to send spam, collect data unlawfully, impersonate others,
            probe or disrupt our infrastructure, or collect information from children under 16. We
            may suspend or terminate accounts that violate these rules.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">5. Customer data</h2>
          <p>
            Business customers own the lead and booking data collected through their forms. We
            process that data on their behalf to operate the Service, as described in our{" "}
            <a className="font-semibold underline underline-offset-2" href="/privacy">
              Privacy Policy
            </a>
            . Appointment, contact, and CRM records are transmitted to the customer&apos;s connected
            systems (such as GoHighLevel), which remain the customer&apos;s systems of record.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">6. Availability and changes</h2>
          <p>
            We aim for high availability but do not guarantee uninterrupted service. We may modify
            or discontinue features with reasonable notice to paying customers. We may update these
            Terms; continued use after an update constitutes acceptance.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">7. Disclaimers and liability</h2>
          <p>
            The Service is provided &quot;as is&quot; without warranties of any kind. To the maximum
            extent permitted by law, our total liability arising out of the Service is limited to
            the fees paid by you in the twelve months preceding the claim. We are not liable for
            indirect, incidental, or consequential damages, or for the acts of third-party services
            connected to your account.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">8. Contact</h2>
          <p>
            Questions about these Terms: <a className="font-semibold underline underline-offset-2" href="mailto:khaldoon@gondaltech.com">khaldoon@gondaltech.com</a>
          </p>
        </section>
      </div>
    </main>
  );
}
