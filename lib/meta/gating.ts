/**
 * Whether an event is queued for Meta, and in which state (decisions M4, M10, M11).
 * Pure: no Next.js or Supabase imports.
 */

import { isEventEnabled, type MetaEventKey, type PixelSwitches } from "@/lib/meta/events";

export type SendingMode = "automatic" | "hold";
export type ConsentAnswer = "granted" | "declined" | "not_asked";

export type GateInput = {
  key: MetaEventKey;
  funnel: {
    meta_pixel_id: string | null;
    meta_consent_confirmed_at: string | null;
    meta_consent_checkbox_enabled: boolean;
  };
  pixel: (PixelSwitches & { sending_mode: SendingMode }) | null;
  /** null before a lead exists (form view, form start). */
  lead: { meta_consent: boolean | null; meta_released_at: string | null } | null;
};

export type GateResult =
  | { action: "none"; reason: "no_pixel" | "no_confirmation" | "consent_declined" | "event_off" }
  | { action: "enqueue"; status: "awaiting_consent" | "held" | "pending" };

export function decideEnqueue(input: GateInput): GateResult {
  const { funnel, pixel, lead, key } = input;
  if (!funnel.meta_pixel_id || !pixel) return { action: "none", reason: "no_pixel" };
  if (!funnel.meta_consent_confirmed_at) return { action: "none", reason: "no_confirmation" };
  if (lead && lead.meta_consent === false) return { action: "none", reason: "consent_declined" };
  if (funnel.meta_consent_checkbox_enabled && lead && lead.meta_consent !== true) {
    return { action: "none", reason: "consent_declined" };
  }
  if (!isEventEnabled(key, pixel)) return { action: "none", reason: "event_off" };
  if (funnel.meta_consent_checkbox_enabled && !lead) return { action: "enqueue", status: "awaiting_consent" };
  if (pixel.sending_mode === "hold" && !lead?.meta_released_at) return { action: "enqueue", status: "held" };
  return { action: "enqueue", status: "pending" };
}

/** What the lead's consent means for its earlier view and start rows. */
export function consentAnswerForLead(checkboxEnabled: boolean, metaConsent: boolean | null): ConsentAnswer {
  if (!checkboxEnabled) return "not_asked";
  return metaConsent === true ? "granted" : "declined";
}

/**
 * Value stored on lead_sessions.meta_consent: the visitor's answer when the
 * form has a pixel and shows the checkbox, else null (covered by the
 * customer's confirmation).
 */
export function leadConsentValue(
  funnel: { meta_pixel_id: string | null; meta_consent_checkbox_enabled: boolean },
  submitted: boolean | undefined
): boolean | null {
  if (!funnel.meta_pixel_id || !funnel.meta_consent_checkbox_enabled) return null;
  return submitted === true;
}
