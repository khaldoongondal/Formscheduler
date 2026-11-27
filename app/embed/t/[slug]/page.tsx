import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { BookingFlow } from "@/components/booking/booking-flow";
import { SplitTestResolver } from "@/components/booking/split-test-resolver";
import { SetupRequired } from "@/components/setup/setup-required";
import { VISITOR_COOKIE } from "@/lib/booking/visitor-id";
import { getMissingSupabaseServiceEnv } from "@/lib/env";
import { splitLinkMetadata } from "@/lib/funnels/public-copy";
import { resolvePublicSplitTest } from "@/lib/split-tests/public";

export const dynamic = "force-dynamic";
// Neutral and noindex: no FormBook title, Open Graph image or og:url.
export const metadata: Metadata = splitLinkMetadata();

export default async function SplitTestEmbedPage({
  params,
  searchParams
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ fb_vid?: string | string[] }>;
}) {
  const { slug } = await params;
  const missingEnv = getMissingSupabaseServiceEnv();
  if (missingEnv.length > 0) {
    return (
      <SetupRequired
        as="main"
        title="Supabase is required to preview embedded split test links."
        description="Split test links choose a form and load it from Supabase. Add the database environment variables before opening a split test link."
        missingEnv={missingEnv}
      />
    );
  }

  const query = searchParams ? await searchParams : {};
  const queryVisitorId = typeof query.fb_vid === "string" ? query.fb_vid : undefined;
  const resolution = await resolvePublicSplitTest({
    slug,
    cookieVisitorId: (await cookies()).get(VISITOR_COOKIE)?.value,
    queryVisitorId,
    headers: await headers()
  });

  if (resolution.kind === "not_found") notFound();
  if (resolution.kind === "need_visitor") return <SplitTestResolver />;

  return (
    <BookingFlow
      funnel={resolution.funnel}
      mode="embed"
      splitTest={resolution.testId ? { id: resolution.testId } : null}
      initialVisitorId={resolution.visitorId}
    />
  );
}
