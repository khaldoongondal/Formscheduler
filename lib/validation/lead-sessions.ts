import { z } from "zod";
import { databaseIdSchema, urlStringSchema } from "@/lib/validation/fields";

export const startLeadSessionSchema = z
  .object({
    funnel_id: databaseIdSchema,
    first_name: z.string().max(80).optional().or(z.literal("")),
    last_name: z.string().max(80).optional().or(z.literal("")),
    full_name: z.string().max(160).optional().or(z.literal("")),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().regex(/^\+\d{8,15}$/, "Please add a valid phone number.").optional().or(z.literal("")),
    visitor_id: z.string().min(8).max(128).optional(),
    source_url: urlStringSchema.optional(),
    referrer: urlStringSchema.optional(),
    utm_source: z.string().max(160).optional(),
    utm_medium: z.string().max(160).optional(),
    utm_campaign: z.string().max(160).optional(),
    utm_content: z.string().max(160).optional(),
    utm_term: z.string().max(160).optional(),
    utm_adset: z.string().max(260).optional(),
    utm_adid: z.string().max(260).optional(),
    utm_adsetid: z.string().max(260).optional(),
    utm_campaignid: z.string().max(260).optional(),
    utm_id: z.string().max(260).optional(),
    fbc: z.string().max(512).optional(),
    fbp: z.string().max(512).optional(),
    fbclid: z.string().max(512).optional(),
    gclid: z.string().max(512).optional(),
    ttclid: z.string().max(512).optional(),
    fingerprint: z.string().max(160).optional(),
    split_test_id: z.string().max(160).optional(),
    split_variant: z.string().max(80).optional(),
    landing_page_url: urlStringSchema.optional(),
    /** Split test the page was served for; the server re-checks it (decision S9). */
    test_id: databaseIdSchema.optional(),
    /** The Meta consent checkbox on the form; only read when the form shows it. */
    meta_consent: z.boolean().optional(),
    /** First time this browser saw the fbclid (ms), for building fbc (decision M13). */
    fbclid_seen_at: z.number().int().positive().optional()
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "Email or phone is required.",
    path: ["email"]
  });

export const answerInputSchema = z.object({
  question_id: databaseIdSchema,
  value: z.union([z.string(), z.number(), z.array(z.string())])
});

export const submitAnswersSchema = z.object({
  lead_session_id: databaseIdSchema,
  answers: z.array(answerInputSchema).min(1)
});
