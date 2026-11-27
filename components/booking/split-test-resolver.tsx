"use client";

import { useEffect } from "react";
import { getVisitorId } from "@/lib/booking/visitor-id";

/**
 * Shown once on the first visit to a split test link without the visitor
 * cookie: reads (or creates) the stored visitor id and reloads with it in
 * `fb_vid`, so the server can pick this visitor's form. When storage is
 * blocked it sends `fb_vid=none` and the server uses its own fallback key.
 * The server never renders this when `fb_vid` is present, so it cannot loop.
 */
export function SplitTestResolver() {
  useEffect(() => {
    let id = "none";
    try {
      id = getVisitorId();
    } catch {
      id = "none";
    }
    const url = new URL(window.location.href);
    url.searchParams.set("fb_vid", id);
    window.location.replace(url.toString());
  }, []);

  return (
    <main className="flex min-h-[60vh] items-center justify-center bg-white">
      <span
        className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600"
        aria-hidden="true"
      />
      <span className="sr-only" role="status">
        Loading the form...
      </span>
    </main>
  );
}
