import { BrandMark } from "@/components/brand/brand-logo";

/** Small, quiet "Powered by FormBook" link shown on free-plan public forms. */
export function PoweredByBadge() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return (
    <a
      href={`${appUrl}/?ref=badge`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 align-middle text-[11px] text-slate-600 hover:underline"
    >
      <BrandMark className="h-3.5" />
      Powered by FormBook
    </a>
  );
}
