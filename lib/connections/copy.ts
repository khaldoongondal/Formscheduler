/**
 * Copy for the Connections page and the form editor pickers.
 * Pure: no Next.js, Supabase or I/O imports.
 */

export const SLOT_TAKEN_MESSAGE = "That time was just taken. Please choose another time.";

export const CONNECTIONS_COPY = {
  heading: "Connections",
  subheading: "Connect the calendar your forms book into and the CRM that receives your leads. Each form picks one of each.",
  calendarsHeading: "Calendars",
  crmsHeading: "CRMs",
  ghlAlsoCrm: "GoHighLevel connections above also work as a CRM.",
  addHeading: "Add a connection",
  addDescription: "Credentials are stored encrypted on the server and are never sent to public pages.",
  ghlSubheading: "GoHighLevel",
  noGhlConnections: "No GoHighLevel connections yet.",
  noCalendars: "No calendars connected yet.",
  noCrms: "No CRMs connected yet.",
  open: "Open",
  badgeConnected: "Connected",
  badgeNeedsAttention: "Needs attention",
  badgeDisabled: "Switched off",
  ghlDeleted: "GoHighLevel connection deleted.",
  ghlOauthConnected: "GoHighLevel account connected. Set a default calendar below and you're ready to book.",
  notFound: "Not found.",
  deleteBlocked: (names: string[]) => `Turn off or move these forms first: ${names.join(", ")}.`,
  connectionLimit: "You can have up to 25 connections. Delete one you no longer use first.",
  foreignConnection: "Choose a connection from your own account.",
  checkLimit: "You have run 10 checks in the last hour. Please try again later.",
  // Form editor.
  editorSectionTitle: "3. Calendar and CRM",
  editorSectionDescription: "Pick where visitors book and where their details go.",
  calendarLabel: "Calendar",
  calendarPlaceholder: "Choose a calendar",
  crmLabel: "Send leads to",
  crmPlaceholder: "Choose a CRM",
  manageConnections: "Manage connections",
  sameGhlConnection: "The same GoHighLevel connection (contacts and opportunities).",
  saveToLoad: "Save to load the choices for this connection.",
  needsAttentionSuffix: " (needs attention)",
  disabledSuffix: " (switched off)",
  inactiveSuffix: " (inactive)",
  ghlMappingOnly: "GoHighLevel field mapping is used only when this form sends leads to GoHighLevel.",
  ghlPipelinesOnly: "Pipelines and the opportunity name are used only when this form sends leads to GoHighLevel.",
  notSet: "Not set"
} as const;
