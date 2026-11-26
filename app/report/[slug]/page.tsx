import type { Metadata } from "next";
import { ReportForm } from "@/components/booking/report-form";
import { normalizeSlug } from "@/lib/funnels/slugs";

export const metadata: Metadata = {
  title: "Report this form",
  robots: { index: false }
};

export default async function ReportPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug: rawSlug } = await params;
  const slug = normalizeSlug(rawSlug).slice(0, 80);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 sm:px-6">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-950">Report this form</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Tell us if this form looks like phishing, spam or someone pretending to be another business. We review every
          report.
        </p>
        <p className="mt-2 break-all text-xs text-slate-400">Form address: /{slug}</p>
        <div className="mt-6">
          <ReportForm slug={slug} />
        </div>
      </div>
    </main>
  );
}
