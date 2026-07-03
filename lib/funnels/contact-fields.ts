import type { Json } from "@/lib/types/database";

export const contactFieldKeys = ["full_name", "phone", "first_name", "last_name", "email"] as const;

export type ContactFieldKey = (typeof contactFieldKeys)[number];

export type ContactFieldSettings = Record<ContactFieldKey, boolean>;

export interface ContactFieldConfig {
  settings: ContactFieldSettings;
  order: ContactFieldKey[];
  fieldsPerPage: number;
}

export const contactFieldOptions: Array<{ key: ContactFieldKey; label: string; description: string }> = [
  {
    key: "full_name",
    label: "Name",
    description: "One lower-friction name field. Leadder splits it into first and last name for GHL."
  },
  { key: "phone", label: "Phone Number", description: "Recommended for call booking and SMS follow-up." },
  { key: "first_name", label: "First Name", description: "Used to personalize the lead and GHL contact." },
  { key: "last_name", label: "Last Name", description: "Useful when matching existing contacts." },
  { key: "email", label: "Email", description: "Useful for email follow-up and contact matching." }
];

export const defaultContactFieldSettings: ContactFieldSettings = {
  full_name: true,
  phone: true,
  first_name: false,
  last_name: false,
  email: false
};

export const defaultContactFieldOrder: ContactFieldKey[] = ["full_name", "phone", "first_name", "last_name", "email"];
export const defaultContactFieldsPerPage = 4;

export type IntakeFlowItem =
  | { type: "contact"; key: ContactFieldKey }
  | { type: "question"; id: string };

function isJsonObject(value: Json | undefined): value is { [key: string]: Json | undefined } {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isContactFieldKey(value: unknown): value is ContactFieldKey {
  return typeof value === "string" && contactFieldKeys.includes(value as ContactFieldKey);
}

export function normalizeContactFieldOrder(order: unknown): ContactFieldKey[] {
  const orderedKeys = Array.isArray(order) ? order.filter(isContactFieldKey) : [];
  const uniqueOrderedKeys = orderedKeys.filter((key, index) => orderedKeys.indexOf(key) === index);
  const missingKeys = defaultContactFieldOrder.filter((key) => !uniqueOrderedKeys.includes(key));
  return [...uniqueOrderedKeys, ...missingKeys];
}

export function normalizeContactFieldsPerPage(value: unknown) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return defaultContactFieldsPerPage;
  return Math.min(Math.max(Math.trunc(numericValue), 1), contactFieldKeys.length);
}

export function normalizeDisabledQuestionIds(value: unknown, questionIds: string[] = []) {
  const disabledIds = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  const validDisabledIds = questionIds.length
    ? disabledIds.filter((id) => questionIds.includes(id))
    : disabledIds.filter((id) => /^[0-9a-fA-F-]{36}$/.test(id));
  return validDisabledIds.filter((id, index) => validDisabledIds.indexOf(id) === index);
}

export function intakeFlowItemToKey(item: IntakeFlowItem) {
  return item.type === "contact" ? `contact:${item.key}` : `question:${item.id}`;
}

function parseIntakeFlowItem(value: unknown, questionIds: string[]): IntakeFlowItem | null {
  if (typeof value !== "string") return null;

  if (value.startsWith("contact:")) {
    const fieldKey = value.slice("contact:".length);
    return isContactFieldKey(fieldKey) ? { type: "contact", key: fieldKey } : null;
  }

  if (value.startsWith("question:")) {
    const questionId = value.slice("question:".length);
    return questionIds.includes(questionId) ? { type: "question", id: questionId } : null;
  }

  return null;
}

export function normalizeIntakeFlowOrder(
  order: unknown,
  questionIds: string[],
  contactFieldOrder: ContactFieldKey[] = defaultContactFieldOrder
): IntakeFlowItem[] {
  const parsedItems = Array.isArray(order)
    ? order
        .map((item) => parseIntakeFlowItem(item, questionIds))
        .filter((item): item is IntakeFlowItem => Boolean(item))
    : [];
  const uniqueItems = parsedItems.filter((item, index) => {
    const key = intakeFlowItemToKey(item);
    return parsedItems.findIndex((candidate) => intakeFlowItemToKey(candidate) === key) === index;
  });
  const defaultItems: IntakeFlowItem[] = [
    ...contactFieldOrder.map((key) => ({ type: "contact" as const, key })),
    ...questionIds.map((id) => ({ type: "question" as const, id }))
  ];
  const missingItems = defaultItems.filter((item) => {
    const key = intakeFlowItemToKey(item);
    return !uniqueItems.some((candidate) => intakeFlowItemToKey(candidate) === key);
  });

  return [...uniqueItems, ...missingItems];
}

export function resolveDisabledQuestionIds(rule: Json | undefined, questionIds: string[] = []) {
  if (!isJsonObject(rule)) {
    return [];
  }

  return normalizeDisabledQuestionIds(rule.disabled_question_ids, questionIds);
}

export function resolveActiveQuestionIds(rule: Json | undefined, questionIds: string[]) {
  const disabledQuestionIds = resolveDisabledQuestionIds(rule, questionIds);
  return questionIds.filter((questionId) => !disabledQuestionIds.includes(questionId));
}

export function resolveIntakeFlowEditorOrder(rule: Json | undefined, questionIds: string[]): IntakeFlowItem[] {
  const contactFieldOrder = resolveContactFieldOrder(rule);
  if (!isJsonObject(rule)) {
    return normalizeIntakeFlowOrder(undefined, questionIds, contactFieldOrder);
  }

  return normalizeIntakeFlowOrder(rule.intake_flow_order, questionIds, contactFieldOrder);
}

export function resolveIntakeFlowOrder(rule: Json | undefined, questionIds: string[]): IntakeFlowItem[] {
  const activeQuestionIds = resolveActiveQuestionIds(rule, questionIds);
  const contactFieldOrder = resolveContactFieldOrder(rule);
  if (!isJsonObject(rule)) {
    return normalizeIntakeFlowOrder(undefined, activeQuestionIds, contactFieldOrder);
  }

  return normalizeIntakeFlowOrder(rule.intake_flow_order, activeQuestionIds, contactFieldOrder);
}

export function resolveContactFieldSettings(rule: Json | undefined): ContactFieldSettings {
  if (!isJsonObject(rule) || !isJsonObject(rule.contact_fields)) {
    return defaultContactFieldSettings;
  }

  return {
    full_name:
      typeof rule.contact_fields.full_name === "boolean"
        ? rule.contact_fields.full_name
        : false,
    phone: typeof rule.contact_fields.phone === "boolean" ? rule.contact_fields.phone : defaultContactFieldSettings.phone,
    first_name:
      typeof rule.contact_fields.first_name === "boolean"
        ? rule.contact_fields.first_name
        : defaultContactFieldSettings.first_name,
    last_name:
      typeof rule.contact_fields.last_name === "boolean"
        ? rule.contact_fields.last_name
        : defaultContactFieldSettings.last_name,
    email: typeof rule.contact_fields.email === "boolean" ? rule.contact_fields.email : defaultContactFieldSettings.email
  };
}

export function resolveContactFieldOrder(rule: Json | undefined): ContactFieldKey[] {
  if (!isJsonObject(rule)) {
    return defaultContactFieldOrder;
  }

  return normalizeContactFieldOrder(rule.contact_field_order);
}

export function resolveContactFieldsPerPage(rule: Json | undefined) {
  if (!isJsonObject(rule)) {
    return defaultContactFieldsPerPage;
  }

  return normalizeContactFieldsPerPage(rule.contact_fields_per_page);
}

export function resolveContactFieldConfig(rule: Json | undefined): ContactFieldConfig {
  return {
    settings: resolveContactFieldSettings(rule),
    order: resolveContactFieldOrder(rule),
    fieldsPerPage: resolveContactFieldsPerPage(rule)
  };
}

export function mergeContactFieldSettings(
  rule: Json | undefined,
  contactFields: ContactFieldSettings,
  contactFieldOrder?: ContactFieldKey[],
  contactFieldsPerPage?: number,
  intakeFlowOrder?: string[],
  disabledQuestionIds?: string[]
): Json {
  const base = isJsonObject(rule) ? rule : { mode: "all_required_answered" };
  const nextContactFieldOrder = normalizeContactFieldOrder(contactFieldOrder ?? base.contact_field_order);
  return {
    ...base,
    contact_fields: contactFields,
    contact_field_order: nextContactFieldOrder,
    contact_fields_per_page: normalizeContactFieldsPerPage(contactFieldsPerPage ?? base.contact_fields_per_page),
    ...(intakeFlowOrder ? { intake_flow_order: intakeFlowOrder } : {}),
    ...(disabledQuestionIds ? { disabled_question_ids: normalizeDisabledQuestionIds(disabledQuestionIds) } : {})
  };
}
