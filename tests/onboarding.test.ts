import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHECKLIST_COPY,
  CREATE_FORM_HREF,
  SETUP_CALL_COPY,
  accountAgeDays,
  deriveChecklist,
  formFactsForChecklist,
  onboardingReturnPath,
  setupCallMoment,
  type ChecklistInput,
  type ChecklistStepKey
} from "@/lib/onboarding/checklist";
import { SETUP_COPY } from "@/lib/connections/setup-state";
import {
  BLANK_TEMPLATE_COPY,
  BLANK_TEMPLATE_KEY,
  FORM_TEMPLATES,
  TEMPLATE_KEYS,
  TEMPLATE_QUESTIONS_FAILED_MESSAGE,
  defaultTemplateChoice,
  getFormTemplate
} from "@/lib/funnels/templates";
import {
  PREVIEW_COPY,
  PREVIEW_READY_MESSAGE,
  PREVIEW_THEME_MESSAGE,
  isPreviewThemeMessage,
  previewSlots,
  previewThemeFromValues
} from "@/lib/booking/preview";
import { contactFieldSettingsSchema, createFunnelSchema, questionOptionSchema, questionSchema } from "@/lib/validation/funnels";

const EM_DASH = String.fromCharCode(0x2014);
const TENANT_ID = "00000000-0000-4000-8000-000000000001";
const FUNNEL_ID = "00000000-0000-4000-8000-000000000002";
const QUESTION_ID = "00000000-0000-4000-8000-000000000003";
const FORM_A = "00000000-0000-4000-8000-0000000000aa";
const FORM_B = "00000000-0000-4000-8000-0000000000bb";

const EMPTY: ChecklistInput = {
  calendarDone: false,
  crmDone: false,
  firstFormId: null,
  formCount: 0,
  firstLiveFormId: null,
  hasActivatedForm: false,
  previewOpened: false,
  embedCopied: false,
  hasPixelOnForm: false,
  hasStartedSplitTest: false
};

const ALL_REQUIRED: ChecklistInput = {
  ...EMPTY,
  calendarDone: true,
  crmDone: true,
  firstFormId: FORM_A,
  formCount: 1,
  firstLiveFormId: FORM_A,
  hasActivatedForm: true,
  previewOpened: true,
  embedCopied: true
};

function step(input: ChecklistInput, key: ChecklistStepKey) {
  const found = deriveChecklist(input).steps.find((candidate) => candidate.key === key);
  assert.ok(found, `step ${key} exists`);
  return found;
}

function allStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "function") out.push(String((value as (a: number, b: number) => string)(1, 6)));
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, out));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => allStrings(item, out));
  return out;
}

describe("deriveChecklist", () => {
  it("an empty account has 0 of 6 done and the calendar next", () => {
    const checklist = deriveChecklist(EMPTY);
    assert.equal(checklist.requiredDone, 0);
    assert.equal(checklist.requiredTotal, 6);
    assert.equal(checklist.complete, false);
    assert.equal(checklist.nextKey, "connect_calendar");
    assert.deepEqual(
      checklist.steps.map((candidate) => candidate.key),
      ["connect_calendar", "connect_crm", "create_form", "preview_form", "activate_form", "copy_embed", "attach_pixel", "start_split_test"]
    );
    assert.deepEqual(
      checklist.steps.filter((candidate) => candidate.optional).map((candidate) => candidate.key),
      ["attach_pixel", "start_split_test"]
    );
  });

  it("a GoHighLevel-style account with both connections has the first two done", () => {
    const checklist = deriveChecklist({ ...EMPTY, calendarDone: true, crmDone: true });
    assert.equal(checklist.requiredDone, 2);
    assert.equal(checklist.nextKey, "create_form");
  });

  it("each step flips with its own input", () => {
    const cases: Array<[ChecklistStepKey, Partial<ChecklistInput>]> = [
      ["connect_calendar", { calendarDone: true }],
      ["connect_crm", { crmDone: true }],
      ["create_form", { formCount: 1, firstFormId: FORM_A }],
      ["preview_form", { previewOpened: true }],
      ["activate_form", { hasActivatedForm: true }],
      ["copy_embed", { embedCopied: true }],
      ["attach_pixel", { hasPixelOnForm: true }],
      ["start_split_test", { hasStartedSplitTest: true }]
    ];
    for (const [key, patch] of cases) {
      assert.equal(step(EMPTY, key).done, false, `${key} starts not done`);
      const input = { ...EMPTY, ...patch };
      assert.equal(step(input, key).done, true, `${key} done with its input`);
      const others = deriveChecklist(input).steps.filter((candidate) => candidate.key !== key && candidate.done);
      assert.deepEqual(others.map((candidate) => candidate.key), [], `${key} flips nothing else`);
    }
  });

  it("a frozen form counts as activated", () => {
    const facts = formFactsForChecklist([
      { id: FORM_A, is_published: false, frozen_at: "2026-11-20T10:00:00Z", created_at: "2026-11-01T10:00:00Z" }
    ]);
    assert.equal(facts.hasActivatedForm, true);
    assert.equal(facts.firstLiveFormId, FORM_A);
    assert.equal(step({ ...EMPTY, ...facts }, "activate_form").done, true);
  });

  it("form facts pick the oldest form and prefer an active form for the embed link", () => {
    const facts = formFactsForChecklist([
      { id: FORM_B, is_published: true, meta_pixel_id: null, created_at: "2026-11-05T10:00:00Z" },
      { id: FORM_A, is_published: false, frozen_at: null, meta_pixel_id: "p", created_at: "2026-11-01T10:00:00Z" }
    ]);
    assert.equal(facts.firstFormId, FORM_A);
    assert.equal(facts.firstLiveFormId, FORM_B);
    assert.equal(facts.formCount, 2);
    assert.equal(facts.hasPixelOnForm, true);
    const empty = formFactsForChecklist([]);
    assert.deepEqual(empty, { firstFormId: null, formCount: 0, firstLiveFormId: null, hasActivatedForm: false, hasPixelOnForm: false });
  });

  it("hrefs use the first form and fall back to the create link without one", () => {
    assert.equal(step(EMPTY, "connect_calendar").href, "/admin/connections#calendars");
    assert.equal(step(EMPTY, "connect_crm").href, "/admin/connections#crms");
    assert.equal(step(EMPTY, "create_form").href, CREATE_FORM_HREF);
    assert.equal(CREATE_FORM_HREF, "/admin/funnels?create=1#create-funnel");
    assert.equal(step(EMPTY, "preview_form").href, CREATE_FORM_HREF);
    assert.equal(step(EMPTY, "activate_form").href, CREATE_FORM_HREF);
    assert.equal(step(EMPTY, "copy_embed").href, CREATE_FORM_HREF);
    assert.equal(step(EMPTY, "attach_pixel").href, "/admin/pixels");
    assert.equal(step(EMPTY, "start_split_test").href, "/admin/split-tests");

    const withForm = { ...EMPTY, firstFormId: FORM_A, formCount: 1 };
    assert.equal(step(withForm, "preview_form").href, `/admin/funnels/${FORM_A}?preview=1`);
    assert.equal(step(withForm, "activate_form").href, `/admin/funnels/${FORM_A}#settings`);
    assert.equal(step(withForm, "copy_embed").href, `/admin/funnels/${FORM_A}#embed-links`);
    assert.equal(step({ ...withForm, firstLiveFormId: FORM_B }, "copy_embed").href, `/admin/funnels/${FORM_B}#embed-links`);
  });

  it("complete only when all six required steps are done; optional steps never count", () => {
    assert.equal(deriveChecklist(ALL_REQUIRED).complete, true);
    assert.equal(deriveChecklist(ALL_REQUIRED).nextKey, null);
    assert.equal(deriveChecklist(ALL_REQUIRED).requiredDone, 6);
    const withOptional = deriveChecklist({ ...ALL_REQUIRED, hasPixelOnForm: true, hasStartedSplitTest: true });
    assert.equal(withOptional.requiredDone, 6);
    const onlyOptional = deriveChecklist({ ...EMPTY, hasPixelOnForm: true, hasStartedSplitTest: true });
    assert.equal(onlyOptional.requiredDone, 0);
    assert.equal(onlyOptional.complete, false);
    for (const key of ["connect_calendar", "connect_crm", "create_form", "preview_form", "activate_form", "copy_embed"] as const) {
      const missingOne = deriveChecklist({
        ...ALL_REQUIRED,
        ...(key === "connect_calendar" ? { calendarDone: false } : {}),
        ...(key === "connect_crm" ? { crmDone: false } : {}),
        ...(key === "create_form" ? { formCount: 0 } : {}),
        ...(key === "preview_form" ? { previewOpened: false } : {}),
        ...(key === "activate_form" ? { hasActivatedForm: false } : {}),
        ...(key === "copy_embed" ? { embedCopied: false } : {})
      });
      assert.equal(missingOne.complete, false, `${key} missing`);
      assert.equal(missingOne.nextKey, key);
    }
  });

  it("calendar and CRM bodies are the existing setup copy", () => {
    assert.equal(CHECKLIST_COPY.steps.connect_calendar.body, SETUP_COPY.calendarStepBody);
    assert.equal(CHECKLIST_COPY.steps.connect_crm.body, SETUP_COPY.crmStepBody);
    assert.equal(CHECKLIST_COPY.progress(2, 6), "2 of 6 done");
  });

  it("return_to is exactly one of the two pages", () => {
    assert.equal(onboardingReturnPath("/admin/welcome"), "/admin/welcome");
    assert.equal(onboardingReturnPath("/admin/funnels"), "/admin/funnels");
    assert.equal(onboardingReturnPath("https://evil.example.com"), "/admin/funnels");
    assert.equal(onboardingReturnPath("/admin/welcome?x=1"), "/admin/funnels");
    assert.equal(onboardingReturnPath(null), "/admin/funnels");
  });
});

describe("setupCallMoment", () => {
  const base = { urlConfigured: true, dismissed: false, checklistComplete: false, hasActiveForm: false, accountAgeDays: 1 };

  it("is null when the URL is unset or the card was dismissed", () => {
    assert.equal(setupCallMoment({ ...base, urlConfigured: false }), null);
    assert.equal(setupCallMoment({ ...base, dismissed: true }), null);
    assert.equal(setupCallMoment({ ...base, dismissed: true, hasActiveForm: true }), null);
  });

  it("getting_started before the checklist is done and before any active form", () => {
    assert.equal(setupCallMoment(base), "getting_started");
    assert.equal(setupCallMoment({ ...base, accountAgeDays: 400 }), "getting_started");
  });

  it("first_form_live by an active form or a complete checklist", () => {
    assert.equal(setupCallMoment({ ...base, hasActiveForm: true }), "first_form_live");
    assert.equal(setupCallMoment({ ...base, checklistComplete: true }), "first_form_live");
    assert.equal(setupCallMoment({ ...base, hasActiveForm: true, accountAgeDays: 59 }), "first_form_live");
  });

  it("null after 60 days once the first form is live", () => {
    assert.equal(setupCallMoment({ ...base, hasActiveForm: true, accountAgeDays: 60 }), null);
    assert.equal(setupCallMoment({ ...base, checklistComplete: true, accountAgeDays: 90 }), null);
  });

  it("account age is whole days and 0 for missing or future times", () => {
    const now = Date.parse("2026-11-27T12:00:00Z");
    assert.equal(accountAgeDays("2026-11-27T01:00:00Z", now), 0);
    assert.equal(accountAgeDays("2026-11-25T11:00:00Z", now), 2);
    assert.equal(accountAgeDays(null, now), 0);
    assert.equal(accountAgeDays("not a date", now), 0);
    assert.equal(accountAgeDays("2026-12-25T11:00:00Z", now), 0);
  });
});

describe("starter templates", () => {
  it("there are four templates plus blank", () => {
    assert.equal(FORM_TEMPLATES.length, 4);
    assert.deepEqual(TEMPLATE_KEYS, [BLANK_TEMPLATE_KEY, "discovery_call", "sales_consultation", "estimate_call", "application_call"]);
  });

  for (const template of FORM_TEMPLATES) {
    describe(template.name, () => {
      it("every question and option parses with the form schemas", () => {
        template.questions.forEach((question, index) => {
          const parsed = questionSchema.safeParse({
            tenant_id: TENANT_ID,
            funnel_id: FUNNEL_ID,
            stable_key: question.stable_key,
            label: question.label,
            help_text: question.help_text,
            question_type: question.question_type,
            placeholder: question.placeholder,
            is_required: question.is_required,
            display_order: index,
            ghl_field_key: null,
            ghl_custom_field_id: null,
            ghl_custom_field_key: null
          });
          assert.ok(parsed.success, `${template.key}.${question.stable_key}: ${parsed.success ? "" : parsed.error.message}`);
          question.options.forEach((option, optionIndex) => {
            const parsedOption = questionOptionSchema.safeParse({
              tenant_id: TENANT_ID,
              question_id: QUESTION_ID,
              stable_key: option.stable_key,
              label: option.label,
              value: option.value,
              display_order: optionIndex,
              is_disqualifying: option.is_disqualifying
            });
            assert.ok(parsedOption.success, `${template.key}.${question.stable_key}.${option.stable_key}`);
          });
        });
      });

      it("has unique stable keys, values equal to keys and enough options", () => {
        assert.ok(template.questions.length >= 4);
        const keys = template.questions.map((question) => question.stable_key);
        assert.equal(new Set(keys).size, keys.length);
        for (const question of template.questions) {
          const optionKeys = question.options.map((option) => option.stable_key);
          assert.equal(new Set(optionKeys).size, optionKeys.length, `${question.stable_key} option keys unique`);
          for (const option of question.options) assert.equal(option.value, option.stable_key);
          if (question.question_type === "single_select" || question.question_type === "multi_select") {
            assert.ok(question.options.length >= 2, `${question.stable_key} has options`);
          } else {
            assert.equal(question.options.length, 0, `${question.stable_key} has no options`);
          }
        }
      });

      it("contact fields pass the schema and the order is a permutation of the five keys", () => {
        assert.ok(contactFieldSettingsSchema.safeParse(template.contactFields).success);
        assert.deepEqual(template.contactFields, { full_name: true, phone: true, first_name: false, last_name: false, email: true });
        assert.deepEqual([...template.contactFieldOrder].sort(), ["email", "first_name", "full_name", "last_name", "phone"]);
        assert.deepEqual(template.contactFieldOrder, ["full_name", "email", "phone", "first_name", "last_name"]);
      });

      it("the create schema accepts its key and copy", () => {
        const parsed = createFunnelSchema.safeParse({
          tenant_id: TENANT_ID,
          name: template.name,
          slug: "starter-form",
          description: template.defaultDescription,
          appointment_title: template.appointmentTitle,
          contact_fields: template.contactFields,
          contact_field_order: template.contactFieldOrder,
          template_key: template.key,
          theme: { primary_color: "#173f2d", accent_color: "#4f9a78", button_color: "#173f2d", border_radius: 8 }
        });
        assert.ok(parsed.success, parsed.success ? "" : parsed.error.message);
        assert.equal(parsed.success && parsed.data.template_key, template.key);
      });
    });
  }

  it("two templates mark exactly one disqualifying option, with help text saying so", () => {
    const withDisqualifier = FORM_TEMPLATES.filter((template) =>
      template.questions.some((question) => question.options.some((option) => option.is_disqualifying))
    );
    assert.deepEqual(withDisqualifier.map((template) => template.key), ["sales_consultation", "application_call"]);
    for (const template of withDisqualifier) {
      const flagged = template.questions.flatMap((question) =>
        question.options.filter((option) => option.is_disqualifying).map((option) => ({ question, option }))
      );
      assert.equal(flagged.length, 1);
      assert.equal(flagged[0].option.stable_key, "no");
      assert.ok(flagged[0].question.help_text?.includes("form ends here"));
    }
  });

  it("question order is as listed", () => {
    assert.deepEqual(
      getFormTemplate("discovery_call")?.questions.map((question) => question.stable_key),
      ["main_goal", "website", "timeline", "notes"]
    );
    assert.deepEqual(
      getFormTemplate("estimate_call")?.questions.map((question) => question.stable_key),
      ["service_needed", "property_type", "postal_code", "urgency", "job_details"]
    );
  });

  it("blank and unknown keys give null; the default choice is blank", () => {
    assert.equal(getFormTemplate("blank"), null);
    assert.equal(getFormTemplate("unknown_template"), null);
    assert.equal(getFormTemplate(undefined), null);
    assert.equal(getFormTemplate(42), null);
    assert.equal(getFormTemplate("discovery_call")?.key, "discovery_call");
    assert.equal(defaultTemplateChoice("application_call"), "application_call");
    assert.equal(defaultTemplateChoice("nope"), BLANK_TEMPLATE_KEY);
    assert.equal(defaultTemplateChoice(null), BLANK_TEMPLATE_KEY);
  });

  it("template keys fit the database format check", () => {
    for (const key of TEMPLATE_KEYS) assert.match(key, /^[a-z_]{2,40}$/);
  });

  it("no em dash anywhere in the template data", () => {
    const strings = allStrings([FORM_TEMPLATES, BLANK_TEMPLATE_COPY, TEMPLATE_QUESTIONS_FAILED_MESSAGE]);
    assert.ok(strings.length > 50);
    for (const value of strings) assert.ok(!value.includes(EM_DASH), value);
  });
});

describe("previewSlots", () => {
  const TORONTO = "America/Toronto";
  const local = (iso: string, tz: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

  it("Friday 18:00 in Toronto gives Monday to Wednesday, 12 slots", () => {
    // 2026-11-27 is a Friday; 18:00 Toronto is 23:00 UTC.
    const slots = previewSlots(new Date("2026-11-27T23:00:00Z"), TORONTO, 30);
    assert.equal(slots.length, 12);
    const days = [...new Set(slots.map((slot) => local(slot.startTime, TORONTO).split(" ")[0]))];
    assert.deepEqual(days.map((day) => day.replace(/[.,]/g, "")), ["Mon", "Tue", "Wed"]);
    assert.deepEqual(
      slots.slice(0, 4).map((slot) => local(slot.startTime, TORONTO).split(" ").pop()),
      ["09:00", "10:30", "13:00", "15:30"]
    );
    for (const slot of slots) assert.equal(slot.timezone, TORONTO);
  });

  it("durations are respected", () => {
    for (const minutes of [15, 30, 45, 60]) {
      for (const slot of previewSlots(new Date("2026-11-24T15:00:00Z"), TORONTO, minutes)) {
        assert.equal(Date.parse(slot.endTime) - Date.parse(slot.startTime), minutes * 60_000);
      }
    }
  });

  it("local times stay the same across a daylight saving change", () => {
    // Thursday 2026-03-05 in Toronto: the next weekdays run across the 8 March change.
    const slots = previewSlots(new Date("2026-03-05T20:00:00Z"), TORONTO, 30);
    assert.equal(slots.length, 12);
    const times = slots.map((slot) => local(slot.startTime, TORONTO).split(" ").pop());
    assert.deepEqual(times, Array.from({ length: 3 }, () => ["09:00", "10:30", "13:00", "15:30"]).flat());
    const days = [...new Set(slots.map((slot) => local(slot.startTime, TORONTO).split(" ")[0].replace(/[.,]/g, "")))];
    assert.deepEqual(days, ["Fri", "Mon", "Tue"]);
    // Friday is before the change (UTC-5), Monday after it (UTC-4).
    assert.equal(slots[0].startTime, "2026-03-06T14:00:00.000Z");
    assert.equal(slots[4].startTime, "2026-03-09T13:00:00.000Z");
  });

  it("an invalid time zone falls back to UTC", () => {
    const slots = previewSlots(new Date("2026-11-24T15:00:00Z"), "Not/AZone", 30);
    assert.equal(slots.length, 12);
    assert.equal(slots[0].timezone, "UTC");
    assert.equal(slots[0].startTime, "2026-11-25T09:00:00.000Z");
  });
});

describe("isPreviewThemeMessage", () => {
  const theme = { primary_color: "#173f2d", accent_color: "#4F9A78", button_color: "#000000", border_radius: 8 };

  it("accepts a valid message", () => {
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme }), true);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, border_radius: 0 } }), true);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, border_radius: 32 } }), true);
  });

  it("rejects the wrong type, bad hex, radius 33, extra keys and nesting", () => {
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_READY_MESSAGE, theme }), false);
    assert.equal(isPreviewThemeMessage({ type: "formbook:meta-event", theme }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, accent_color: "#12345" } }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, button_color: "red" } }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, border_radius: 33 } }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, border_radius: 4.5 } }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, border_radius: "8" } }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { ...theme, logo_url: "https://example.com/x.png" } }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme, extra: true }), false);
    assert.equal(isPreviewThemeMessage({ type: PREVIEW_THEME_MESSAGE, theme: { theme } }), false);
    assert.equal(isPreviewThemeMessage({ data: { type: PREVIEW_THEME_MESSAGE, theme } }), false);
    assert.equal(isPreviewThemeMessage([PREVIEW_THEME_MESSAGE, theme]), false);
    assert.equal(isPreviewThemeMessage(null), false);
    assert.equal(isPreviewThemeMessage("formbook:preview-theme"), false);
  });

  it("builds a theme from input values only when every value is valid", () => {
    assert.deepEqual(
      previewThemeFromValues({ primary_color: "#173f2d", accent_color: "#4f9a78", button_color: "#173f2d", border_radius: "12" }),
      { primary_color: "#173f2d", accent_color: "#4f9a78", button_color: "#173f2d", border_radius: 12 }
    );
    assert.equal(previewThemeFromValues({ primary_color: "#173f2d", accent_color: "#4f9a78", button_color: "#173f2d", border_radius: "" }), null);
    assert.equal(previewThemeFromValues({ primary_color: "#173f2d", accent_color: "#4f9a78", button_color: "#173f2d", border_radius: "40" }), null);
    assert.equal(previewThemeFromValues({ primary_color: null, accent_color: "#4f9a78", button_color: "#173f2d", border_radius: "8" }), null);
  });
});

describe("onboarding copy", () => {
  it("has no em dash in CHECKLIST_COPY, SETUP_CALL_COPY or PREVIEW_COPY", () => {
    const strings = allStrings([CHECKLIST_COPY, SETUP_CALL_COPY, PREVIEW_COPY]);
    assert.ok(strings.length > 30);
    for (const value of strings) assert.ok(!value.includes(EM_DASH), value);
  });

  it("new message and storage names are the agreed ones", () => {
    assert.equal(PREVIEW_THEME_MESSAGE, "formbook:preview-theme");
    assert.equal(PREVIEW_READY_MESSAGE, "formbook:preview-ready");
  });
});
