/**
 * Self-serve signup validation. Pure module (no Next.js or Supabase imports),
 * so node:test can load it.
 */
import { z } from "zod";
import { isValidWebsiteValue, normalizeWebsiteValue, websiteValidationMessage } from "@/lib/validation/website";

export const PHONE_MESSAGE = "Enter your phone number with the country code, like +1 416 555 0100.";
export const SIGNUP_GENERIC_ERROR = "Something went wrong. Please try again.";
export const UNVERIFIED_EMAIL_MESSAGE = "Please verify your email first. Check your inbox for the link.";
export const RESEND_RATE_LIMITED_MESSAGE = "Too many attempts. Please wait an hour and try again.";

/** Strips spaces, dots, dashes and brackets. A leading "00" becomes "+". */
export function normalizeSignupPhone(raw: string): string {
  const stripped = raw.trim().replace(/[\s.\-()]/g, "");
  return stripped.startsWith("00") ? `+${stripped.slice(2)}` : stripped;
}

export function isValidSignupPhone(value: string): boolean {
  return /^\+\d{8,15}$/.test(value);
}

export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120, "Use 120 characters or fewer."),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address.")
    .max(254, "Use 254 characters or fewer."),
  phone: z.string().trim().max(40, PHONE_MESSAGE).transform(normalizeSignupPhone).refine(isValidSignupPhone, PHONE_MESSAGE),
  business_name: z.string().trim().min(2, "Enter your business name.").max(160, "Use 160 characters or fewer."),
  website: z
    .string()
    .trim()
    .max(300, "Use 300 characters or fewer.")
    .refine(isValidWebsiteValue, websiteValidationMessage)
    .transform(normalizeWebsiteValue)
    // "https://" is added by the transform; the stored value must fit 300 characters.
    .refine((value) => value.length <= 300, "Use 300 characters or fewer."),
  company_fax: z.string().optional(),
  terms: z.literal("on", { errorMap: () => ({ message: "Please accept the terms to continue." }) })
});

export type SignupInput = z.infer<typeof signupSchema>;

export type SignupField = "name" | "email" | "phone" | "business_name" | "website" | "terms";
export type SignupFieldErrors = Partial<Record<SignupField | "form", string>>;

const SIGNUP_FIELDS: readonly SignupField[] = ["name", "email", "phone", "business_name", "website", "terms"];

export function parseSignupForm(
  values: Record<string, string>
): { ok: true; data: SignupInput } | { ok: false; fieldErrors: SignupFieldErrors } {
  // Honeypot: real people never see or fill this field.
  if ((values.company_fax ?? "").trim() !== "") {
    return { ok: false, fieldErrors: { form: SIGNUP_GENERIC_ERROR } };
  }

  const parsed = signupSchema.safeParse({
    name: values.name ?? "",
    email: values.email ?? "",
    phone: values.phone ?? "",
    business_name: values.business_name ?? "",
    website: values.website ?? "",
    company_fax: values.company_fax ?? "",
    terms: values.terms
  });

  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }

  const flattened = parsed.error.flatten().fieldErrors as Partial<Record<string, string[]>>;
  const fieldErrors: SignupFieldErrors = {};
  for (const field of SIGNUP_FIELDS) {
    const message = flattened[field]?.[0];
    if (message) fieldErrors[field] = message;
  }
  if (Object.keys(fieldErrors).length === 0) {
    fieldErrors.form = SIGNUP_GENERIC_ERROR;
  }
  return { ok: false, fieldErrors };
}

export type SignupWebhookPayload = {
  email: string;
  name: string;
  phone: string;
  business_name: string;
  website: string;
  verify_link: string;
  plan: "free";
};

/** The profile fields the webhook needs; matches both SignupInput and a stored signup_requests row. */
export type SignupProfile = Pick<SignupInput, "email" | "name" | "phone" | "business_name" | "website">;

export function buildSignupWebhookPayload(input: SignupProfile, verifyLink: string): SignupWebhookPayload {
  return {
    email: input.email,
    name: input.name,
    phone: input.phone,
    business_name: input.business_name,
    website: input.website,
    verify_link: verifyLink,
    plan: "free"
  };
}

export const SIGNUP_NEXT_PATH = "/admin/welcome";

/**
 * Where a verified signup goes: choose a password first, then the welcome
 * page. The password is never taken from the unauthenticated signup form, so
 * nobody can pre-register someone else's address with a password they know.
 */
export const SIGNUP_VERIFY_NEXT = `/auth/set-password?next=${SIGNUP_NEXT_PATH}`;

export function buildVerifyLink(appUrl: string, hashedToken: string, verificationType: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=${encodeURIComponent(verificationType)}&next=${encodeURIComponent(SIGNUP_VERIFY_NEXT)}`;
}

/** Redirect target for /auth/confirm when Supabase sends the email itself. */
export function buildSignupEmailRedirect(appUrl: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/auth/confirm?next=${encodeURIComponent(SIGNUP_VERIFY_NEXT)}`;
}

const SET_PASSWORD_PATH = "/auth/set-password";
const SET_PASSWORD_NEXT_PATHS = new Set(["/admin/funnels", SIGNUP_NEXT_PATH]);
const CONFIRM_NEXT_PATHS = new Set([SET_PASSWORD_PATH, "/admin/funnels", SIGNUP_NEXT_PATH]);

/** Where /auth/set-password sends the user after saving. Allowlist only. */
export function resolveSetPasswordNext(value: unknown): string {
  return typeof value === "string" && SET_PASSWORD_NEXT_PATHS.has(value) ? value : "/admin/funnels";
}

/**
 * Where /auth/confirm redirects after a valid link. Allowlist only: a bare
 * allowed path, or /auth/set-password carrying an allowed `next`.
 */
export function resolveConfirmNext(value: string | null): { pathname: string; search: string } {
  const fallback = { pathname: SET_PASSWORD_PATH, search: "" };
  if (!value) return fallback;
  if (CONFIRM_NEXT_PATHS.has(value)) return { pathname: value, search: "" };

  const [pathname, query, ...rest] = value.split("?");
  if (pathname !== SET_PASSWORD_PATH || rest.length > 0 || query === undefined) return fallback;
  const params = new URLSearchParams(query);
  const keys = Array.from(params.keys());
  if (keys.length !== 1 || keys[0] !== "next") return fallback;
  const next = params.get("next");
  if (!next || !SET_PASSWORD_NEXT_PATHS.has(next)) return fallback;
  return { pathname: SET_PASSWORD_PATH, search: `?next=${encodeURIComponent(next)}` };
}

/** Same link shape for password resets, always landing on /auth/set-password. */
export function buildResetLink(appUrl: string, hashedToken: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=recovery&next=/auth/set-password`;
}

/** Turns FormData into the plain record parseSignupForm expects (files are ignored). */
export function formDataToRecord(formData: { forEach(cb: (value: unknown, key: string) => void): void }): Record<string, string> {
  const record: Record<string, string> = {};
  formData.forEach((value, key) => {
    if (typeof value === "string" && !(key in record)) record[key] = value;
  });
  return record;
}
