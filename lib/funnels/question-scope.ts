/**
 * Ownership checks for question and option writes. Pure module (no Next.js or
 * Supabase imports), so node:test can load it.
 *
 * Question and option ids are visible on public booking pages, so every admin
 * write must prove the posted id belongs to the caller's verified form.
 */

export const QUESTION_NOT_FOUND_MESSAGE = "Question not found.";
export const OPTION_NOT_FOUND_MESSAGE = "Option not found.";

type ScopedQuestion = { id: string; options?: Array<{ id: string }> };

/** Throws unless `questionId` is one of the form's questions. */
export function assertQuestionInFunnel(questions: ScopedQuestion[], questionId: string): void {
  if (!questionId || !questions.some((question) => question.id === questionId)) {
    throw new Error(QUESTION_NOT_FOUND_MESSAGE);
  }
}

/** Throws unless `optionId` belongs to `questionId`, which belongs to the form. */
export function assertOptionInFunnel(questions: ScopedQuestion[], questionId: string, optionId: string): void {
  const question = questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(QUESTION_NOT_FOUND_MESSAGE);
  if (!optionId || !(question.options ?? []).some((option) => option.id === optionId)) {
    throw new Error(OPTION_NOT_FOUND_MESSAGE);
  }
}

/**
 * The fields a question update may change. The id, form and tenant are never
 * taken from the posted payload, so an update cannot move a question to
 * another form or tenant.
 */
export function questionUpdateFields<T extends Record<string, unknown>>(
  payload: T
): Omit<T, "id" | "funnel_id" | "tenant_id"> {
  const { id: _id, funnel_id: _funnelId, tenant_id: _tenantId, ...rest } = payload;
  void _id;
  void _funnelId;
  void _tenantId;
  return rest;
}
