import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking/booking-flow";
import { SetupRequired } from "@/components/setup/setup-required";
import { getMissingSupabaseServiceEnv } from "@/lib/env";
import { getFunnelBySlug } from "@/lib/funnels/service";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const missingEnv = getMissingSupabaseServiceEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        title="Supabase is required to preview booking funnels."
        description="Public booking routes render funnel configuration and questions from Supabase. Add the database environment variables before opening a funnel preview."
        missingEnv={missingEnv}
      />
    );
  }

  const funnel = await getFunnelBySlug(slug);
  if (!funnel) notFound();

  return <BookingFlow funnel={funnel} mode="full" />;
}
