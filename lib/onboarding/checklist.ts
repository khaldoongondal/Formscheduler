/**
 * Setup checklist and setup-call card rules (Sprint 4 P2, decisions D16, D19).
 * Pure: no Next.js, Supabase or I/O imports. Every input comes from rows the
 * caller already loaded.
 */
import { SETUP_COPY } from "@/lib/connections/setup-state";

export const CHECKLIST_COPY = {
  title: "Set up FormBook",
  progress: (done: number, total: number) => `${done} of ${total} done`,
  optionalHeading: "Optional",
  done: "Done",
  hide: "Hide checklist",
  showAgain: "Show the setup checklist",
  completeTitle: "Setup complete",
  completeBody: "Your form is ready to take bookings.",
  callLink: "Book a setup call with a free CRO diagnostic",
  steps: {
    connect_calendar: { title: "Connect a calendar", body: SETUP_COPY.calendarStepBody, cta: "Connect a calendar" },
    connect_crm: { title: "Connect a CRM", body: SETUP_COPY.crmStepBody, cta: "Connect a CRM" },
    create_form: { title: "Create a form", body: "Start from a template or a blank form.", cta: "Create a form" },
    preview_form: {
      title: "Preview your form",
      body: "Open the preview in the form editor and try it the way a visitor would.",
      cta: "Open the preview"
    },
    activate_form: {
      title: "Activate your form",
      body: "A form can go live once it has a calendar and a CRM.",
      cta: "Go to form settings"
    },
    copy_embed: { title: "Copy the embed code", body: "Paste it on your website, or share the form link.", cta: "Get the embed code" },
    attach_pixel: { title: "Attach a Meta pixel", body: "Send server-side Meta events from your form.", cta: "Add a pixel" },
    start_split_test: { title: "Start a split test", body: "Send one link to two or three forms and compare them.", cta: "Create a split test" }
  }
} as const;

export const SETUP_CALL_COPY = {
  getting_started: {
    title: "Book your setup call + free CRO diagnostic",
    body: "A free setup call with the founder. We'll set up your first form and include a free CRO diagnostic to review where leads stall.",
    cta: "Book a setup call"
  },
  first_form_live: {
    title: "Want a second pair of eyes on your funnel?",
    body: "Review your form, calendar and follow-up with the founder in a setup call that includes a free CRO diagnostic.",
    cta: "Book a free call"
  },
  dismiss: "Not now",
  planPageLine: "Not sure which plan fits? Book a setup call with a free CRO diagnostic."
} as const;

export type ChecklistInput = {
  calendarDone: boolean;
  crmDone: boolean;
  /** Oldest form (created_at asc), any state. */
  firstFormId: string | null;
  formCount: number;
  /** Oldest active form, else oldest frozen form. */
  firstLiveFormId: string | null;
  /** Any form active or frozen (frozen forms were activated once). */
  hasActivatedForm: boolean;
  previewOpened: boolean;
  embedCopied: boolean;
  /** Any form with a Meta pixel. */
  hasPixelOnForm: boolean;
  /** Any split test running or ended. */
  hasStartedSplitTest: boolean;
};

export type ChecklistStepKey =
  | "connect_calendar"
  | "connect_crm"
  | "create_form"
  | "preview_form"
  | "activate_form"
  | "copy_embed"
  | "attach_pixel"
  | "start_split_test";

export type ChecklistStep = {
  key: ChecklistStepKey;
  title: string;
  body: string;
  cta: string;
  href: string;
  done: boolean;
  optional: boolean;
};

export type Checklist = {
  steps: ChecklistStep[];
  requiredDone: number;
  requiredTotal: 6;
  complete: boolean;
  nextKey: ChecklistStepKey | null;
};

export const CREATE_FORM_HREF = "/admin/funnels?create=1#create-funnel";

const REQUIRED_KEYS = [
  "connect_calendar",
  "connect_crm",
  "create_form",
  "preview_form",
  "activate_form",
  "copy_embed"
] as const satisfies readonly ChecklistStepKey[];

const OPTIONAL_KEYS = ["attach_pixel", "start_split_test"] as const satisfies readonly ChecklistStepKey[];

function formPath(id: string): string {
  return `/admin/funnels/${encodeURIComponent(id)}`;
}

function stepHref(key: ChecklistStepKey, input: ChecklistInput): string {
  switch (key) {
    case "connect_calendar":
      return "/admin/connections#calendars";
    case "connect_crm":
      return "/admin/connections#crms";
    case "create_form":
      return CREATE_FORM_HREF;
    case "preview_form":
      return input.firstFormId ? `${formPath(input.firstFormId)}?preview=1` : CREATE_FORM_HREF;
    case "activate_form":
      return input.firstFormId ? `${formPath(input.firstFormId)}#settings` : CREATE_FORM_HREF;
    case "copy_embed": {
      const id = input.firstLiveFormId ?? input.firstFormId;
      return id ? `${formPath(id)}#embed-links` : CREATE_FORM_HREF;
    }
    case "attach_pixel":
      return "/admin/pixels";
    case "start_split_test":
      return "/admin/split-tests";
  }
}

function stepDone(key: ChecklistStepKey, input: ChecklistInput): boolean {
  switch (key) {
    case "connect_calendar":
      return input.calendarDone;
    case "connect_crm":
      return input.crmDone;
    case "create_form":
      return input.formCount > 0;
    case "preview_form":
      return input.previewOpened;
    case "activate_form":
      return input.hasActivatedForm;
    case "copy_embed":
      return input.embedCopied;
    case "attach_pixel":
      return input.hasPixelOnForm;
    case "start_split_test":
      return input.hasStartedSplitTest;
  }
}

function buildStep(key: ChecklistStepKey, input: ChecklistInput, optional: boolean): ChecklistStep {
  const copy = CHECKLIST_COPY.steps[key];
  return {
    key,
    title: copy.title,
    body: copy.body,
    cta: copy.cta,
    href: stepHref(key, input),
    done: stepDone(key, input),
    optional
  };
}

export function deriveChecklist(input: ChecklistInput): Checklist {
  const required = REQUIRED_KEYS.map((key) => buildStep(key, input, false));
  const optional = OPTIONAL_KEYS.map((key) => buildStep(key, input, true));
  const requiredDone = required.filter((step) => step.done).length;
  const next = required.find((step) => !step.done) ?? null;
  return {
    steps: [...required, ...optional],
    requiredDone,
    requiredTotal: 6,
    complete: requiredDone === required.length,
    nextKey: next ? next.key : null
  };
}

export type SetupCallMoment = "getting_started" | "first_form_live";

export const SETUP_CALL_MAX_ACCOUNT_AGE_DAYS = 60;

export function setupCallMoment(input: {
  urlConfigured: boolean;
  dismissed: boolean;
  checklistComplete: boolean;
  hasActiveForm: boolean;
  accountAgeDays: number;
}): SetupCallMoment | null {
  if (!input.urlConfigured || input.dismissed) return null;
  if (!input.checklistComplete && !input.hasActiveForm) return "getting_started";
  if (Number.isFinite(input.accountAgeDays) && input.accountAgeDays < SETUP_CALL_MAX_ACCOUNT_AGE_DAYS) return "first_form_live";
  return null;
}

/** Whole days between an ISO time and now; 0 for a missing, invalid or future time. */
export function accountAgeDays(createdAtIso: string | null | undefined, nowMs: number): number {
  const created = createdAtIso ? Date.parse(createdAtIso) : Number.NaN;
  if (!Number.isFinite(created) || created > nowMs) return 0;
  return Math.floor((nowMs - created) / 86_400_000);
}

/**
 * Checklist inputs from loaded form rows. Rows in any order; "oldest" is by
 * created_at, then id.
 */
export function formFactsForChecklist(
  forms: Array<{ id: string; is_published: boolean; frozen_at?: string | null; meta_pixel_id?: string | null; created_at: string }>
): Pick<ChecklistInput, "firstFormId" | "formCount" | "firstLiveFormId" | "hasActivatedForm" | "hasPixelOnForm"> {
  const sorted = [...forms].sort((a, b) => {
    const left = Date.parse(a.created_at);
    const right = Date.parse(b.created_at);
    const l = Number.isFinite(left) ? left : Number.POSITIVE_INFINITY;
    const r = Number.isFinite(right) ? right : Number.POSITIVE_INFINITY;
    if (l !== r) return l < r ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const active = sorted.find((form) => form.is_published);
  const frozen = sorted.find((form) => !form.is_published && Boolean(form.frozen_at));
  return {
    firstFormId: sorted[0]?.id ?? null,
    formCount: sorted.length,
    firstLiveFormId: active?.id ?? frozen?.id ?? null,
    hasActivatedForm: Boolean(active || frozen),
    hasPixelOnForm: sorted.some((form) => Boolean(form.meta_pixel_id))
  };
}

/** return_to for the onboarding actions: exactly one of the two pages, else the forms list. */
export function onboardingReturnPath(value: unknown): "/admin/funnels" | "/admin/welcome" {
  return value === "/admin/welcome" ? "/admin/welcome" : "/admin/funnels";
}
