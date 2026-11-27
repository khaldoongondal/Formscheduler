import { z } from "zod";
import { databaseIdSchema, urlStringSchema } from "@/lib/validation/fields";

/** Size caps for the free-form fields accepted by /api/analytics. Pure module. */
export const ANALYTICS_METADATA_MAX_KEYS = 40;
export const ANALYTICS_METADATA_MAX_VALUE_LENGTH = 512;
/** Keys ending in "_url" (for example landing_page_url) may hold a full URL. */
export const ANALYTICS_METADATA_MAX_URL_VALUE_LENGTH = 2048;
export const ANALYTICS_METADATA_MAX_ARRAY_ITEMS = 20;
export const ANALYTICS_METADATA_MAX_ARRAY_ITEM_LENGTH = 128;
export const ANALYTICS_METADATA_MAX_BYTES = 8192;

const METADATA_KEY_PATTERN = /^[a-z0-9_]{1,64}$/;

const primitiveValueSchema = z.union([
  z.string().max(ANALYTICS_METADATA_MAX_URL_VALUE_LENGTH),
  z.number().finite(),
  z.boolean(),
  z.null()
]);

// The booking flow sends `contact_fields` as a short list of field keys.
const arrayValueSchema = z
  .array(z.string().max(ANALYTICS_METADATA_MAX_ARRAY_ITEM_LENGTH))
  .max(ANALYTICS_METADATA_MAX_ARRAY_ITEMS);

export const analyticsMetadataSchema = z
  .record(z.string(), z.union([primitiveValueSchema, arrayValueSchema]))
  .superRefine((metadata, ctx) => {
    const keys = Object.keys(metadata);
    if (keys.length > ANALYTICS_METADATA_MAX_KEYS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many metadata fields." });
      return;
    }

    for (const key of keys) {
      if (!METADATA_KEY_PATTERN.test(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Invalid metadata field name.", path: [key] });
        return;
      }
      const value = metadata[key];
      const maxLength = key.endsWith("_url")
        ? ANALYTICS_METADATA_MAX_URL_VALUE_LENGTH
        : ANALYTICS_METADATA_MAX_VALUE_LENGTH;
      if (typeof value === "string" && value.length > maxLength) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Metadata value is too long.", path: [key] });
        return;
      }
    }

    if (new TextEncoder().encode(JSON.stringify(metadata)).length > ANALYTICS_METADATA_MAX_BYTES) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Metadata is too large." });
    }
  });

export const analyticsEventSchema = z.object({
  funnel_id: databaseIdSchema,
  lead_session_id: databaseIdSchema.optional(),
  visitor_id: z.string().min(8).max(128).optional(),
  event_type: z.enum(["page_view", "step_view", "form_start"]),
  /** Split test the page was served for; the server re-checks it (decision S9). */
  test_id: databaseIdSchema.optional(),
  source: z.string().max(40).optional(),
  source_url: urlStringSchema.max(2048).optional(),
  user_agent: z.string().max(512).optional(),
  metadata: analyticsMetadataSchema.optional()
});

export type AnalyticsEventInput = z.infer<typeof analyticsEventSchema>;
