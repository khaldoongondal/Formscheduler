"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopySnippetButtonProps {
  label: string;
  value: string;
  /** Server action run after a successful copy (the editor marks the checklist step). Errors are ignored. */
  onCopied?: () => Promise<void>;
}

async function copyToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export function CopySnippetButton({ label, value, onCopied }: CopySnippetButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await copyToClipboard(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
    if (onCopied) {
      onCopied().catch(() => undefined);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 px-2.5 text-xs"
      onClick={() => void handleCopy()}
      aria-label={`Copy ${label}`}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
