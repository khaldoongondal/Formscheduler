"use client";

import Link from "next/link";
import Script from "next/script";
import { useActionState, useEffect, type InputHTMLAttributes } from "react";
import { signUpAction, type SignupState } from "@/app/signup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignupField } from "@/lib/validation/signup";

declare global {
  interface Window {
    turnstile?: { reset: (widget?: string | HTMLElement) => void };
  }
}

const initialState: SignupState = {
  fieldErrors: {},
  values: { name: "", email: "", phone: "", business_name: "", website: "", terms: false }
};

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-red-600">
      {message}
    </p>
  );
}

export function SignupForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const errors = state.fieldErrors;

  // A Turnstile token works once, so get a fresh one after a failed submit.
  useEffect(() => {
    if (turnstileSiteKey && state !== initialState) {
      window.turnstile?.reset();
    }
  }, [state, turnstileSiteKey]);

  const textField = (
    field: Exclude<SignupField, "terms">,
    label: string,
    props: InputHTMLAttributes<HTMLInputElement>
  ) => {
    const errorId = `${field}-error`;
    return (
      <div className="space-y-2">
        <Label htmlFor={field}>{label}</Label>
        <Input
          id={field}
          name={field}
          defaultValue={state.values[field]}
          aria-invalid={errors[field] ? true : undefined}
          aria-describedby={errors[field] ? errorId : undefined}
          required
          {...props}
        />
        <FieldError id={errorId} message={errors[field]} />
      </div>
    );
  };

  return (
    // React resets the form after the action; defaultValue brings back what the server returned.
    <form action={formAction} className="space-y-4" noValidate>
      {textField("name", "Your name", { autoComplete: "name", maxLength: 120 })}
      {textField("email", "Work email", { type: "email", autoComplete: "email", maxLength: 254 })}
      {textField("phone", "Phone", { type: "tel", autoComplete: "tel", maxLength: 40, placeholder: "+1 416 555 0100" })}
      {textField("business_name", "Business name", { autoComplete: "organization", maxLength: 160 })}
      {textField("website", "Website", { autoComplete: "url", inputMode: "url", maxLength: 300, placeholder: "company.com" })}

      <p className="text-xs text-slate-500">
        We will email you a link to confirm your address. You choose your password after you open it.
      </p>

      {/* Honeypot: hidden from people, often filled by bots. */}
      <div aria-hidden="true" className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden">
        <label htmlFor="company_fax">Company fax</label>
        <input id="company_fax" name="company_fax" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="space-y-2">
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="terms"
            className="mt-0.5 h-4 w-4"
            defaultChecked={state.values.terms}
            aria-invalid={errors.terms ? true : undefined}
          />
          <span>
            I agree to the{" "}
            <Link className="underline underline-offset-2" href="/terms" target="_blank">
              Terms
            </Link>
            ,{" "}
            <Link className="underline underline-offset-2" href="/privacy" target="_blank">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link className="underline underline-offset-2" href="/dpa" target="_blank">
              Data Processing Addendum
            </Link>
            .
          </span>
        </label>
        <FieldError id="terms-error" message={errors.terms} />
      </div>

      {turnstileSiteKey ? (
        <>
          <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
          <div className="cf-turnstile" data-sitekey={turnstileSiteKey} />
        </>
      ) : null}

      {errors.form ? (
        <p className="text-sm text-red-600" role="alert">
          {errors.form}
        </p>
      ) : null}

      <Button className="w-full" type="submit" disabled={pending}>
        {pending ? "Creating account..." : "Create account"}
      </Button>

      <p className="text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link className="font-semibold text-slate-900 underline underline-offset-2" href="/login">
          Sign in
        </Link>
      </p>
    </form>
  );
}
