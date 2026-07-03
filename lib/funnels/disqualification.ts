import type { Json, QuestionType } from "@/lib/types/database";

export const stringDisqualificationOperators = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "contains", label: "Contains" },
  { value: "not_contains", label: "Does not contain" },
  { value: "starts_with", label: "Starts with" },
  { value: "ends_with", label: "Ends with" },
  { value: "is_answered", label: "Has any answer" }
] as const;

export const numberDisqualificationOperators = [
  { value: "equals", label: "Equals" },
  { value: "not_equals", label: "Does not equal" },
  { value: "less_than", label: "Is less than" },
  { value: "less_than_or_equal", label: "Is less than or equal to" },
  { value: "greater_than", label: "Is greater than" },
  { value: "greater_than_or_equal", label: "Is greater than or equal to" },
  { value: "is_answered", label: "Has any answer" }
] as const;

export type QuestionDisqualificationOperator =
  | (typeof stringDisqualificationOperators)[number]["value"]
  | (typeof numberDisqualificationOperators)[number]["value"];

export interface QuestionDisqualificationRule {
  enabled: boolean;
  operator: QuestionDisqualificationOperator;
  value: string;
}

const supportedQuestionTypes = new Set<QuestionType>(["email", "phone", "url", "number"]);
const stringOperatorValues = new Set<string>(stringDisqualificationOperators.map((operator) => operator.value));
const numberOperatorValues = new Set<string>(numberDisqualificationOperators.map((operator) => operator.value));

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function supportsQuestionDisqualificationRule(questionType: QuestionType) {
  return supportedQuestionTypes.has(questionType);
}

export function resolveQuestionDisqualificationRule(
  validation: Json | undefined,
  questionType: QuestionType
): QuestionDisqualificationRule {
  const defaultOperator: QuestionDisqualificationOperator = questionType === "number" ? "less_than" : "equals";
  const rawRule = isJsonObject(validation) && isJsonObject(validation.disqualification)
    ? validation.disqualification
    : {};
  const operator = typeof rawRule.operator === "string" ? rawRule.operator : defaultOperator;
  const allowedOperators = questionType === "number" ? numberOperatorValues : stringOperatorValues;

  return {
    enabled: supportsQuestionDisqualificationRule(questionType) && rawRule.enabled === true,
    operator: allowedOperators.has(operator)
      ? (operator as QuestionDisqualificationOperator)
      : defaultOperator,
    value: typeof rawRule.value === "string" ? rawRule.value : ""
  };
}

export function mergeQuestionDisqualificationRule(
  validation: Json | undefined,
  questionType: QuestionType,
  rule: QuestionDisqualificationRule
): Json {
  const base = isJsonObject(validation) ? validation : {};
  const { disqualification, ...rest } = base;
  void disqualification;

  if (!supportsQuestionDisqualificationRule(questionType) || !rule.enabled) {
    return rest;
  }

  return {
    ...rest,
    disqualification: {
      enabled: true,
      operator: rule.operator,
      value: rule.value.trim()
    }
  };
}

export function validateQuestionDisqualificationRule(
  questionType: QuestionType,
  rule: QuestionDisqualificationRule
) {
  if (!rule.enabled || !supportsQuestionDisqualificationRule(questionType)) return;
  if (rule.operator === "is_answered") return;

  if (!rule.value.trim()) {
    throw new Error("Enter the answer value that should disqualify this lead.");
  }

  if (questionType === "number" && !Number.isFinite(Number(rule.value))) {
    throw new Error("Enter a valid number for the disqualification rule.");
  }
}

export function answerMatchesQuestionDisqualificationRule(
  questionType: QuestionType,
  validation: Json | undefined,
  answer: string | number | string[] | null | undefined
) {
  const rule = resolveQuestionDisqualificationRule(validation, questionType);
  if (!rule.enabled || Array.isArray(answer) || answer === null || answer === undefined) return false;

  const answerText = String(answer).trim();
  if (!answerText) return false;
  if (rule.operator === "is_answered") return true;

  if (questionType === "number") {
    const answerNumber = Number(answer);
    const ruleNumber = Number(rule.value);
    if (!Number.isFinite(answerNumber) || !Number.isFinite(ruleNumber)) return false;

    switch (rule.operator) {
      case "equals":
        return answerNumber === ruleNumber;
      case "not_equals":
        return answerNumber !== ruleNumber;
      case "less_than":
        return answerNumber < ruleNumber;
      case "less_than_or_equal":
        return answerNumber <= ruleNumber;
      case "greater_than":
        return answerNumber > ruleNumber;
      case "greater_than_or_equal":
        return answerNumber >= ruleNumber;
      default:
        return false;
    }
  }

  const normalizedAnswer = answerText.toLowerCase();
  const normalizedRuleValue = rule.value.trim().toLowerCase();

  switch (rule.operator) {
    case "equals":
      return normalizedAnswer === normalizedRuleValue;
    case "not_equals":
      return normalizedAnswer !== normalizedRuleValue;
    case "contains":
      return normalizedAnswer.includes(normalizedRuleValue);
    case "not_contains":
      return !normalizedAnswer.includes(normalizedRuleValue);
    case "starts_with":
      return normalizedAnswer.startsWith(normalizedRuleValue);
    case "ends_with":
      return normalizedAnswer.endsWith(normalizedRuleValue);
    default:
      return false;
  }
}
