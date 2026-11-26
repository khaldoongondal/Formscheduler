"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PublicError } from "@/lib/api/responses";
import { getClientIp } from "@/lib/security/client-ip";
import { checkActionRateLimit } from "@/lib/security/rate-limit";
import { startSignup } from "@/lib/signup/service";
import { isTurnstileEnabled, verifyTurnstile } from "@/lib/signup/turnstile";
import {
  SIGNUP_GENERIC_ERROR,
  formDataToRecord,
  parseSignupForm,
  type SignupFieldErrors
} from "@/lib/validation/signup";

export type SignupValues = {
  name: string;
  email: string;
  phone: string;
  business_name: string;
  website: string;
  terms: boolean;
};

export type SignupState = {
  fieldErrors: SignupFieldErrors;
  values: SignupValues;
};

const SIGNUP_RATE_LIMITED_MESSAGE = "Too many signup attempts. Please wait an hour and try again.";
const CAPTCHA_FAILED_MESSAGE = "Please complete the security check.";

function keptValues(record: Record<string, string>): SignupValues {
  // Everything typed except the password comes back to the form.
  return {
    name: (record.name ?? "").slice(0, 120),
    email: (record.email ?? "").slice(0, 254),
    phone: (record.phone ?? "").slice(0, 40),
    business_name: (record.business_name ?? "").slice(0, 160),
    website: (record.website ?? "").slice(0, 300),
    terms: record.terms === "on"
  };
}

export async function signUpAction(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const record = formDataToRecord(formData);
  const values = keptValues(record);
  const requestHeaders = await headers();

  if (!(await checkActionRateLimit(requestHeaders, "signup"))) {
    return { values, fieldErrors: { form: SIGNUP_RATE_LIMITED_MESSAGE } };
  }

  const parsed = parseSignupForm(record);
  if (!parsed.ok) {
    return { values, fieldErrors: parsed.fieldErrors };
  }

  if (isTurnstileEnabled()) {
    const token = record["cf-turnstile-response"] || null;
    const passed = await verifyTurnstile(token, getClientIp(requestHeaders));
    if (!passed) {
      return { values, fieldErrors: { form: CAPTCHA_FAILED_MESSAGE } };
    }
  }

  try {
    await startSignup(parsed.data);
  } catch (error) {
    if (error instanceof PublicError) {
      return { values, fieldErrors: { form: error.message } };
    }
    console.error("[signup] signup failed:", error instanceof Error ? error.message : "unknown error");
    return { values, fieldErrors: { form: SIGNUP_GENERIC_ERROR } };
  }

  // Same-site page; the address is needed for "send again". No other personal data in the URL.
  redirect(`/signup/check-email?email=${encodeURIComponent(parsed.data.email)}`);
}
