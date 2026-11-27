import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  OPTION_NOT_FOUND_MESSAGE,
  QUESTION_NOT_FOUND_MESSAGE,
  assertOptionInFunnel,
  assertQuestionInFunnel,
  questionUpdateFields
} from "@/lib/funnels/question-scope";

const ownQuestions = [
  { id: "q-own-1", options: [{ id: "o-own-1" }, { id: "o-own-2" }] },
  { id: "q-own-2", options: [] }
];

describe("assertQuestionInFunnel", () => {
  it("accepts a question from the caller's form", () => {
    assert.doesNotThrow(() => assertQuestionInFunnel(ownQuestions, "q-own-2"));
  });

  it("rejects another tenant's question id copied from a public page", () => {
    assert.throws(() => assertQuestionInFunnel(ownQuestions, "q-victim"), { message: QUESTION_NOT_FOUND_MESSAGE });
  });

  it("rejects an empty id", () => {
    assert.throws(() => assertQuestionInFunnel(ownQuestions, ""), { message: QUESTION_NOT_FOUND_MESSAGE });
  });
});

describe("assertOptionInFunnel", () => {
  it("accepts an option of one of the form's questions", () => {
    assert.doesNotThrow(() => assertOptionInFunnel(ownQuestions, "q-own-1", "o-own-2"));
  });

  it("rejects an option from another question or tenant", () => {
    assert.throws(() => assertOptionInFunnel(ownQuestions, "q-own-2", "o-own-1"), { message: OPTION_NOT_FOUND_MESSAGE });
    assert.throws(() => assertOptionInFunnel(ownQuestions, "q-own-1", "o-victim"), { message: OPTION_NOT_FOUND_MESSAGE });
  });

  it("rejects a question that is not in the form", () => {
    assert.throws(() => assertOptionInFunnel(ownQuestions, "q-victim", "o-victim"), {
      message: QUESTION_NOT_FOUND_MESSAGE
    });
  });
});

describe("questionUpdateFields", () => {
  it("never lets an update change the id, form or tenant", () => {
    const fields = questionUpdateFields({
      id: "q-victim",
      funnel_id: "attacker-funnel",
      tenant_id: "attacker-tenant",
      label: "New label",
      display_order: 3
    });
    assert.deepEqual(fields, { label: "New label", display_order: 3 });
  });
});
