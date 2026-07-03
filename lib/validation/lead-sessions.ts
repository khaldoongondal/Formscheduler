import { z } from "zod";

export const startLeadSessionSchema = z
  .object({
    funnel_id: z.string().uuid(),
    first_name: z.string().max(80).optional().or(z.literal("")),
    last_name: z.string().max(80).optional().or(z.literal("")),
    full_name: z.string().max(160).optional().or(z.literal("")),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().regex(/^\+\d{8,15}$/, "Please add a valid phone number.").optional().or(z.literal("")),
    visitor_id: z.string().min(8).max(128).optional(),
    source_url: z.string().url().optional(),
    referrer: z.string().url().optional(),
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
    landing_page_url: z.string().url().optional()
  })
  .refine((value) => Boolean(value.email || value.phone), {
    message: "Email or phone is required.",
    path: ["email"]
  });

export const answerInputSchema = z.object({
  question_id: z.string().uuid(),
  value: z.union([z.string(), z.number(), z.array(z.string())])
});

export const submitAnswersSchema = z.object({
  lead_session_id: z.string().uuid(),
  answers: z.array(answerInputSchema).min(1)
});
