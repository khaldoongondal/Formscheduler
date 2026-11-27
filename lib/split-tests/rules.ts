/**
 * Split test input rules, error mapping and copy. Pure: no Next.js or
 * Supabase imports.
 */
import { z } from "zod";
import type { SplitTestStatus } from "@/lib/split-tests/assignment";

export const SPLIT_TEST_MESSAGES = {
  needs_two_forms: "Add at least 2 forms before you start the test.",
  too_many_forms: "A split test can have at most 3 forms.",
  form_not_active: "Every form in the test must be active before you start it.",
  form_in_running_test:
    "One of these forms is already in a running test. A form can be in only one running test at a time.",
  locked:
    "This test has started, so its forms and address cannot change. End it and create a new test to try different forms.",
  bad_transition: "That change is not possible for a test in this state.",
  winner_not_member: "The winner must be one of the forms in this test.",
  wrong_tenant: "Choose forms from your own account.",
  test_missing: "Choose forms from your own account.",
  slug_in_use: "That test address is already in use. Please choose another.",
  delete_running: "End the test before you delete it.",
  not_found: "Not found.",
  duplicate_forms: "Choose a different form for each slot."
} as const satisfies Record<string, string>;

export const SPLIT_TEST_NAME_REQUIRED = "Give the test a name.";
export const SPLIT_TEST_NAME_TOO_LONG = "Keep the name under 120 characters.";

const optionalFormId = z
  .union([z.string().guid("Choose form C or leave it empty."), z.literal("")])
  .optional();

export const splitTestFormSchema = z
  .object({
    name: z.string().trim().min(1, SPLIT_TEST_NAME_REQUIRED).max(120, SPLIT_TEST_NAME_TOO_LONG),
    slug: z.string().trim().toLowerCase(),
    form_a: z.string().guid("Choose form A."),
    form_b: z.string().guid("Choose form B."),
    form_c: optionalFormId
  })
  .refine(
    (value) => {
      const ids = [value.form_a, value.form_b, value.form_c].filter(Boolean);
      return new Set(ids).size === ids.length;
    },
    { message: SPLIT_TEST_MESSAGES.duplicate_forms, path: ["form_b"] }
  );

export type SplitTestFormInput = z.infer<typeof splitTestFormSchema>;

export const splitTestNameSchema = z
  .string()
  .trim()
  .min(1, SPLIT_TEST_NAME_REQUIRED)
  .max(120, SPLIT_TEST_NAME_TOO_LONG);

/** Form ids in slot order (A, B, then C when chosen). */
export function splitTestFormIds(input: SplitTestFormInput): string[] {
  return [input.form_a, input.form_b, input.form_c].filter((id): id is string => Boolean(id));
}

const SPLIT_ERROR_PATTERN = /FORMBOOK_SPLIT:([a-z_]+)/;

/** Maps the migration 0025 trigger errors and the slug unique index to user copy. */
export function splitTestMessageFromError(message: string): string | null {
  const match = SPLIT_ERROR_PATTERN.exec(message);
  if (match) {
    const key = match[1] as keyof typeof SPLIT_TEST_MESSAGES;
    return Object.prototype.hasOwnProperty.call(SPLIT_TEST_MESSAGES, key) ? SPLIT_TEST_MESSAGES[key] : null;
  }
  if (message.includes("split_tests_slug_unique_idx")) {
    return SPLIT_TEST_MESSAGES.slug_in_use;
  }
  return null;
}

/** The form_not_active message plus the names of the forms to activate. */
export function formNotActiveMessage(inactiveNames: string[]): string {
  if (!inactiveNames.length) return SPLIT_TEST_MESSAGES.form_not_active;
  return `${SPLIT_TEST_MESSAGES.form_not_active} Activate ${joinNames(inactiveNames)} first.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function splitTestStatusLabel(status: SplitTestStatus): "Draft" | "Running" | "Ended" {
  if (status === "running") return "Running";
  if (status === "ended") return "Ended";
  return "Draft";
}

export function parseSplitTestStatus(value: unknown): SplitTestStatus {
  return value === "running" || value === "ended" ? value : "draft";
}

export const SPLIT_TEST_SAVED_MESSAGES: Record<string, string> = {
  created: "Split test created.",
  saved: "Changes saved.",
  started: "Test started. Share the test link now.",
  ended: "Test ended.",
  winner: "Winner saved.",
  spend: "Ad spend saved.",
  "spend-cleared": "Ad spend cleared."
};

export const SPLIT_TEST_COPY = {
  listHeading: "Split tests",
  listSubheading:
    "Send one link to 2 or 3 forms. Each visitor gets one form at random, with equal chances, and keeps seeing the same form when they come back.",
  empty: "No split tests yet. Create one below.",
  createTitle: "New split test",
  slugHelper: "3 to 80 lowercase letters, numbers and single hyphens.",
  limitNote:
    "Forms in a test still count toward your active form limit. You can start the test once every form in it is active.",
  linkNote: "Share only these links while the test runs. Each form's own link is not part of the split.",
  draftLinkNote: "The link starts working when you start the test.",
  startConfirm:
    "Starting locks the forms and the address of this test. Visitors to the test link are split evenly between the forms.",
  endHelper: "After the test ends, visits are no longer counted in these results.",
  deleteConfirm: "This deletes the test and its link. Visits and leads stay on each form's own page.",
  noActiveMember: 'No form in this test is active, so the test link shows a "not found" page.',
  editorEmbedNote: "To split traffic automatically between 2 or 3 forms, create a split test."
} as const;

export function unavailableMemberWarning(formName: string): string {
  return `${formName} is not active, so all traffic goes to the other forms in this test.`;
}

export function runningTestEditorNote(testName: string): string {
  return `This form is in the running split test ${testName}. Switching it to draft sends all test traffic to the other forms.`;
}

/** A split test that uses a form, as the delete check sees it. */
export type FunnelTestUse = { name: string; status: SplitTestStatus };

/** The reason a form cannot be deleted, or null. Only a running test blocks it. */
export function funnelDeleteBlocker(tests: readonly FunnelTestUse[]): string | null {
  const running = tests.find((test) => test.status === "running");
  if (!running) return null;
  return `This form is in the running split test "${running.name}". End the test before you delete it.`;
}

/** Extra text for the delete confirmation when draft or ended tests use the form. */
export function funnelDeleteTestNote(tests: readonly FunnelTestUse[]): string {
  const others = tests.filter((test) => test.status !== "running");
  if (!others.length) return "";
  const names = others.map((test) => `"${test.name}"`).join(", ");
  return others.length === 1
    ? ` The split test ${names} will lose this form and its results for it.`
    : ` The split tests ${names} will lose this form and their results for it.`;
}
