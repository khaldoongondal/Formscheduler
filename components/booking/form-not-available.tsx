import { FORM_NOT_AVAILABLE_MESSAGE } from "@/lib/funnels/public-copy";

/**
 * Not-found view for customer form pages. Next.js keeps the 404 status and
 * adds noindex. Plain and unbranded: the same text for frozen, draft, taken
 * down or unknown forms.
 */
export function FormNotAvailable() {
  return (
    <main className="flex min-h-[50vh] items-center justify-center bg-white px-4 py-16">
      <p className="text-center text-base font-medium text-slate-700">{FORM_NOT_AVAILABLE_MESSAGE}</p>
    </main>
  );
}
