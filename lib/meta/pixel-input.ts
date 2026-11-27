/**
 * Input rules for Meta pixels and the per-form Meta settings.
 * Pure: no Next.js or Supabase imports.
 */

import { z } from "zod";

export const PIXEL_MESSAGES = {
  name: "Give the pixel a name.",
  datasetId: "Enter the pixel or dataset ID as digits only.",
  token: "Paste the full access token from Events Manager.",
  testEventCode: "Use letters, numbers, hyphens or underscores for the test event code.",
  checkboxLabel: "Keep the checkbox text under 300 characters.",
  duplicate: "This pixel is already saved in your account.",
  notFound: "Not found.",
  needConsent: "Confirm that you have consent before attaching a pixel.",
  foreignPixel: "Choose a pixel from your own account.",
  removePixelFirst: "Remove the pixel before you withdraw the consent confirmation."
} as const;

export const DEFAULT_CONSENT_LABEL =
  "I agree to my details being shared with Meta (Facebook) to measure and improve ads.";

/** The Meta columns the public form load reads along with the form itself. */
export type FunnelConsentCheckboxFields = {
  meta_pixel_id?: string | null;
  meta_consent_confirmed_at?: string | null;
  meta_consent_checkbox_enabled?: boolean | null;
  meta_consent_checkbox_label?: string | null;
};

/**
 * Text of the Meta consent checkbox on a public form (decision M11 / P3.6).
 * Null (no checkbox) unless the form has a pixel, the consent confirmation and
 * the checkbox switched on. Columns missing before migration 0027 mean null.
 */
export function consentCheckboxLabelFor(row: FunnelConsentCheckboxFields | null | undefined): string | null {
  if (!row?.meta_pixel_id || !row.meta_consent_confirmed_at || row.meta_consent_checkbox_enabled !== true) return null;
  return row.meta_consent_checkbox_label?.trim() || DEFAULT_CONSENT_LABEL;
}

const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9._|-]{20,1024}$/;
const TEST_EVENT_CODE_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;

const nameSchema = z.string().trim().min(1, PIXEL_MESSAGES.name).max(80, PIXEL_MESSAGES.name);
const datasetIdSchema = z.string().trim().regex(/^[0-9]{5,20}$/, PIXEL_MESSAGES.datasetId);
const tokenSchema = z.string().trim().regex(ACCESS_TOKEN_PATTERN, PIXEL_MESSAGES.token);
const testEventCodeSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || TEST_EVENT_CODE_PATTERN.test(value), PIXEL_MESSAGES.testEventCode)
  .optional()
  .transform((value) => (value ? value : null));

export const pixelCreateSchema = z.object({
  name: nameSchema,
  dataset_id: datasetIdSchema,
  access_token: tokenSchema,
  test_event_code: testEventCodeSchema
});

/** Same as create, but a blank token keeps the saved one. */
export const pixelUpdateSchema = z.object({
  name: nameSchema,
  dataset_id: datasetIdSchema,
  access_token: z
    .string()
    .trim()
    .refine((value) => value === "" || ACCESS_TOKEN_PATTERN.test(value), PIXEL_MESSAGES.token)
    .optional()
    .transform((value) => (value ? value : null)),
  test_event_code: testEventCodeSchema
});

export type PixelCreateInput = z.infer<typeof pixelCreateSchema>;
export type PixelUpdateInput = z.infer<typeof pixelUpdateSchema>;

export function tokenLastFour(token: string): string {
  return token.trim().slice(-4);
}

export const funnelMetaSettingsSchema = z.object({
  meta_pixel_id: z
    .string()
    .trim()
    .refine((value) => value === "" || z.string().uuid().safeParse(value).success, PIXEL_MESSAGES.foreignPixel)
    .transform((value) => (value ? value : null)),
  consent_confirmed: z.boolean(),
  checkbox_enabled: z.boolean(),
  checkbox_label: z
    .string()
    .trim()
    .max(300, PIXEL_MESSAGES.checkboxLabel)
    .transform((value) => (value ? value : null))
});

export type FunnelMetaSettingsInput = z.infer<typeof funnelMetaSettingsSchema>;

/** First Zod message, or null. */
export function firstZodMessage(error: unknown): string | null {
  if (error instanceof z.ZodError) {
    return error.issues[0]?.message ?? null;
  }
  return null;
}

export type FunnelMetaUpdate = {
  meta_pixel_id: string | null;
  meta_consent_confirmed_at: string | null;
  meta_consent_confirmed_by: string | null;
  meta_consent_checkbox_enabled: boolean;
  meta_consent_checkbox_label: string | null;
};

/**
 * Pure rules for saving a form's Meta settings (P3.8). A pixel needs the
 * consent confirmation; the confirmation keeps its first time and person while
 * it stays on, and is cleared when withdrawn (only allowed with no pixel).
 */
export function resolveFunnelMetaUpdate(
  current: { meta_pixel_id: string | null; meta_consent_confirmed_at: string | null; meta_consent_confirmed_by: string | null },
  input: FunnelMetaSettingsInput,
  actorEmail: string,
  nowIso: string
): { ok: true; update: FunnelMetaUpdate } | { ok: false; message: string } {
  if (input.meta_pixel_id && !input.consent_confirmed) {
    const withdrawing = Boolean(current.meta_consent_confirmed_at && current.meta_pixel_id);
    return { ok: false, message: withdrawing ? PIXEL_MESSAGES.removePixelFirst : PIXEL_MESSAGES.needConsent };
  }
  const keepConfirmation = input.consent_confirmed && Boolean(current.meta_consent_confirmed_at);
  return {
    ok: true,
    update: {
      meta_pixel_id: input.meta_pixel_id,
      meta_consent_confirmed_at: input.consent_confirmed
        ? keepConfirmation
          ? current.meta_consent_confirmed_at
          : nowIso
        : null,
      meta_consent_confirmed_by: input.consent_confirmed
        ? keepConfirmation
          ? current.meta_consent_confirmed_by
          : actorEmail.slice(0, 254)
        : null,
      meta_consent_checkbox_enabled: input.checkbox_enabled,
      meta_consent_checkbox_label: input.checkbox_label
    }
  };
}

/** True when a form had a pixel and the saved settings drop it or switch to another one. */
export function pixelDetached(previousPixelId: string | null, nextPixelId: string | null): boolean {
  return Boolean(previousPixelId) && previousPixelId !== nextPixelId;
}

