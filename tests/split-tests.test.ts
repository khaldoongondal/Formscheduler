import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SPLIT_ARM_LABELS,
  assignmentBucket,
  chooseArm,
  fallbackVisitorKey,
  isValidVisitorKey,
  type ArmCandidate
} from "@/lib/split-tests/assignment";
import {
  SPLIT_TEST_COPY,
  SPLIT_TEST_MESSAGES,
  SPLIT_TEST_SAVED_MESSAGES,
  formNotActiveMessage,
  runningTestEditorNote,
  splitTestFormSchema,
  splitTestMessageFromError,
  splitTestStatusLabel,
  unavailableMemberWarning
} from "@/lib/split-tests/rules";
import { analyticsEventSchema } from "@/lib/validation/analytics";
import { startLeadSessionSchema } from "@/lib/validation/lead-sessions";

const EM_DASH = String.fromCharCode(0x2014);
const TEST_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_TEST_ID = "22222222-2222-4222-8222-222222222222";
const FORM_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FORM_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FORM_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function visitorKey(index: number) {
  return `visitor-${index}-xxxxxxxx`;
}

function members(available: { a?: boolean; b?: boolean; c?: boolean } = {}, count = 3): ArmCandidate[] {
  return [
    { funnelId: FORM_A, position: 1, available: available.a ?? true },
    { funnelId: FORM_B, position: 2, available: available.b ?? true },
    { funnelId: FORM_C, position: 3, available: available.c ?? true }
  ].slice(0, count);
}

describe("assignmentBucket", () => {
  it("is deterministic", () => {
    for (let i = 0; i < 50; i += 1) {
      assert.equal(assignmentBucket(TEST_ID, visitorKey(i), 3), assignmentBucket(TEST_ID, visitorKey(i), 3));
    }
  });

  it("differs across test ids for some visitors", () => {
    let differences = 0;
    for (let i = 0; i < 200; i += 1) {
      if (assignmentBucket(TEST_ID, visitorKey(i), 2) !== assignmentBucket(OTHER_TEST_ID, visitorKey(i), 2)) {
        differences += 1;
      }
    }
    assert.ok(differences > 50, `expected many differences, got ${differences}`);
  });

  it("throws for 0 and 4 arms", () => {
    assert.throws(() => assignmentBucket(TEST_ID, visitorKey(1), 0));
    assert.throws(() => assignmentBucket(TEST_ID, visitorKey(1), 4));
  });

  it("always returns 0 for one arm", () => {
    assert.equal(assignmentBucket(TEST_ID, visitorKey(7), 1), 0);
  });
});

describe("assignment evenness", () => {
  const total = 30000;

  it("splits 2 arms evenly within 1.5 points", () => {
    const counts = [0, 0];
    for (let i = 0; i < total; i += 1) counts[assignmentBucket(TEST_ID, visitorKey(i), 2)] += 1;
    for (const count of counts) {
      assert.ok(Math.abs(count / total - 0.5) <= 0.015, `share ${count / total}`);
    }
  });

  it("splits 3 arms evenly within 1.5 points", () => {
    const counts = [0, 0, 0];
    for (let i = 0; i < total; i += 1) counts[assignmentBucket(TEST_ID, visitorKey(i), 3)] += 1;
    for (const count of counts) {
      assert.ok(Math.abs(count / total - 1 / 3) <= 0.015, `share ${count / total}`);
    }
  });

  it("splits evenly through chooseArm too", () => {
    const counts = new Map<string, number>();
    const test = { id: TEST_ID, status: "running" as const, winnerFunnelId: null };
    for (let i = 0; i < total; i += 1) {
      const choice = chooseArm(test, members(), visitorKey(i));
      assert.ok(choice);
      counts.set(choice.funnelId, (counts.get(choice.funnelId) ?? 0) + 1);
    }
    assert.equal(counts.size, 3);
    for (const count of counts.values()) {
      assert.ok(Math.abs(count / total - 1 / 3) <= 0.015, `share ${count / total}`);
    }
  });
});

describe("assignment stickiness", () => {
  const test = { id: TEST_ID, status: "running" as const, winnerFunnelId: null };

  it("returns the same arm 100 times for one key", () => {
    const first = chooseArm(test, members(), visitorKey(42));
    for (let i = 0; i < 100; i += 1) {
      assert.deepEqual(chooseArm(test, members(), visitorKey(42)), first);
    }
  });

  it("ignores member order in the input", () => {
    for (let i = 0; i < 200; i += 1) {
      assert.deepEqual(
        chooseArm(test, [...members()].reverse(), visitorKey(i)),
        chooseArm(test, members(), visitorKey(i))
      );
    }
  });

  it("keeps A and C visitors in place when B becomes unavailable", () => {
    const formerB = new Map<string, number>();
    for (let i = 0; i < 3000; i += 1) {
      const before = chooseArm(test, members(), visitorKey(i));
      const after = chooseArm(test, members({ b: false }), visitorKey(i));
      assert.ok(before && after);
      assert.notEqual(after.funnelId, FORM_B);
      if (before.funnelId === FORM_A || before.funnelId === FORM_C) {
        assert.equal(after.funnelId, before.funnelId);
      } else {
        formerB.set(after.funnelId, (formerB.get(after.funnelId) ?? 0) + 1);
      }
    }
    assert.ok((formerB.get(FORM_A) ?? 0) > 100, "former B visitors reach A");
    assert.ok((formerB.get(FORM_C) ?? 0) > 100, "former B visitors reach C");
  });
});

describe("chooseArm", () => {
  it("returns null for a draft", () => {
    assert.equal(chooseArm({ id: TEST_ID, status: "draft", winnerFunnelId: null }, members(), visitorKey(1)), null);
  });

  it("records the assignment while running", () => {
    const choice = chooseArm({ id: TEST_ID, status: "running", winnerFunnelId: null }, members(), visitorKey(1));
    assert.ok(choice);
    assert.equal(choice.recorded, true);
  });

  it("serves an available winner after the end without recording", () => {
    for (let i = 0; i < 50; i += 1) {
      assert.deepEqual(
        chooseArm({ id: TEST_ID, status: "ended", winnerFunnelId: FORM_B }, members(), visitorKey(i)),
        { funnelId: FORM_B, recorded: false }
      );
    }
  });

  it("keeps splitting when the winner is unavailable, without recording", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      const choice = chooseArm(
        { id: TEST_ID, status: "ended", winnerFunnelId: FORM_B },
        members({ b: false }),
        visitorKey(i)
      );
      assert.ok(choice);
      assert.equal(choice.recorded, false);
      seen.add(choice.funnelId);
    }
    assert.deepEqual([...seen].sort(), [FORM_A, FORM_C].sort());
  });

  it("keeps splitting after the end without a winner, without recording", () => {
    const running = { id: TEST_ID, status: "running" as const, winnerFunnelId: null };
    const ended = { id: TEST_ID, status: "ended" as const, winnerFunnelId: null };
    for (let i = 0; i < 100; i += 1) {
      const before = chooseArm(running, members(), visitorKey(i));
      const after = chooseArm(ended, members(), visitorKey(i));
      assert.ok(before && after);
      assert.equal(after.funnelId, before.funnelId);
      assert.equal(after.recorded, false);
    }
  });

  it("returns null when no member is available", () => {
    assert.equal(
      chooseArm(
        { id: TEST_ID, status: "running", winnerFunnelId: null },
        members({ a: false, b: false, c: false }),
        visitorKey(1)
      ),
      null
    );
    assert.equal(chooseArm({ id: TEST_ID, status: "running", winnerFunnelId: null }, [], visitorKey(1)), null);
  });

  it("works with two forms", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) {
      const choice = chooseArm({ id: TEST_ID, status: "running", winnerFunnelId: null }, members({}, 2), visitorKey(i));
      assert.ok(choice);
      seen.add(choice.funnelId);
    }
    assert.deepEqual([...seen].sort(), [FORM_A, FORM_B].sort());
  });

  it("labels arms A, B and C", () => {
    assert.deepEqual([...SPLIT_ARM_LABELS], ["A", "B", "C"]);
  });
});

describe("isValidVisitorKey", () => {
  it("accepts ids the booking flow makes", () => {
    assert.equal(isValidVisitorKey("3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b"), true);
    assert.equal(isValidVisitorKey("visitor_abc12345"), true);
  });

  it("rejects the blocked-storage marker, short and unsafe values", () => {
    assert.equal(isValidVisitorKey("none"), false);
    assert.equal(isValidVisitorKey("abcdefg"), false);
    assert.equal(isValidVisitorKey("<script>"), false);
    assert.equal(isValidVisitorKey("a".repeat(129)), false);
    assert.equal(isValidVisitorKey(undefined), false);
    assert.equal(isValidVisitorKey(12345678), false);
  });
});

describe("fallbackVisitorKey", () => {
  const ua = "Mozilla/5.0 (Example)";

  it("is deterministic and prefixed", () => {
    const key = fallbackVisitorKey("203.0.113.7", ua, "salt-one");
    assert.equal(key, fallbackVisitorKey("203.0.113.7", ua, "salt-one"));
    assert.ok(key.startsWith("ipua:"));
  });

  it("differs by salt and by user agent", () => {
    const key = fallbackVisitorKey("203.0.113.7", ua, "salt-one");
    assert.notEqual(key, fallbackVisitorKey("203.0.113.7", ua, "salt-two"));
    assert.notEqual(key, fallbackVisitorKey("203.0.113.7", "Mozilla/5.0 (Other)", "salt-one"));
    assert.notEqual(key, fallbackVisitorKey("203.0.113.8", ua, "salt-one"));
  });

  it("does not contain the raw IP", () => {
    assert.ok(!fallbackVisitorKey("203.0.113.7", ua, "salt-one").includes("203.0.113.7"));
  });
});

describe("splitTestFormSchema", () => {
  const base = { name: "Spring test", slug: "spring-test", form_a: FORM_A, form_b: FORM_B };

  it("accepts two forms with C optional", () => {
    assert.equal(splitTestFormSchema.safeParse(base).success, true);
    assert.equal(splitTestFormSchema.safeParse({ ...base, form_c: "" }).success, true);
    assert.equal(splitTestFormSchema.safeParse({ ...base, form_c: FORM_C }).success, true);
  });

  it("rejects duplicate forms with the exact message", () => {
    const result = splitTestFormSchema.safeParse({ ...base, form_b: FORM_A });
    assert.equal(result.success, false);
    if (!result.success) {
      assert.deepEqual(result.error.flatten().fieldErrors.form_b, ["Choose a different form for each slot."]);
    }
    const withC = splitTestFormSchema.safeParse({ ...base, form_c: FORM_B });
    assert.equal(withC.success, false);
  });

  it("requires a name and forms A and B", () => {
    const noName = splitTestFormSchema.safeParse({ ...base, name: "  " });
    assert.equal(noName.success, false);
    if (!noName.success) assert.deepEqual(noName.error.flatten().fieldErrors.name, ["Give the test a name."]);
    const noB = splitTestFormSchema.safeParse({ ...base, form_b: "" });
    assert.equal(noB.success, false);
    if (!noB.success) assert.deepEqual(noB.error.flatten().fieldErrors.form_b, ["Choose form B."]);
  });

  it("lowercases and trims the address", () => {
    const result = splitTestFormSchema.parse({ ...base, slug: "  Spring-Test " });
    assert.equal(result.slug, "spring-test");
  });
});

describe("splitTestMessageFromError", () => {
  const cases: Array<[string, string]> = [
    ["needs_two_forms", "Add at least 2 forms before you start the test."],
    ["too_many_forms", "A split test can have at most 3 forms."],
    ["form_not_active", "Every form in the test must be active before you start it."],
    [
      "form_in_running_test",
      "One of these forms is already in a running test. A form can be in only one running test at a time."
    ],
    [
      "locked",
      "This test has started, so its forms and address cannot change. End it and create a new test to try different forms."
    ],
    ["bad_transition", "That change is not possible for a test in this state."],
    ["winner_not_member", "The winner must be one of the forms in this test."],
    ["wrong_tenant", "Choose forms from your own account."],
    ["test_missing", "Choose forms from your own account."]
  ];

  for (const [code, message] of cases) {
    it(`maps ${code}`, () => {
      assert.equal(splitTestMessageFromError(`ERROR: P0001: FORMBOOK_SPLIT:${code}`), message);
    });
  }

  it("maps the slug unique index", () => {
    assert.equal(
      splitTestMessageFromError('duplicate key value violates unique constraint "split_tests_slug_unique_idx"'),
      "That test address is already in use. Please choose another."
    );
  });

  it("returns null for unrelated errors", () => {
    assert.equal(splitTestMessageFromError("connection reset"), null);
    assert.equal(splitTestMessageFromError("FORMBOOK_LIMIT:active_forms"), null);
    assert.equal(splitTestMessageFromError("FORMBOOK_SPLIT:unknown_code"), null);
  });

  it("appends inactive form names", () => {
    assert.equal(
      formNotActiveMessage(["Form A", "Form B"]),
      "Every form in the test must be active before you start it. Activate Form A and Form B first."
    );
    assert.equal(formNotActiveMessage([]), "Every form in the test must be active before you start it.");
  });

  it("has no em dash in any copy", () => {
    const all = [
      ...Object.values(SPLIT_TEST_MESSAGES),
      ...Object.values(SPLIT_TEST_SAVED_MESSAGES),
      ...Object.values(SPLIT_TEST_COPY),
      unavailableMemberWarning("Form A"),
      runningTestEditorNote("Test one"),
      formNotActiveMessage(["Form A", "Form B", "Form C"])
    ];
    for (const message of all) assert.ok(!message.includes(EM_DASH), message);
  });

  it("labels statuses", () => {
    assert.equal(splitTestStatusLabel("draft"), "Draft");
    assert.equal(splitTestStatusLabel("running"), "Running");
    assert.equal(splitTestStatusLabel("ended"), "Ended");
  });
});

describe("split test fields on public payloads", () => {
  it("accepts form_start and a test id on analytics events", () => {
    const result = analyticsEventSchema.safeParse({
      funnel_id: FORM_A,
      event_type: "form_start",
      test_id: TEST_ID,
      metadata: { page_load_id: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b" }
    });
    assert.equal(result.success, true);
  });

  it("rejects a test id that is not a uuid", () => {
    assert.equal(
      analyticsEventSchema.safeParse({ funnel_id: FORM_A, event_type: "page_view", test_id: "ghl-control" }).success,
      false
    );
  });

  it("accepts a test id on lead sessions and keeps the manual tag", () => {
    const result = startLeadSessionSchema.safeParse({
      funnel_id: FORM_A,
      email: "lead@example.com",
      test_id: TEST_ID,
      split_test_id: "ghl-growth-call",
      split_variant: "control"
    });
    assert.equal(result.success, true);
  });
});
