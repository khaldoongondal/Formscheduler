/**
 * The insert payload for a duplicated form. Pure: no Next.js or Supabase imports.
 *
 * Never copied (decision D6): the id, timestamps, the active state and the
 * takedown columns. Never copied (Sprint 2): the Meta pixel and the
 * customer's consent confirmation, which they must give for each form, the
 * consent checkbox switch, and the demo batch mark (deleting a demo batch must
 * not delete a customer's copy).
 */

export const FUNNEL_COPY_RESETS = {
  meta_pixel_id: null,
  meta_consent_confirmed_at: null,
  meta_consent_confirmed_by: null,
  meta_consent_checkbox_enabled: false,
  demo_seed_batch: null
} as const;

type CopySource = { name: string };

export function funnelCopyPayload<T extends CopySource>(
  source: T,
  slug: string
): Omit<T, "id" | "created_at" | "updated_at" | "taken_down_at" | "taken_down_reason" | "questions"> &
  typeof FUNNEL_COPY_RESETS & { name: string; slug: string; is_published: false } {
  const {
    id: _id,
    created_at: _createdAt,
    updated_at: _updatedAt,
    is_published: _isPublished,
    taken_down_at: _takenDownAt,
    taken_down_reason: _takenDownReason,
    questions: _questions,
    ...rest
  } = source as T & Record<string, unknown>;
  void [_id, _createdAt, _updatedAt, _isPublished, _takenDownAt, _takenDownReason, _questions];
  return {
    ...(rest as Omit<T, "id" | "created_at" | "updated_at" | "taken_down_at" | "taken_down_reason" | "questions">),
    ...FUNNEL_COPY_RESETS,
    name: `${source.name} Copy`,
    slug,
    is_published: false
  };
}
