/**
 * Downgrade freeze and restore planning. Pure: no Next.js or Supabase imports.
 *
 * A frozen form is unpublished with funnels.frozen_at set; a frozen pixel has
 * meta_pixels.frozen_at set (migration 0032). Nothing is ever deleted. The
 * ranking here is passed to apply_tenant_plan_change as ordered id arrays.
 */

import {
  PLANS,
  SUSPENDED_MESSAGE,
  activeLimitMessage,
  pixelLimitMessage,
  type PlanState
} from "@/lib/billing/plans";

export type FormActivity = {
  id: string;
  name: string;
  isPublished: boolean;
  frozenAt: string | null;
  takenDownAt: string | null;
  /** Creation time: the freeze, restore and swap never change it (unlike updated_at). */
  createdAt: string;
  metaPixelId: string | null;
  lastLeadAt: string | null;
};

export type PixelActivity = {
  id: string;
  name: string;
  frozenAt: string | null;
  createdAt: string;
  lastEventAt: string | null;
};

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

export const FREEZE_COPY = {
  badge: "Frozen",
  badgeTitle: "Frozen, upgrade to reactivate",
  formBannerTitle: "Frozen, upgrade to reactivate",
  formBannerBody:
    "This form was frozen when your plan changed. It does not take leads until it is active again. Nothing was deleted.",
  listBanner: (forms: number, pixels: number): string => {
    const tail = "because your plan changed. Nothing was deleted.";
    if (forms > 0 && pixels > 0) {
      return `${plural(forms, "form", "forms")} and ${plural(pixels, "Meta pixel", "Meta pixels")} are frozen ${tail}`;
    }
    if (forms > 0) return `${plural(forms, "form", "forms")} ${forms === 1 ? "is" : "are"} frozen ${tail}`;
    if (pixels > 0) return `${plural(pixels, "Meta pixel", "Meta pixels")} ${pixels === 1 ? "is" : "are"} frozen ${tail}`;
    return "";
  },
  listBannerLink: "Review on the Plan page",
  needsSetup: "Needs setup before it can go live.",
  reactivate: "Reactivate",
  swap: "Swap",
  swapLabel: "Swap with an active form",
  swapHelp: "Swapping freezes the form you pick and makes this one active.",
  pixelNoSlot: "Remove another pixel or upgrade to reactivate this one.",
  sameForm: "Choose two different forms.",
  notActive: "Choose an active form to freeze.",
  notFrozen: "That form is not frozen.",
  pixelNotFrozen: "That pixel is not frozen.",
  frozenPixelChoice: "This pixel is frozen. Upgrade or remove another pixel to reactivate it, then choose it here.",
  frozenPixelTest: "This pixel is frozen, so test events are off. Reactivate it on the Plan page first.",
  testEndedFrozen: "Ended automatically because one of its forms was frozen when the plan changed.",
  reactivated: "Form reactivated.",
  swapped: "Forms swapped.",
  pixelReactivated: "Meta pixel reactivated."
} as const;

/** Milliseconds for sorting; invalid or missing dates give null (sorted last). */
function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Newest first, nulls last. Negative when a should come first. */
function newestFirst(a: string | null | undefined, b: string | null | undefined): number {
  const ta = time(a);
  const tb = time(b);
  if (ta === null && tb === null) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}

function byId(a: { id: string }, b: { id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function isActiveForm(form: FormActivity): boolean {
  return form.isPublished && !form.frozenAt;
}

export function isFrozenForm(form: FormActivity): boolean {
  return !form.isPublished && Boolean(form.frozenAt);
}

/** Active forms (published, not frozen), best first: lastLeadAt desc nulls last, createdAt desc, id asc.
 * Ties never use updated_at: freezing and restoring bump it and would reorder the forms. */
export function rankActiveForms(forms: FormActivity[]): string[] {
  return forms
    .filter(isActiveForm)
    .sort((a, b) => newestFirst(a.lastLeadAt, b.lastLeadAt) || newestFirst(a.createdAt, b.createdAt) || byId(a, b))
    .map((form) => form.id);
}

/** Which active forms stay and which freeze under maxActive. */
export function planFormFreeze(forms: FormActivity[], maxActive: number): { keep: string[]; freeze: string[] } {
  const ranked = rankActiveForms(forms);
  const limit = Math.max(0, Math.floor(maxActive));
  return { keep: ranked.slice(0, limit), freeze: ranked.slice(limit) };
}

/** Unfrozen pixels best first: used by a kept form first, then lastEventAt desc nulls last, createdAt desc, id asc. */
export function rankPixels(pixels: PixelActivity[], keptForms: FormActivity[]): string[] {
  const used = new Set(keptForms.map((form) => form.metaPixelId).filter((id): id is string => Boolean(id)));
  return pixels
    .filter((pixel) => !pixel.frozenAt)
    .sort(
      (a, b) =>
        Number(used.has(b.id)) - Number(used.has(a.id)) ||
        newestFirst(a.lastEventAt, b.lastEventAt) ||
        newestFirst(a.createdAt, b.createdAt) ||
        byId(a, b)
    )
    .map((pixel) => pixel.id);
}

export function planPixelFreeze(
  pixels: PixelActivity[],
  keptForms: FormActivity[],
  maxPixels: number
): { keep: string[]; freeze: string[] } {
  const ranked = rankPixels(pixels, keptForms);
  const limit = Math.max(0, Math.floor(maxPixels));
  return { keep: ranked.slice(0, limit), freeze: ranked.slice(limit) };
}

/** Ordered ready ids for p_restorable_form_ids (no slot limit; the RPC applies the limit). */
export function rankRestorableForms(forms: FormActivity[], readyIds: ReadonlySet<string>): string[] {
  return forms
    .filter((form) => isFrozenForm(form) && !form.takenDownAt && readyIds.has(form.id))
    .sort((a, b) => newestFirst(a.lastLeadAt, b.lastLeadAt) || newestFirst(a.frozenAt, b.frozenAt) || byId(a, b))
    .map((form) => form.id);
}

/** Frozen, not taken down, ready forms, best first, limited to the free slots. */
export function planFormRestore(forms: FormActivity[], readyIds: ReadonlySet<string>, maxActive: number): string[] {
  const active = forms.filter(isActiveForm).length;
  const slots = Math.max(0, Math.floor(maxActive) - active);
  return rankRestorableForms(forms, readyIds).slice(0, slots);
}

/** Frozen pixels to unfreeze: frozenAt desc, createdAt desc, id asc, limited to the free slots. */
export function planPixelRestore(pixels: PixelActivity[], maxPixels: number): string[] {
  const unfrozen = pixels.filter((pixel) => !pixel.frozenAt).length;
  const slots = Math.max(0, Math.floor(maxPixels) - unfrozen);
  return pixels
    .filter((pixel) => Boolean(pixel.frozenAt))
    .sort((a, b) => newestFirst(a.frozenAt, b.frozenAt) || newestFirst(a.createdAt, b.createdAt) || byId(a, b))
    .slice(0, slots)
    .map((pixel) => pixel.id);
}

/** Owner preview: names that would freeze if the tenant moved to `target`. Empty for suspended. */
export function previewFreeze(
  forms: FormActivity[],
  pixels: PixelActivity[],
  target: PlanState
): { formNames: string[]; pixelNames: string[] } {
  if (target === "suspended") return { formNames: [], pixelNames: [] };
  const plan = PLANS[target];
  const formPlan = planFormFreeze(forms, plan.maxActiveForms);
  const keptIds = new Set(formPlan.keep);
  const keptForms = forms.filter((form) => keptIds.has(form.id));
  const pixelPlan = planPixelFreeze(pixels, keptForms, plan.maxPixels);
  const formName = new Map(forms.map((form) => [form.id, form.name]));
  const pixelName = new Map(pixels.map((pixel) => [pixel.id, pixel.name]));
  return {
    formNames: formPlan.freeze.map((id) => formName.get(id) ?? ""),
    pixelNames: pixelPlan.freeze.map((id) => pixelName.get(id) ?? "")
  };
}

export type ReactivateCheck = { allowed: true } | { allowed: false; message: string };

/** Reactivating one frozen form now. `activeCount` is the number of active forms. */
export function canReactivateForm(state: PlanState, activeCount: number): ReactivateCheck {
  if (state === "suspended") return { allowed: false, message: SUSPENDED_MESSAGE };
  const plan = PLANS[state];
  return activeCount < plan.maxActiveForms ? { allowed: true } : { allowed: false, message: activeLimitMessage(plan) };
}

/** Reactivating one frozen pixel now. `unfrozenCount` is the number of pixels that are not frozen. */
export function canReactivatePixel(state: PlanState, unfrozenCount: number): ReactivateCheck {
  if (state === "suspended") return { allowed: false, message: SUSPENDED_MESSAGE };
  const plan = PLANS[state];
  return unfrozenCount < plan.maxPixels ? { allowed: true } : { allowed: false, message: pixelLimitMessage(plan) };
}

/** Maps "FORMBOOK_FREEZE:<reason>" in a database error to the user message, else null. */
export function freezeMessageFromError(message: string | null | undefined): string | null {
  const match = /FORMBOOK_FREEZE:([a-z_]+)/.exec(message ?? "");
  if (!match) return null;
  switch (match[1]) {
    case "same_form":
      return FREEZE_COPY.sameForm;
    case "not_active":
      return FREEZE_COPY.notActive;
    case "not_frozen":
      return FREEZE_COPY.notFrozen;
    default:
      return null;
  }
}
