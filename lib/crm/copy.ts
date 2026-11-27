/** Delivery log copy (P3.6). Pure: no imports. */
export const DELIVERIES_COPY = {
  heading: (name: string) => `Delivery log: ${name}`,
  intro: (name: string) =>
    `Every lead event FormBook sends to ${name}. Failed events are retried automatically up to 8 times over about 2 hours.`,
  empty: "Nothing has been sent to this connection yet.",
  statusFilter: "Status",
  eventFilter: "Event",
  filterButton: "Show",
  statusLabels: { all: "All", pending: "Waiting", sent: "Delivered", failed: "Failed", skipped: "Skipped", cancelled: "Cancelled" },
  eventLabels: {
    all: "All",
    "lead.captured": "New lead",
    "lead.qualified": "Qualified",
    "lead.disqualified": "Disqualified",
    "lead.booked": "Booked",
    "test.ping": "Test"
  },
  columns: { time: "Time", event: "Event", lead: "Lead", status: "Status", attempts: "Attempts", result: "Result" },
  leadFallback: (ref: string) => `Lead ${ref}`,
  testLead: "Test event",
  sendAgain: "Send again",
  resent: "Queued to send again.",
  resendFailed: "This event cannot be sent again.",
  older: "Older events",
  newest: "Newest events",
  backToConnection: "Back to the connection",
  reasons: {
    connection_removed: "The connection was removed.",
    connection_off: "The connection is switched off or inactive.",
    no_payload: "The event details were cleared after 30 days.",
    form_removed: "The form was deleted.",
    retry_budget: "Gave up after 8 attempts.",
    expired: "Not sent within 3 days.",
    manual_retry: "Sent again by you.",
    blocked_address: "The address is not allowed."
  } as Record<string, string>
} as const;

/** The lead detail page cards (P4.6). */
export const LEAD_DETAIL_COPY = {
  deliveriesHeading: "CRM deliveries",
  deliveriesEmpty: "No CRM events have been sent for this lead.",
  deliveriesNote: "Forms on a GoHighLevel calendar send leads to GoHighLevel directly, so they have no rows here.",
  connectionColumn: "Connection",
  removedConnection: "Removed connection",
  openLog: "Delivery log",
  bookingsHeading: "Bookings",
  bookingsEmpty: "No booking attempts for this lead yet.",
  bookingColumns: { time: "Meeting time", calendar: "Calendar", status: "Status", meeting: "Meeting link" },
  bookingStatusLabels: {
    pending: "In progress",
    booked: "Booked",
    error: "Failed",
    cancelled: "Cancelled"
  } as Record<string, string>,
  openMeeting: "Open",
  notScheduled: "No time"
} as const;
