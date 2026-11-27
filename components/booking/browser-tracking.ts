import { META_EVENT_DEFS, type MetaEventKey } from "@/lib/meta/events";
import { consentedGaClientId, readBrowserAttribution } from "@/lib/tracking/attribution";
import type { BrowserTrackingSettings } from "@/lib/tracking/settings";
import type { BrowserMetaEvent } from "./meta-bridge";

export type FormTrackingEvent = MetaEventKey | "step_view";
type TrackingMode = "full" | "embed";
type Message =
  | { type: "event"; name: FormTrackingEvent; step?: number }
  | { type: "pixel"; name: string; standard: boolean; id: string }
  | { type: "flush" };

/** Created only after visitor opt-in. Each form visit gets its own disposable JS realm. */
export function startBrowserTracking(
  settings: BrowserTrackingSettings, formId: string, mode: TrackingMode, usesCapi: boolean,
  seen: Set<string>, pageId: string
) {
  const frame = document.createElement("iframe");
  frame.hidden = true;
  frame.title = "Optional form measurement";
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.referrerPolicy = "no-referrer";
  frame.src = "/embed/formbook-tracking/frame.html";
  const attribution = settings.gtm_container_id || settings.ga4_measurement_id
    ? readBrowserAttribution(window.location.search)
    : undefined;
  const gaClientId = settings.ga4_measurement_id ? consentedGaClientId(formId) : undefined;
  const channel = new MessageChannel();
  let closed = false;
  let flushDone: (() => void) | undefined;
  channel.port1.onmessage = (message) => {
    if (message.data?.type === "flushed") flushDone?.();
  };
  frame.addEventListener("load", () => {
    // Only the sandbox receives this capability. A sandbox without allow-same-origin
    // has an opaque origin, which requires "*" for the initial transfer.
    if (!closed) frame.contentWindow?.postMessage({ type: "formbook:init", settings, formId, mode, attribution, gaClientId }, "*", [channel.port2]);
  }, { once: true });
  document.body.appendChild(frame);

  function post(message: Message) {
    if (!closed) channel.port1.postMessage(message);
  }

  function pixel(name: string, standard: boolean, id: string) {
    if (!settings.meta_pixel_id || seen.has(id)) return;
    seen.add(id);
    post({ type: "pixel", name, standard, id });
  }

  function track(name: FormTrackingEvent, step?: number) {
    const key = name === "step_view" ? `${name}:${step}` : name;
    if (closed || seen.has(key)) return;
    seen.add(key);
    post({ type: "event", name, ...(name === "step_view" ? { step } : {}) });
    if (!usesCapi && name !== "step_view") {
      const definition = META_EVENT_DEFS[name];
      pixel(definition.metaName, definition.standard, `fbk1.${name}.${pageId}`);
    }
  }

  return {
    track,
    trackServerPixel(events: BrowserMetaEvent[] | undefined | null) {
      if (!usesCapi || closed) return;
      for (const event of events ?? []) {
        // An open tab can outlive a detach, replacement, or settings edit.
        if (!event.browser_dataset_id || event.browser_dataset_id !== settings.meta_pixel_id) continue;
        const definition = Object.values(META_EVENT_DEFS).find((entry) => entry.metaName === event.event_name);
        if (definition) pixel(definition.metaName, definition.standard, event.event_id);
      }
    },
    beforeRedirect() {
      // Allow already-loaded tags to handle the final message before navigation.
      // A blocked or slow tag must never hold up a booking.
      return new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 220);
        flushDone = () => { window.clearTimeout(timer); resolve(); };
        post({ type: "flush" });
      });
    },
    stop() {
      closed = true;
      channel.port1.close();
      channel.port2.close();
      frame.remove();
      flushDone?.();
    }
  };
}
