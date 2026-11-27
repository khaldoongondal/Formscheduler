import type { MetadataRoute } from "next";
import { SITEMAP_PATHS, siteUrl } from "@/lib/marketing/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const appUrl = siteUrl(process.env.NEXT_PUBLIC_APP_URL);
  const lastModified = new Date();
  return SITEMAP_PATHS.map((path) => ({ url: new URL(path, appUrl).toString(), lastModified }));
}
