/**
 * Site-wide public metadata values. Pure: no Supabase or runtime Next.js imports.
 */

import type { Metadata } from "next";

export const DEFAULT_APP_URL = "https://formbooking.gondaltech.app";

export const SITE_TITLE = "FormBook: qualify and book calls in one form";
export const SITE_DESCRIPTION =
  "FormBook, a tool from Gondal Tech, for founders and business owners who run call-booking funnels. Qualify leads, book calls, split test forms and send server-side Meta events.";

/**
 * Home page metadata only (app/(home)/page.tsx). Never in the root layout:
 * customer form pages must not inherit the product title, cards or og:url.
 */
export const HOME_METADATA: Metadata = {
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  applicationName: "FormBook",
  openGraph: {
    type: "website",
    siteName: "FormBook",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: "/"
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION
  }
};

/** The public app address from NEXT_PUBLIC_APP_URL, or the production default when unset or invalid. */
export function siteUrl(raw: string | undefined | null): URL {
  try {
    const url = new URL(raw || DEFAULT_APP_URL);
    if (url.protocol !== "https:" && url.protocol !== "http:") return new URL(DEFAULT_APP_URL);
    return new URL(url.origin);
  } catch {
    return new URL(DEFAULT_APP_URL);
  }
}

/** Public pages listed in the sitemap. Customer form pages are left to each customer. */
export const SITEMAP_PATHS = ["/", "/signup", "/login", "/help/connections", "/terms", "/privacy", "/dpa"] as const;

/** Paths search engines are asked not to crawl. */
export const ROBOTS_DISALLOW = ["/admin/", "/api/", "/preview/", "/auth/", "/embed/"] as const;
