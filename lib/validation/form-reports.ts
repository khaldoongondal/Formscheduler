import { z } from "zod";

/** Validation for "Report this form". Pure module. */
export const REPORT_REASONS = ["phishing", "spam", "impersonation", "illegal", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  phishing: "Phishing or asks for passwords",
  spam: "Spam",
  impersonation: "Pretending to be someone else",
  illegal: "Illegal content",
  other: "Something else"
};

export const formReportSchema = z.object({
  slug: z.string().min(1).max(80),
  reason: z.enum(REPORT_REASONS, { errorMap: () => ({ message: "Choose a reason for the report." }) }),
  details: z.string().trim().max(1000, "Keep the details under 1000 characters.").optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email address, or leave it empty.").max(254).optional().or(z.literal(""))
});

export type FormReportInput = z.infer<typeof formReportSchema>;
