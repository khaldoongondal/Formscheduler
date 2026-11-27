import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking/booking-flow";
import { getAdminTenantId } from "@/lib/auth/tenant";
import { isUuid } from "@/lib/connections/registry";
import { getPreviewFunnel } from "@/lib/funnels/service";
import { markOnboarding } from "@/lib/onboarding/service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false }
};

/**
 * Same-origin preview of the signed-in tenant's own form (decision D18):
 * draft or active, never served to anyone else, framable by this origin only
 * (next.config.ts). The middleware sends signed-out visitors to sign in.
 */
export default async function FormPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const tenantId = await getAdminTenantId();
  const funnel = await getPreviewFunnel(tenantId, id);
  if (!funnel) notFound();

  // Marks the checklist step; never throws.
  await markOnboarding(tenantId, "preview_opened_at");

  return (
    <div className="min-h-screen bg-white">
      <BookingFlow funnel={funnel} mode="embed" preview />
    </div>
  );
}
