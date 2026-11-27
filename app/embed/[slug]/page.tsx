import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { BookingFlow } from "@/components/booking/booking-flow";
import { SetupRequired } from "@/components/setup/setup-required";
import { getMissingSupabaseServiceEnv } from "@/lib/env";
import { formPageMetadata } from "@/lib/funnels/public-copy";
import { getFunnelBySlug } from "@/lib/funnels/service";

export const dynamic = "force-dynamic";

// One funnel read per request, shared by the metadata and the page.
const loadFunnel = cache(getFunnelBySlug);

/** The customer's form name, never the FormBook title, Open Graph image or og:url. */
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  if (getMissingSupabaseServiceEnv().length > 0) return formPageMetadata(null);
  const { slug } = await params;
  const funnel = await loadFunnel(slug);
  return formPageMetadata(funnel, { index: false });
}

export default async function EmbedPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const missingEnv = getMissingSupabaseServiceEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required to preview embedded funnels."
        description="Embedded booking routes render funnel configuration and questions from Supabase. Add the database environment variables before opening an embed preview."
        missingEnv={missingEnv}
      />
    );
  }

  const funnel = await loadFunnel(slug);
  if (!funnel) notFound();

  return <BookingFlow funnel={funnel} mode="embed" />;
}
