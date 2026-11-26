import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarCheck, ChartNoAxesCombined, Route } from "lucide-react";
import { CONTACT_EMAIL } from "@/lib/billing/plans";
import { Button } from "@/components/ui/button";

const features: Array<{ title: string; body: string; Icon: LucideIcon }> = [
  { title: "Capture", body: "Every lead is saved as soon as they enter their contact details.", Icon: CalendarCheck },
  {
    title: "Qualify",
    body: "Ask your questions and stop people who are not a fit before they see your calendar.",
    Icon: Route
  },
  { title: "Measure", body: "See views, starts, leads and bookings for each form.", Icon: ChartNoAxesCombined }
];

export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col bg-white">
      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">FormBook, a tool from Gondal Tech</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl md:text-6xl">
            Qualify leads before they book a call.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            Build a short form that asks your questions, saves every lead, and shows your calendar only to the people
            you want to talk to. Bookings go straight into GoHighLevel.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/signup">Create a free account</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {features.map(({ title, body, Icon }) => (
            <div key={title} className="rounded-lg border bg-white p-5 shadow-sm">
              <Icon className="h-5 w-5 text-primary" />
              <h2 className="mt-4 font-semibold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-6 py-6 text-sm text-slate-500">
          <Link className="hover:text-slate-900 hover:underline" href="/terms">
            Terms
          </Link>
          <Link className="hover:text-slate-900 hover:underline" href="/privacy">
            Privacy
          </Link>
          <Link className="hover:text-slate-900 hover:underline" href="/dpa">
            Data Processing Addendum
          </Link>
          <span className="break-all">
            Contact:{" "}
            <a className="hover:text-slate-900 hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
          </span>
        </div>
      </footer>
    </main>
  );
}
