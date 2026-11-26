import { PoweredByBadge } from "@/components/booking/powered-by-badge";

type FormFooterProps = {
  slug: string;
  mode: "full" | "embed";
  /** Free-plan tenants show the "Powered by FormBook" badge before the report link. */
  showBadge?: boolean;
};

/** Quiet line under every public form: optional badge, then the "Report this form" link. */
export function FormFooter({ slug, mode, showBadge = false }: FormFooterProps) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const reportHref = `${appUrl}/report/${encodeURIComponent(slug)}`;

  return (
    <footer className={mode === "embed" ? "px-2 py-2 text-center text-xs text-slate-400" : "px-2 py-3 text-center text-xs text-slate-400"}>
      {showBadge ? (
        <>
          <PoweredByBadge />
          <span aria-hidden="true" className="mx-1.5">
            &middot;
          </span>
        </>
      ) : null}
      <a className="hover:text-slate-600 hover:underline" href={reportHref} target="_blank" rel="noopener noreferrer">
        Report this form
      </a>
    </footer>
  );
}
