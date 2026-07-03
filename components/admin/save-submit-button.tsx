"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

interface SaveSubmitButtonProps extends Omit<ButtonProps, "type" | "disabled"> {
  label: string;
  pendingLabel?: string;
}

export function SaveSubmitButton({ label, pendingLabel = "Saving...", ...props }: SaveSubmitButtonProps) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} {...props}>
      {pending ? pendingLabel : label}
    </Button>
  );
}
