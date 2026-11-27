import type { MetadataRoute } from "next";
import { ROBOTS_DISALLOW, siteUrl } from "@/lib/marketing/site";

export default function robots(): MetadataRoute.Robots {
  const appUrl = siteUrl(process.env.NEXT_PUBLIC_APP_URL);
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] },
    sitemap: new URL("/sitemap.xml", appUrl).toString()
  };
}
