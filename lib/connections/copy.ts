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
  notSet: "Not set",
  // Connection detail page (P2.8).
  backToConnections: "Back to Connections",
  renameLabel: "Name",
  renameButton: "Rename",
  switchOff: "Switch off",
  switchOn: "Switch on",
  checkConnection: "Check connection",
  lastChecked: (when: string, summary: string) => `Last checked ${when}: ${summary}`,
  neverChecked: "Not checked yet.",
  formsUsingHeading: "Forms using this connection",
  noFormsUsing: "No forms use this connection yet.",
  activeBadge: "Active",
  deleteButton: "Delete connection",
  deleteTitle: "Delete this connection?",
  deleteDescription: (name: string) =>
    `This removes ${name} from FormBook. Forms using it cannot take bookings until you choose another connection.`,
  connectionDeleted: "Connection deleted.",
  savedRenamed: "Name saved.",
  savedDisabled: "Connection switched off.",
  savedEnabled: "Connection switched on.",
  savedChecked: "Check finished.",
  savedCreated: "Connection added."
} as const;
