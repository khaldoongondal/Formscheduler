type FormFooterProps = {
  slug: string;
  mode: "full" | "embed";
  /** Accepted now; the "Powered by FormBook" badge arrives in P4. */
  showBadge?: boolean;
};

/** Quiet line under every public form with the "Report this form" link. */
export function FormFooter({ slug, mode }: FormFooterProps) {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const reportHref = `${appUrl}/report/${encodeURIComponent(slug)}`;

  return (
    <footer className={mode === "embed" ? "px-2 py-2 text-center text-xs text-slate-400" : "px-2 py-3 text-center text-xs text-slate-400"}>
      <a className="hover:text-slate-600 hover:underline" href={reportHref} target="_blank" rel="noopener noreferrer">
        Report this form
      </a>
    </footer>
  );
}
