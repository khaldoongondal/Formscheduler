"use client";

import { useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface ConfirmDeleteButtonProps extends Omit<ButtonProps, "children" | "onClick" | "type"> {
  cancelLabel?: string;
  confirmLabel?: string;
  description: string;
  label: string;
  title: string;
}

export function ConfirmDeleteButton({
  cancelLabel = "No, keep it",
  confirmLabel = "Yes, delete",
  description,
  label,
  title,
  variant = "ghost",
  ...buttonProps
}: ConfirmDeleteButtonProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  function confirmDelete() {
    const form = buttonRef.current?.form;
    if (!form) return;

    setIsSubmitting(true);
    form.requestSubmit();
  }

  return (
    <>
      <Button
        ref={buttonRef}
        type="button"
        variant={variant}
        onClick={() => setIsOpen(true)}
        {...buttonProps}
      >
        <Trash2 className="h-4 w-4" />
        {label}
      </Button>

      {isOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-xl">
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
              <Button type="button" variant="destructive" onClick={confirmDelete} disabled={isSubmitting}>
                {isSubmitting ? "Deleting..." : confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
