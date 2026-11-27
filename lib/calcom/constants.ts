/**
 * Cal.com cloud API constants (decision C14). Pure: no imports.
 * U8: cal-api-version values read from the v2 reference on 2026-11-26; they change often.
 */
export const CALCOM_API_BASE = "https://api.cal.com";
export const CALCOM_API_VERSIONS = { slots: "2024-09-04", bookings: "2026-02-25", eventTypes: "2026-06-12" } as const;
export const CALCOM_KEY_PATTERN = /^cal_[A-Za-z0-9_]{16,200}$/;

export const CALCOM_COPY = {
  createHeading: "Add Cal.com",
  createIntro: "Paste a Cal.com API key. Each form then picks one of your event types.",
  nameLabel: "Name",
  defaultName: "Cal.com",
  keyLabel: "API key",
  keyHelp: "Create one in Cal.com under Settings, Developer, API keys. FormBook stores it encrypted and never shows it again.",
  createButton: "Add Cal.com",
  keyPattern: "That does not look like a Cal.com API key. It starts with cal_.",
  keyRejected: "Cal.com did not accept this API key.",
  keyCheckFailed: "Cal.com could not be reached. Please try again.",
  alreadyConnected: "This Cal.com account is already connected.",
  created: "Cal.com connected. Choose an event type on each form that uses it.",
  keyReplaced: "API key replaced.",
  account: (username: string) => `Account ${username}`,
  keyEnding: (lastFour: string) => `API key ending in ${lastFour}`,
  replaceKey: "Replace API key",
  keyNoLongerAccepted: "Cal.com no longer accepts the API key. Paste a new key on this connection.",
  eventTypeLabel: "Event type",
  eventTypePlaceholder: "Choose an event type",
  hiddenMarker: " (hidden)",
  confirmationMarker: " (needs your confirmation)",
  confirmationNote: "Bookings for this event type wait for your confirmation in Cal.com. FormBook counts them as booked.",
  eventTypesLoadFailed: "Could not load your Cal.com event types. Check the connection under Connections.",
  chooseEventType: "Choose an event type from the list.",
  noEventTypes: "This Cal.com account has no event types yet. Create one in Cal.com, then reload this page.",
  daysLabel: "Days of availability to show",
  checkOk: "Cal.com accepted the API key.",
  checkFailed: "Cal.com did not answer. Please try again later."
} as const;
