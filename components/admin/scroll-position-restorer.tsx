"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

const storageKey = "leadder:admin-scroll-position";
const maxRestoreAgeMs = 30_000;

interface SavedScrollPosition {
  pathname: string;
  scrollY: number;
  savedAt: number;
}

function readSavedScrollPosition(): SavedScrollPosition | null {
  try {
    const rawValue = window.sessionStorage.getItem(storageKey);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as Partial<SavedScrollPosition>;

    if (
      typeof parsed.pathname !== "string" ||
      typeof parsed.scrollY !== "number" ||
      typeof parsed.savedAt !== "number"
    ) {
      window.sessionStorage.removeItem(storageKey);
      return null;
    }

    return parsed as SavedScrollPosition;
  } catch {
    window.sessionStorage.removeItem(storageKey);
    return null;
  }
}

function writeSavedScrollPosition() {
  try {
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({
        pathname: window.location.pathname,
        scrollY: window.scrollY,
        savedAt: Date.now()
      } satisfies SavedScrollPosition)
    );
  } catch {
    // Scroll restoration is only a convenience; storage failures should never break admin forms.
  }
}

export function ScrollPositionRestorer() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const previousValue = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";

    return () => {
      window.history.scrollRestoration = previousValue;
    };
  }, []);

  useEffect(() => {
    function handleSubmit(event: SubmitEvent) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.preserveScroll === "false") return;

      writeSavedScrollPosition();
    }

    document.addEventListener("submit", handleSubmit, { capture: true });
    return () => document.removeEventListener("submit", handleSubmit, { capture: true });
  }, []);

  useEffect(() => {
    const saved = readSavedScrollPosition();
    if (!saved) return;

    const isFresh = Date.now() - saved.savedAt <= maxRestoreAgeMs;
    const isSamePage = saved.pathname === window.location.pathname;
    if (!isFresh || !isSamePage) {
      window.sessionStorage.removeItem(storageKey);
      return;
    }

    window.sessionStorage.removeItem(storageKey);

    const restore = () => {
      try {
        window.scrollTo({ top: saved.scrollY, left: 0, behavior: "auto" });
      } catch {
        // Ignore browser-specific scroll failures.
      }
    };
    requestAnimationFrame(() => {
      restore();
      [0, 50, 150, 300].forEach((delay) => window.setTimeout(restore, delay));
    });
  }, [pathname, searchParams]);

  return null;
}
