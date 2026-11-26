/** Small, quiet "Powered by FormBook" link shown on free-plan public forms. */
export function PoweredByBadge() {
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return (
    <a
      href={`${appUrl}/?ref=badge`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[11px] text-slate-400 hover:text-slate-600"
    >
      Powered by FormBook
    </a>
  );
}
