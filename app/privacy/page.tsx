export const metadata = {
  title: "Privacy Policy | FormBook"
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
      <p className="mt-2 text-sm text-slate-500">Last updated: July 3, 2026</p>

      <div className="mt-8 space-y-6 text-sm leading-6 text-slate-700">
        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">1. Overview</h2>
          <p>
            FormBook, operated by Gondal Tech, provides qualification forms and booking
            pages on behalf of the businesses that use our platform. When you fill out a form or
            book an appointment, we collect information as a <strong>processor</strong> on behalf of
            that business (the <strong>controller</strong> of your data).
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">2. What we collect</h2>
          <p>When you interact with a booking page we may collect:</p>
          <ul className="mt-2 list-disc space-y-1 pl-6">
            <li>Contact details you provide (name, email address, phone number)</li>
            <li>Your answers to the qualification questions on the form</li>
            <li>The appointment time you select</li>
            <li>
              Technical data: IP address, browser user agent, referring page, UTM campaign
              parameters, approximate country, and a browser-generated visitor identifier used to
              measure funnel performance
            </li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">3. How your data is used</h2>
          <p>
            Your information is used to schedule your appointment, route your enquiry to the right
            team, and give the business you are booking with analytics about their booking pages.
            Your contact details, answers, and appointment are transmitted to the business&apos;s
            CRM and calendar system (GoHighLevel). We do not sell your personal information or use
            it for advertising.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">4. Retention and deletion</h2>
          <p>
            We retain lead and booking records for as long as the business customer maintains an
            active account, after which data is deleted within a commercially reasonable period. To
            request access to or deletion of your personal data, contact the business you booked
            with, or email us at the address below and we will assist or forward your request to
            the responsible business.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">5. Security</h2>
          <p>
            Data is stored with access controls and row-level security, transmitted over TLS, and
            third-party API credentials are encrypted at rest. No method of transmission or storage
            is completely secure, but we work to protect your information using industry-standard
            practices.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">6. Your rights</h2>
          <p>
            Depending on your location, you may have rights to access, correct, delete, or restrict
            processing of your personal data (including under the GDPR and CCPA). We support the
            businesses we work with in honoring these requests.
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">7. Contact</h2>
          <p>
            Privacy questions or requests:{" "}
            <a className="font-semibold underline underline-offset-2" href="mailto:khaldoon@gondaltech.com">
              khaldoon@gondaltech.com
            </a>
          </p>
        </section>
      </div>
    </main>
  );
}
