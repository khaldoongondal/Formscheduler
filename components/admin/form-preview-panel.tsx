"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, EyeOff, RotateCw } from "lucide-react";
import {
  PREVIEW_COPY,
  PREVIEW_OPEN_STORAGE_KEY,
  PREVIEW_READY_MESSAGE,
  PREVIEW_THEME_MESSAGE,
  previewThemeFromValues,
  type PreviewTheme
} from "@/lib/booking/preview";
import { Button } from "@/components/ui/button";

function readStoredOpen(): boolean | null {
  try {
    const value = window.localStorage.getItem(PREVIEW_OPEN_STORAGE_KEY);
    return value === "1" ? true : value === "0" ? false : null;
  } catch {
    return null;
  }
}

function writeStoredOpen(open: boolean) {
  try {
    window.localStorage.setItem(PREVIEW_OPEN_STORAGE_KEY, open ? "1" : "0");
  } catch {
    // Remembering the toggle is a convenience only.
  }
}

/** The four theme inputs of the editor's settings form, or null when one is invalid. */
function readThemeFromForm(form: HTMLFormElement | null): PreviewTheme | null {
  if (!form) return null;
  const value = (name: string) => {
    const element = form.elements.namedItem(name);
    return element instanceof HTMLInputElement ? element.value : null;
  };
  return previewThemeFromValues({
    primary_color: value("primary_color"),
    accent_color: value("accent_color"),
    button_color: value("button_color"),
    border_radius: value("border_radius")
  });
}

/**
 * In-editor preview (decision D18). Wraps the editor content: when open, the
 * content and a sticky preview column sit side by side on xl screens; below
 * xl the preview sits above the content, full width.
 */
export function FormPreviewPanel({
  funnelId,
  version,
  forceOpen = false,
  children
}: {
  funnelId: string;
  /** The form's updated_at: a save changes it, so the frame reloads with the change. */
  version: string;
  /** True when the page URL has ?preview=1 (the checklist link). */
  forceOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  const [nonce, setNonce] = useState(0);
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (forceOpen) return;
    const stored = readStoredOpen();
    if (stored !== null) setOpen(stored);
  }, [forceOpen]);

  const postTheme = useCallback(() => {
    const target = frameRef.current?.contentWindow;
    if (!target) return;
    const theme = readThemeFromForm(document.querySelector<HTMLFormElement>("form[data-preview-theme]"));
    if (!theme) return;
    try {
      target.postMessage({ type: PREVIEW_THEME_MESSAGE, theme }, window.location.origin);
    } catch {
      // The frame may be reloading; the next ready message sends the theme again.
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const form = document.querySelector<HTMLFormElement>("form[data-preview-theme]");
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { type?: unknown } | null;
      if (data && typeof data === "object" && data.type === PREVIEW_READY_MESSAGE) postTheme();
    };
    window.addEventListener("message", onMessage);
    form?.addEventListener("input", postTheme);
    form?.addEventListener("change", postTheme);
    return () => {
      window.removeEventListener("message", onMessage);
      form?.removeEventListener("input", postTheme);
      form?.removeEventListener("change", postTheme);
    };
  }, [open, postTheme]);

  function toggle() {
    setOpen((current) => {
      const next = !current;
      writeStoredOpen(next);
      return next;
    });
  }

  const src = `/preview/forms/${encodeURIComponent(funnelId)}?v=${encodeURIComponent(version)}${nonce ? `&r=${nonce}` : ""}`;
  const toggleButton = (
    <Button type="button" variant="outline" onClick={toggle} aria-expanded={open} aria-controls="form-preview-panel">
      {open ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      {open ? PREVIEW_COPY.hide : PREVIEW_COPY.show}
    </Button>
  );

  // One tree shape for both states, so toggling never remounts the editor
  // forms (typed but unsaved values stay).
  return (
    <div className="space-y-8">
      <div className="flex justify-end">{toggleButton}</div>
      <div className={open ? "grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start" : ""}>
        {open ? (
        <aside
          id="form-preview-panel"
          aria-label={PREVIEW_COPY.title}
          className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 xl:sticky xl:top-24 xl:order-2"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-slate-950">{PREVIEW_COPY.title}</h2>
            <Button type="button" variant="ghost" size="sm" onClick={() => setNonce((value) => value + 1)}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {PREVIEW_COPY.reload}
            </Button>
          </div>
          <p className="text-xs leading-5 text-slate-600">{PREVIEW_COPY.note}</p>
          <iframe
            ref={frameRef}
            key={src}
            src={src}
            title={PREVIEW_COPY.frameTitle}
            className="h-[720px] w-full rounded-lg border bg-white"
          />
        </aside>
        ) : null}
        <div className={open ? "min-w-0 space-y-8 xl:order-1" : "space-y-8"}>{children}</div>
      </div>
    </div>
  );
}
