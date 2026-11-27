/** Calendly constants and copy (decisions C15, C16). Pure: no imports. */
export const CALENDLY_API_BASE = "https://api.calendly.com";
/** U24: the recipes page shows https://calendly.com/assets/external/widget.js; switch if the release test shows a problem. */
export const CALENDLY_WIDGET_SCRIPT = "https://assets.calendly.com/assets/external/widget.js";
/** U14: the origin of the widget's postMessage events. */
export const CALENDLY_MESSAGE_ORIGINS = ["https://calendly.com"] as const;
export const INVITEE_URI_PATTERN = /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]{1,64}\/invitees\/[A-Za-z0-9-]{1,64}$/;
export const EVENT_URI_PATTERN = /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]{1,64}$/;
export const EVENT_TYPE_URI_PATTERN = /^https:\/\/api\.calendly\.com\/event_types\/[A-Za-z0-9-]{1,64}$/;
export const WEBHOOK_SUBSCRIPTION_URI_PATTERN = /^https:\/\/api\.calendly\.com\/webhook_subscriptions\/[A-Za-z0-9-]{1,64}$/;
export const USER_URI_PATTERN = /^https:\/\/api\.calendly\.com\/users\/[A-Za-z0-9-]{1,64}$/;
export const ORGANIZATION_URI_PATTERN = /^https:\/\/api\.calendly\.com\/organizations\/[A-Za-z0-9-]{1,64}$/;
export const SCHEDULING_URL_PATTERN = /^https:\/\/calendly\.com\/[A-Za-z0-9_/.-]{1,300}$/;
export const SIGNATURE_TOLERANCE_SECONDS = 180;
export const CALENDLY_WEBHOOK_MAX_BYTES = 65_536;

export const CALENDLY_COPY = {
  createHeading: "Add Calendly",
  createIntro: "Paste a Calendly personal access token. Each form then picks one of your event types.",
  nameLabel: "Name",
  defaultName: "Calendly",
  tokenLabel: "Personal access token",
  tokenHelp:
    "In Calendly, open Integrations and apps, then API and webhooks, and create a personal access token. FormBook uses it to read your event types, check bookings and receive booking notifications.",
  /** U12: scopes are not confirmed by the documentation read. */
  scopes: ["users:read", "event_types:read", "scheduled_events:read", "webhooks:write"],
  createButton: "Add Calendly",
  tokenRejected: "Calendly did not accept this token.",
  tokenCheckFailed: "Calendly could not be reached. Please try again.",
  tokenFormat: "That does not look like a Calendly personal access token.",
  alreadyConnected: "This Calendly account is already connected.",
  otherAccount: "This token belongs to another Calendly account. Add it as a new connection instead.",
  created: "Calendly connected. Choose an event type on each form that uses it.",
  tokenReplaced: "Access token replaced.",
  confirmationsSetUp: "Booking confirmations are set up.",
  signedInAs: (name: string) => `Signed in as ${name}`,
  tokenEnding: (lastFour: string) => `Token ending in ${lastFour}`,
  replaceToken: "Replace token",
  confirmationsLabel: "Booking confirmations:",
  confirmationsOn: "Set up",
  confirmationsOff: "Not set up",
  setUpConfirmations: "Set up confirmations",
  intro:
    "Calendly shows its own scheduling page as the last step of your form. FormBook marks the lead as booked when Calendly confirms the booking.",
  limits:
    "Limits with Calendly: visitors pick a time inside Calendly's page, not in FormBook's own time list. Calendly sends its own confirmation emails. FormBook needs Calendly's booking notifications to record bookings reliably; Calendly's documentation says they are available on every plan.",
  refusedUpgrade: "Calendly refused booking notifications for this account: Please upgrade to a paid Calendly account.",
  refused: "Calendly refused booking notifications for this account.",
  setupFailed: "Booking notifications could not be set up. Choose Set up confirmations to try again.",
  setupTemporaryFailure:
    "Calendly did not answer, so nothing was changed on this connection. Choose Set up confirmations to try again in a few minutes.",
  tokenNoLongerAccepted: "Calendly no longer accepts the access token. Paste a new token on this connection.",
  checkOk: "Calendly accepted the access token.",
  checkFailed: "Calendly did not answer. Please try again later.",
  appUrlMissing: "The app address is not set on this server, so booking notifications cannot be set up.",
  // Form editor panel.
  eventTypeLabel: "Event type",
  eventTypePlaceholder: "Choose an event type",
  eventTypesLoadFailed: "Could not load your Calendly event types. Check the connection under Connections.",
  chooseEventType: "Choose an event type from the list.",
  noEventTypes: "This Calendly account has no active event types. Create one in Calendly, then reload this page.",
  panelNote: "Visitors pick a time in Calendly's own scheduling page, shown as the last step of the form.",
  // Booking page.
  stepHeading: "Choose the best time",
  stepBody: "Pick a time below to book your call.",
  scriptFailed: "The calendar could not load. Please allow calendly.com or try another browser.",
  confirmPending: "We could not confirm this booking yet. Calendly has your booking and FormBook will update shortly."
} as const;
