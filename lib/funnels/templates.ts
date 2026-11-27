/**
 * Starter form templates for call-booking funnels (Sprint 4 P2, decision D17).
 * Questions, options and copy only: no claims, figures or names. Pure: no
 * Next.js, Supabase or I/O imports.
 */

export type TemplateOption = { stable_key: string; label: string; value: string; is_disqualifying: boolean };

export type TemplateQuestion = {
  stable_key: string;
  label: string;
  help_text: string | null;
  question_type: "text" | "url" | "number" | "single_select" | "multi_select";
  placeholder: string | null;
  is_required: boolean;
  options: TemplateOption[];
};

export type TemplateContactField = "full_name" | "phone" | "first_name" | "last_name" | "email";

export type FormTemplate = {
  key: "discovery_call" | "sales_consultation" | "estimate_call" | "application_call";
  name: string;
  audience: string;
  summary: string;
  defaultDescription: string;
  appointmentTitle: string;
  contactFields: Record<TemplateContactField, boolean>;
  contactFieldOrder: TemplateContactField[];
  questions: TemplateQuestion[];
};

export const BLANK_TEMPLATE_KEY = "blank";

export const BLANK_TEMPLATE_COPY = {
  legend: "Start from",
  name: "Blank form",
  summary: "Contact details only. Add your own questions."
} as const;

export const TEMPLATE_QUESTIONS_FAILED_MESSAGE = "We could not add the template questions. Please try again.";

const DISQUALIFY_HELP = "If you answer No, the form ends here. You can change this in Questions.";

/** Options whose value equals the stable key; the last argument marks disqualifying keys. */
function options(entries: Array<[string, string]>, disqualifying: string[] = []): TemplateOption[] {
  return entries.map(([key, label]) => ({ stable_key: key, label, value: key, is_disqualifying: disqualifying.includes(key) }));
}

function single(stable_key: string, label: string, entries: Array<[string, string]>, extra: Partial<TemplateQuestion> = {}, disqualifying: string[] = []): TemplateQuestion {
  return {
    stable_key,
    label,
    help_text: null,
    question_type: "single_select",
    placeholder: null,
    is_required: true,
    options: options(entries, disqualifying),
    ...extra
  };
}

function text(stable_key: string, label: string, is_required: boolean, extra: Partial<TemplateQuestion> = {}): TemplateQuestion {
  return { stable_key, label, help_text: null, question_type: "text", placeholder: null, is_required, options: [], ...extra };
}

const CONTACT_FIELDS: FormTemplate["contactFields"] = { full_name: true, phone: true, first_name: false, last_name: false, email: true };
const CONTACT_FIELD_ORDER: TemplateContactField[] = ["full_name", "email", "phone", "first_name", "last_name"];

const timelineQuestion = (): TemplateQuestion =>
  single("timeline", "When would you like to get started?", [
    ["now", "Right away"],
    ["next_month", "In the next month"],
    ["next_quarter", "In the next three months"],
    ["browsing", "Just looking for now"]
  ]);

export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    key: "discovery_call",
    name: "Discovery call",
    audience: "Agencies, consultants and service businesses",
    summary: "Find out what someone needs and when they want to start.",
    defaultDescription: "Answer a few quick questions, then pick a time for a short call.",
    appointmentTitle: "Discovery call",
    contactFields: { ...CONTACT_FIELDS },
    contactFieldOrder: [...CONTACT_FIELD_ORDER],
    questions: [
      single("main_goal", "What would you like help with?", [
        ["more_leads", "Getting more leads"],
        ["more_calls", "Turning more leads into calls"],
        ["after_call", "Improving what happens after the call"],
        ["other", "Something else"]
      ]),
      { stable_key: "website", label: "What is your website?", help_text: null, question_type: "url", placeholder: "https://", is_required: false, options: [] },
      timelineQuestion(),
      text("notes", "Is there anything we should know before the call?", false)
    ]
  },
  {
    key: "sales_consultation",
    name: "Sales consultation",
    audience: "Businesses selling higher-value services",
    summary: "Check budget, role and timing before the call.",
    defaultDescription: "Tell us a little about your business, then book a time that suits you.",
    appointmentTitle: "Sales consultation",
    contactFields: { ...CONTACT_FIELDS },
    contactFieldOrder: [...CONTACT_FIELD_ORDER],
    questions: [
      text("company_name", "What is your company called?", true),
      single("role", "What is your role?", [
        ["owner", "Owner or founder"],
        ["manager", "Manager"],
        ["team_member", "Team member"]
      ]),
      single(
        "decision_maker",
        "Do you make the decision on this purchase?",
        [
          ["yes", "Yes"],
          ["shared", "I decide with others"],
          ["no", "No, someone else decides"]
        ],
        { help_text: DISQUALIFY_HELP },
        ["no"]
      ),
      single("monthly_budget", "What monthly budget have you set aside for this?", [
        ["under_1k", "Under $1,000"],
        ["1k_5k", "$1,000 to $5,000"],
        ["5k_10k", "$5,000 to $10,000"],
        ["over_10k", "Over $10,000"],
        ["not_set", "I have not set a budget yet"]
      ]),
      timelineQuestion()
    ]
  },
  {
    key: "estimate_call",
    name: "Free estimate call",
    audience: "Home services and local businesses that quote before they book",
    summary: "Collect the job details you need to give a quote.",
    defaultDescription: "Tell us about the job, then pick a time for your free estimate call.",
    appointmentTitle: "Estimate call",
    contactFields: { ...CONTACT_FIELDS },
    contactFieldOrder: [...CONTACT_FIELD_ORDER],
    questions: [
      single("service_needed", "Which service do you need?", [
        ["repair", "Repair"],
        ["install", "Installation or replacement"],
        ["maintenance", "Maintenance"],
        ["not_sure", "Not sure yet"]
      ]),
      single("property_type", "What type of property is it?", [
        ["house", "House"],
        ["apartment", "Apartment or condo"],
        ["business", "Business premises"]
      ]),
      text("postal_code", "What is your postal or ZIP code?", true),
      single("urgency", "How soon do you need this?", [
        ["asap", "As soon as possible"],
        ["two_weeks", "Within two weeks"],
        ["month", "Within a month"],
        ["prices", "Just comparing prices"]
      ]),
      text("job_details", "Tell us a little about the job.", false)
    ]
  },
  {
    key: "application_call",
    name: "Application call",
    audience: "Coaches, programs and done-with-you offers",
    summary: "Ask applicants about their goals and readiness before they book.",
    defaultDescription: "Apply for a call by answering a few questions.",
    appointmentTitle: "Application call",
    contactFields: { ...CONTACT_FIELDS },
    contactFieldOrder: [...CONTACT_FIELD_ORDER],
    questions: [
      text("current_situation", "Where is your business today?", true),
      text("main_goal", "What is the main result you want in the next 90 days?", true),
      single("worked_with_coach", "Have you worked with a coach or program before?", [
        ["yes", "Yes"],
        ["no", "No"]
      ]),
      single("hours_per_week", "How many hours a week can you give to this?", [
        ["under_2", "Under 2"],
        ["2_to_5", "2 to 5"],
        ["over_5", "More than 5"]
      ]),
      single(
        "ready_to_invest",
        "If we are a good fit, are you ready to invest in getting help now?",
        [
          ["yes", "Yes"],
          ["maybe", "I need to think about it"],
          ["no", "No, not right now"]
        ],
        { help_text: DISQUALIFY_HELP },
        ["no"]
      )
    ]
  }
];

export const TEMPLATE_KEYS: readonly string[] = [BLANK_TEMPLATE_KEY, ...FORM_TEMPLATES.map((template) => template.key)];

/** The template for a key; null for "blank", unknown values and non-strings. */
export function getFormTemplate(key: unknown): FormTemplate | null {
  if (typeof key !== "string") return null;
  return FORM_TEMPLATES.find((template) => template.key === key) ?? null;
}

/** The radio value to check by default: the query value when valid, else blank. */
export function defaultTemplateChoice(value: unknown): string {
  return typeof value === "string" && TEMPLATE_KEYS.includes(value) ? value : BLANK_TEMPLATE_KEY;
}
