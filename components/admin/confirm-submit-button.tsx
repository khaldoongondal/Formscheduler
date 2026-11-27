"use client";

import { useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface ConfirmSubmitButtonProps extends Omit<ButtonProps, "children" | "onClick" | "type"> {
  label: string;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  pendingLabel?: string;
}

/** A submit button that asks first, for actions that cannot be taken back (like sending events to Meta). */
export function ConfirmSubmitButton({
  label,
  title,
  description,
  confirmLabel = "Yes, send",
  cancelLabel = "Not now",
  pendingLabel = "Sending...",
  variant = "default",
  ...buttonProps
}: ConfirmSubmitButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function confirm() {
    const form = buttonRef.current?.form;
    if (!form) return;
    setIsSubmitting(true);
    form.requestSubmit();
  }

  return (
    <>
      <Button ref={buttonRef} type="button" variant={variant} onClick={() => setIsOpen(true)} {...buttonProps}>
        <Send className="h-4 w-4" />
        {label}
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl" role="dialog" aria-modal="true">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                onClick={() => setIsOpen(false)}
                aria-label="Close confirmation"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setIsOpen(false)} disabled={isSubmitting}>
                {cancelLabel}
              </Button>
              <Button type="button" onClick={confirm} disabled={isSubmitting}>
                {isSubmitting ? pendingLabel : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
