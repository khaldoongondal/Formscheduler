"use client";

import { useState } from "react";
import { WEBHOOK_COPY } from "@/lib/webhooks/copy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** "whsec_" + 32 random bytes (base64url), made in the browser; the server only ever stores it encrypted. */
function generateSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `whsec_${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

export function WebhookSecretInput({ id, name = "signing_secret" }: { id: string; name?: string }) {
  const [value, setValue] = useState("");
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          minLength={24}
          maxLength={200}
          required
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="font-mono"
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setValue(generateSecret());
            setVisible(true);
          }}
        >
          {WEBHOOK_COPY.secretGenerate}
        </Button>
      </div>
      <p className="text-xs leading-5 text-slate-500">{WEBHOOK_COPY.secretNote}</p>
    </div>
  );
}
