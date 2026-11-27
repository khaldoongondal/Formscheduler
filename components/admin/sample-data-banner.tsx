import { META_CONTROLS_COPY } from "@/lib/meta/log-format";

/** Amber banner on forms and split tests made by the demo seed script. */
export function SampleDataBanner() {
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold leading-6 text-amber-900">
      {META_CONTROLS_COPY.sampleData}
    </div>
  );
}
