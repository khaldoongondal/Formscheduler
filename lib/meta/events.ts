/**
 * The six FormBook events that can go to Meta, their Meta names and switches.
 * Pure: no Next.js or Supabase imports.
 */

export const META_EVENT_KEYS = [
  "form_view",
  "form_start",
  "lead",
  "qualified_lead",
  "disqualified_lead",
  "booked_call"
] as const;

export type MetaEventKey = (typeof META_EVENT_KEYS)[number];

export type PixelSwitches = {
  send_form_view: boolean;
  send_form_start: boolean;
  send_lead: boolean;
  send_qualified_lead: boolean;
  send_disqualified_lead: boolean;
  send_booked_call: boolean;
};

export type MetaEventDef = {
  metaName: string;
  standard: boolean;
  label: string;
  when: string;
  switchColumn: keyof PixelSwitches;
  defaultOn: boolean;
};

export const META_EVENT_DEFS: Record<MetaEventKey, MetaEventDef> = {
  form_view: {
    metaName: "ViewContent",
    standard: true,
    label: "Form view",
    when: "A visitor opens the form.",
    switchColumn: "send_form_view",
    defaultOn: true
  },
  form_start: {
    metaName: "FormStart",
    standard: false,
    label: "Form start",
    when: "A visitor answers the first question or starts typing.",
    switchColumn: "send_form_start",
    defaultOn: true
  },
  lead: {
    metaName: "Lead",
    standard: true,
    label: "Lead",
    when: "A visitor submits their contact details.",
    switchColumn: "send_lead",
    defaultOn: true
  },
  qualified_lead: {
    metaName: "QualifiedLead",
    standard: false,
    label: "Qualified lead",
    when: "A lead answers every required question without being disqualified.",
    switchColumn: "send_qualified_lead",
    defaultOn: true
  },
  disqualified_lead: {
    metaName: "DisqualifiedLead",
    standard: false,
    label: "Disqualified lead",
    when: "A lead gives an answer that disqualifies them.",
    switchColumn: "send_disqualified_lead",
    defaultOn: false
  },
  booked_call: {
    metaName: "Schedule",
    standard: true,
    label: "Booked call",
    when: "A lead books a call.",
    switchColumn: "send_booked_call",
    defaultOn: true
  }
};

/** Meta name for the "Send test event" button. */
export const TEST_EVENT_META_NAME = "ViewContent";

export function isMetaEventKey(value: unknown): value is MetaEventKey {
  return typeof value === "string" && (META_EVENT_KEYS as readonly string[]).includes(value);
}

export function metaEventName(key: MetaEventKey | "test_event"): string {
  return key === "test_event" ? TEST_EVENT_META_NAME : META_EVENT_DEFS[key].metaName;
}

export function isEventEnabled(key: MetaEventKey, switches: PixelSwitches): boolean {
  return switches[META_EVENT_DEFS[key].switchColumn] === true;
}

/** Reference part of an event id: a page load id, a lead session id or a random uuid. */
export const META_EVENT_REF_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidEventRef(value: unknown): value is string {
  return typeof value === "string" && META_EVENT_REF_PATTERN.test(value);
}

/**
 * Decision M5: `fbk1.{key}.{ref}`. Stable for the same key and ref, so a
 * retried request maps to the same queue row and Meta deduplicates it.
 */
export function buildMetaEventId(key: MetaEventKey | "test_event", ref: string): string {
  if (!isValidEventRef(ref)) {
    throw new Error("Invalid Meta event reference.");
  }
  if (key !== "test_event" && !isMetaEventKey(key)) {
    throw new Error("Unknown Meta event key.");
  }
  return `fbk1.${key}.${ref}`;
}
