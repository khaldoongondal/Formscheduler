"use client";

import { useEffect, useRef, useState } from "react";
import { CALENDLY_COPY, CALENDLY_MESSAGE_ORIGINS, CALENDLY_WIDGET_SCRIPT } from "@/lib/calendly/constants";

type Prefill = { name?: string; email?: string; firstName?: string; lastName?: string };

type CalendlyGlobal = {
  initInlineWidget: (options: { url: string; parentElement: HTMLElement; prefill?: Prefill }) => void;
};

declare global {
  interface Window {
    Calendly?: CalendlyGlobal;
  }
}

let scriptPromise: Promise<void> | null = null;

/** Loads Calendly's widget script once per page. */
function loadWidgetScript(): Promise<void> {
  if (typeof window !== "undefined" && window.Calendly) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = CALENDLY_WIDGET_SCRIPT;
    script.async = true;
    script.onload = () => (window.Calendly ? resolve() : reject(new Error("calendly_missing")));
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("calendly_script_failed"));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * Calendly's inline scheduler as the last step of the form (decision C6).
 * Only messages from Calendly's own origin are read.
 */
export function CalendlyInline({
  url,
  prefill,
  onScheduled
}: {
  url: string;
  prefill: Prefill;
  onScheduled: (eventUri: string, inviteeUri: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const onScheduledRef = useRef(onScheduled);
  onScheduledRef.current = onScheduled;
  const scheduledRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadWidgetScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.Calendly) return;
        containerRef.current.innerHTML = "";
        window.Calendly.initInlineWidget({ url, parentElement: containerRef.current, prefill });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // The widget is set up once per scheduling URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!(CALENDLY_MESSAGE_ORIGINS as readonly string[]).includes(event.origin)) return;
      const data = asRecord(event.data);
      const name = typeof data.event === "string" ? data.event : "";
      if (name === "calendly.page_height") {
        const value = parseInt(String(asRecord(data.payload).height ?? ""), 10);
        if (Number.isFinite(value) && value > 300 && value < 4000) setHeight(value);
        return;
      }
      if (name === "calendly.event_scheduled" && !scheduledRef.current) {
        const payload = asRecord(data.payload);
        const eventUri = asRecord(payload.event).uri;
        const inviteeUri = asRecord(payload.invitee).uri;
        if (typeof eventUri === "string" && typeof inviteeUri === "string") {
          scheduledRef.current = true;
          onScheduledRef.current(eventUri, inviteeUri);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  if (failed) {
    return (
      <p className="rounded-[var(--radius)] border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700" role="alert">
        {CALENDLY_COPY.scriptFailed}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-base font-semibold text-slate-900">{CALENDLY_COPY.stepHeading}</p>
        <p className="text-sm leading-6 text-slate-600">{CALENDLY_COPY.stepBody}</p>
      </div>
      <div ref={containerRef} className="w-full overflow-hidden" style={{ minHeight: 700, height: height ?? undefined }} />
    </div>
  );
}
