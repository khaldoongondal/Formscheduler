/**
 * Copy for the public help page /help/connections (P4.4). Pure: no Next.js,
 * Supabase or I/O imports. Anchors come from the provider registry so links
 * from the admin ("How to set this up") always land on the right section.
 */
import { CALENDLY_COPY } from "@/lib/calendly/constants";
import { PROVIDERS } from "@/lib/connections/registry";
import { FORMBOOK_EVENT_VERSION, type FormBookEvent } from "@/lib/crm/event-payload";
import { HUBSPOT_COPY } from "@/lib/hubspot/constants";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER } from "@/lib/webhooks/signing";

export type HelpSection = {
  anchor: string;
  title: string;
  intro: string;
  steps?: string[];
  notes?: string[];
};

/** The example webhook body (P3.8), made-up values only. */
export const WEBHOOK_EXAMPLE_EVENT: FormBookEvent = {
  id: "fbk.lead.booked.6f1c2a1e-0000-4000-8000-000000000001.fb6f1c2a1e000040008000000000000a",
  type: "lead.booked",
  version: FORMBOOK_EVENT_VERSION,
  created_at: "2026-12-01T15:04:05.000Z",
  form: { id: "11111111-1111-4111-8111-111111111111", name: "Free strategy call", slug: "strategy-call" },
  lead: {
    id: "6f1c2a1e-0000-4000-8000-000000000001",
    status: "booked",
    full_name: "Alex Example",
    first_name: "Alex",
    last_name: "Example",
    email: "alex@example.com",
    phone: "+14165550101",
    created_at: "2026-12-01T15:00:00.000Z"
  },
  answers: [{ key: "budget", question: "What is your monthly budget?", value: "$1,000 to $5,000" }],
  tracking: {
    source_url: "https://example.com/book",
    referrer: null,
    landing_page_url: "https://example.com/offer",
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "winter",
    utm_content: null,
    utm_term: null,
    utm_id: null,
    utm_adset: null,
    utm_adid: null,
    utm_adsetid: null,
    utm_campaignid: null,
    fbclid: null,
    gclid: null,
    ttclid: null,
    country_code: "CA",
    region: "ON",
    city: "Toronto",
    split_test: null
  },
  booking: {
    provider: "google_calendar",
    start: "2026-12-03T14:00:00.000Z",
    end: "2026-12-03T14:30:00.000Z",
    timezone: "America/Toronto",
    booking_id: "fb6f1c2a1e000040008000000000000a",
    meeting_url: "https://meet.google.com/abc-defg-hij"
  },
  disqualification: null
};

export const WEBHOOK_EXAMPLE_JSON = JSON.stringify(WEBHOOK_EXAMPLE_EVENT, null, 2);

/** The signature check shown on the help page (Node.js). */
export const WEBHOOK_VERIFY_SNIPPET = [
  'import { createHmac, timingSafeEqual } from "node:crypto";',
  "export function isFromFormBook(header, rawBody, secret) {",
  '  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=")));',
  "  const t = Number(parts.t);",
  "  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;",
  '  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");',
  '  const given = String(parts.v1 ?? "");',
  "  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));",
  "}"
].join("\n");

export const HELP_COPY: {
  metaTitle: string; metaDescription: string; title: string; subtitle: string; contentsHeading: string;
  exampleHeading: string; verifyHeading: string; supportLine: string; sections: readonly HelpSection[];
} = {
  metaTitle: "Connecting your calendar and CRM",
  metaDescription: "How to connect a calendar and a CRM to FormBook.",
  title: "Connecting your calendar and CRM",
  subtitle: "FormBook help",
  contentsHeading: "On this page",
  exampleHeading: "Example payload",
  verifyHeading: "Checking the signature",
  supportLine: "Still stuck? Email",
  sections: [
    {
      anchor: "how-it-works",
      title: "How it works",
      intro:
        "Each form books into one calendar and sends its leads to one CRM. You connect both once under Connections, then pick them for each form in the form editor, in section 3, Calendar and CRM.",
      notes: [
        "A form can be activated once it has a working calendar and a CRM.",
        "Calendars: GoHighLevel, Google Calendar, Cal.com and Calendly.",
        "CRMs: GoHighLevel, HubSpot, and a webhook for n8n, Zapier, Make and other tools.",
        "A GoHighLevel calendar always sends leads to the same GoHighLevel connection. Any other calendar can send leads to any CRM."
      ]
    },
    {
      anchor: PROVIDERS.ghl.helpAnchor,
      title: "GoHighLevel",
      intro: "GoHighLevel can be both the calendar and the CRM for a form.",
      steps: [
        "Open Connections and choose Connect GoHighLevel to sign in and pick a sub-account, or add the connection by hand with your Location ID and a private integration token.",
        "Set a default calendar ID on the connection, or a calendar ID on each form.",
        "In the form editor, pick the GoHighLevel connection as the calendar.",
        "Optional: set the pipeline and stage IDs for new, booked and disqualified leads, and map questions to custom fields."
      ],
      notes: [
        "FormBook creates or updates the contact when the lead is captured and books the appointment in the chosen calendar.",
        "A GoHighLevel connection can also be the CRM for a form that books into another calendar."
      ]
    },
    {
      anchor: PROVIDERS.google_calendar.helpAnchor,
      title: "Google Calendar",
      intro: "Visitors pick a time from your free slots and the meeting is added to your Google Calendar.",
      steps: [
        "Open Connections and choose Connect Google Calendar, then sign in with the Google account whose calendar you want to use.",
        "Open the new connection and set your working hours, time zone, meeting length, buffers before and after, minimum notice and how many days ahead to offer.",
        "In the form editor, pick the Google Calendar connection and choose whether to add a Google Meet link."
      ],
      notes: [
        "Bookings go to your primary calendar with the lead invited as a guest.",
        "Open times are your working hours minus the busy times on your primary calendar.",
        "FormBook reads only your free and busy times and can change only events on calendars you own.",
        "Right before a booking is saved FormBook checks the time is still free, so two visitors cannot book the same time."
      ]
    },
    {
      anchor: PROVIDERS.calcom.helpAnchor,
      title: "Cal.com",
      intro: "Visitors pick a time from one of your Cal.com event types inside the FormBook form.",
      steps: [
        "In Cal.com, open Settings, then Developer, then API keys, and create an API key.",
        "In FormBook, open Connections, choose Add Cal.com and paste the key.",
        "In the form editor, pick the Cal.com connection and choose an event type."
      ],
      notes: [
        "Bookings follow the event type's rules in Cal.com, and Cal.com sends its own confirmation emails.",
        "If the event type needs your confirmation, FormBook counts the booking as booked and Cal.com asks you to confirm it.",
        "Only Cal.com cloud accounts are supported."
      ]
    },
    {
      anchor: PROVIDERS.calendly.helpAnchor,
      title: "Calendly",
      intro: "Calendly's own scheduling page is the last step of your form, with the lead's name and email filled in.",
      steps: [
        "In Calendly, open Integrations and apps, then API and webhooks, and create a personal access token.",
        "In FormBook, open Connections, choose Add Calendly and paste the token. FormBook then sets up booking confirmations.",
        "In the form editor, pick the Calendly connection and choose an event type."
      ],
      notes: [
        CALENDLY_COPY.limits,
        "If Calendly refuses booking notifications for your account, the connection shows Needs attention and forms using it cannot be activated. Choose Set up confirmations on the connection to try again."
      ]
    },
    {
      anchor: PROVIDERS.hubspot.helpAnchor,
      title: "HubSpot",
      intro: "Every lead becomes a HubSpot contact with a note holding the answers and tracking details.",
      steps: [
        "In HubSpot, create a private app under Settings, Integrations, Private apps.",
        `Give it these scopes: ${HUBSPOT_COPY.scopes.join(", ")}.`,
        "Copy its access token. In FormBook, open Connections, choose Add HubSpot and paste the token.",
        "In the form editor, pick the HubSpot connection under Send leads to."
      ],
      notes: [
        "FormBook creates or updates the contact by email, or by phone when there is no email, and adds a note for each lead event.",
        "Optional: turn on deals for the form and choose a pipeline and the stages for new leads, booked calls and disqualified leads."
      ]
    },
    {
      anchor: PROVIDERS.webhook.helpAnchor,
      title: "Webhook (n8n, Zapier, Make and others)",
      intro:
        "FormBook sends each lead event as signed JSON to an https address you choose. Use it to send leads to any CRM through your automation tool.",
      steps: [
        "n8n: add a Webhook node set to POST and use its production URL.",
        'Zapier: use the "Webhooks by Zapier" trigger with Catch Hook and copy its URL.',
        "Make: add a Custom webhook module and copy its address.",
        "In FormBook, open Connections, choose Add webhook, paste the address and generate a signing secret. Copy the secret into your tool.",
        "Choose Send test on the connection, then pick the webhook under Send leads to in the form editor."
      ],
      notes: [
        "Events: lead.captured, lead.qualified, lead.disqualified, lead.booked, and test.ping from Send test.",
        "Each event has a unique id. The same event can arrive more than once (retries), so use id to ignore duplicates.",
        "version changes only when a field is removed or changes meaning. New fields may be added at any time.",
        "Events for one lead arrive in order. A failed event is retried up to 8 times over about 2 hours, then marked failed in the delivery log.",
        "Respond with any 2xx status within 10 seconds. Redirects are not followed.",
        "Only public https addresses are allowed. Local and private network addresses are refused.",
        `Verify: the ${SIGNATURE_HEADER} header looks like t=1764150000,v1=5d4c... Compute HMAC-SHA256 with your secret over {t}.{raw body}, compare in constant time, and reject when t is more than 5 minutes old. The same time is also sent in ${TIMESTAMP_HEADER}.`
      ]
    },
    {
      anchor: "troubleshooting",
      title: "Something not working?",
      intro: "Start with the connection's status on the Connections page.",
      notes: [
        "Needs attention means the provider refused FormBook's access, for example a revoked token. Open the connection to see why, then reconnect or paste a new token.",
        "Check connection on a connection asks the provider whether FormBook can still reach it.",
        "Open the delivery log of a CRM connection to see every event sent, the answer received, and to send a failed event again.",
        "A form that cannot be activated shows the reason in the form editor, in section 3, Calendar and CRM."
      ]
    }
  ]
};

const EMAIL_PATTERN = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/** FORMBOOK_SUPPORT_EMAIL, or null when unset or not an email address (the contact line is then hidden). */
export function supportEmailFrom(raw: string | undefined | null): string | null {
  const value = raw?.trim() ?? "";
  return value && value.length <= 254 && EMAIL_PATTERN.test(value) ? value : null;
}
