/**
 * Visitor-facing text and metadata for customer form pages (/book, /embed,
 * /t, /embed/t). Pure: no Supabase or runtime Next.js imports.
 *
 * Customer form pages carry no FormBook title, description, Open Graph image
 * or og:url, so a shared link previews as the customer's form, not the product.
 */

import type { Metadata } from "next";

/** Shown for a form that is frozen, a draft, taken down, or does not exist. Never says which. */
export const FORM_NOT_AVAILABLE_MESSAGE = "This form is not available.";
export const FORM_NOT_AVAILABLE_TITLE = "Form not available";
/** Neutral title for split test links, which pick a form per visitor. */
export const FORM_LINK_TITLE = "Book a call";

const MAX_DESCRIPTION = 200;

function clean(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Metadata for a customer form page. With no form (not available), a neutral
 * title and noindex. Never sets Open Graph images or url. Follows the same
 * intro toggles as the page: a hidden headline is never used as the title and
 * a hidden description is never used as the meta description.
 */
export function formPageMetadata(
  form: {
    name: string | null;
    description?: string | null;
    show_intro_headline?: boolean | null;
    show_intro_description?: boolean | null;
  } | null,
  options: { index?: boolean } = {}
): Metadata {
  if (!form) {
    return { title: { absolute: FORM_NOT_AVAILABLE_TITLE }, robots: { index: false, follow: false } };
  }
  const title = (form.show_intro_headline !== false && clean(form.name)) || FORM_LINK_TITLE;
  const rawDescription = form.show_intro_description !== false ? clean(form.description) : "";
  const description =
    rawDescription.length > MAX_DESCRIPTION ? `${rawDescription.slice(0, MAX_DESCRIPTION - 3).trimEnd()}...` : rawDescription;
  const metadata: Metadata = {
    title: { absolute: title },
    openGraph: { type: "website", title, ...(description ? { description } : {}) },
    twitter: { card: "summary", title, ...(description ? { description } : {}) }
  };
  if (description) metadata.description = description;
  if (options.index === false) metadata.robots = { index: false };
  return metadata;
}

/** Metadata for split test links: the form is chosen per visitor, so only a neutral title. */
export function splitLinkMetadata(): Metadata {
  return {
    title: { absolute: FORM_LINK_TITLE },
    openGraph: { type: "website", title: FORM_LINK_TITLE },
    twitter: { card: "summary", title: FORM_LINK_TITLE },
    robots: { index: false }
  };
}
