"use client";

import Link from "next/link";
import Script from "next/script";
import { useActionState, useEffect, useRef, useState, type InputHTMLAttributes } from "react";
import { signUpAction, type SignupState } from "@/app/signup/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignupField } from "@/lib/validation/signup";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        action: "signup";
        size: "flexible";
        callback: () => void;
        "expired-callback": () => void;
        "error-callback": () => void;
      }) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
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
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [challenge, setChallenge] = useState<"waiting" | "passed" | "error">("waiting");
  const [state, formAction, pending] = useActionState(async (previous: SignupState, data: FormData) => {
    try {
      return await signUpAction(previous, data);
    } finally {
      if (widgetId.current !== null) {
        setChallenge("waiting");
        window.turnstile?.reset(widgetId.current);
      }
    }
  }, initialState);
  const errors = state.fieldErrors;

  useEffect(() => {
    const api = window.turnstile;
    if (!sdkReady || !api || !turnstileSiteKey || !container.current) return;
    const id = api.render(container.current, {
      sitekey: turnstileSiteKey,
      action: "signup",
      size: "flexible",
      callback: () => setChallenge("passed"),
      "expired-callback": () => setChallenge("waiting"),
      "error-callback": () => setChallenge("error")
    });
    widgetId.current = id;
    return () => {
      widgetId.current = null;
      api.remove(id);
    };
  }, [sdkReady, turnstileSiteKey]);

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
            aria-describedby={errors.terms ? "terms-error" : undefined}
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
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
            strategy="afterInteractive"
            onReady={() => setSdkReady(true)}
            onError={() => setChallenge("error")}
          />
          <div ref={container} />
          {challenge !== "passed" && (
            <p className="text-xs text-slate-600" role="status">
              {challenge === "error"
                ? "The security check could not load. Refresh this page to try again."
                : "Waiting for the security check."}
            </p>
          )}
        </>
      ) : null}

      {errors.form ? (
        <p className="text-sm text-red-600" role="alert">
          {errors.form}
        </p>
      ) : null}

      <Button className="w-full" type="submit" disabled={pending || Boolean(turnstileSiteKey && challenge !== "passed")}>
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
