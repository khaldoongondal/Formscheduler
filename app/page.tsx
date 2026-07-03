import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { CalendarCheck, ChartNoAxesCombined, Route } from "lucide-react";
import { Button } from "@/components/ui/button";

const features: Array<{ title: string; body: string; Icon: LucideIcon }> = [
  { title: "Capture", body: "Lead sessions start before slot reveal.", Icon: CalendarCheck },
  { title: "Qualify", body: "Questions and options render from Supabase.", Icon: Route },
  { title: "Measure", body: "Funnel analytics are event-based from day one.", Icon: ChartNoAxesCombined }
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-white">
      <section className="mx-auto flex min-h-screen max-w-6xl flex-col justify-center px-6 py-16">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-wide text-emerald-700">
            Leadder Scheduler MVP
          </p>
          <h1 className="mt-4 text-5xl font-semibold tracking-tight text-slate-950 md:text-6xl">
            Qualify leads before calendar slots appear.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-600">
            A database-driven booking layer that captures contact data, qualifies prospects,
            routes intent, and books appointments into GoHighLevel as the system of record.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/admin/funnels">Open Admin</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/book/demo-consultation">Preview Demo Funnel</Link>
            </Button>
          </div>
        </div>
        <div className="mt-14 grid gap-4 md:grid-cols-3">
          {features.map(({ title, body, Icon }) => (
            <div key={title} className="rounded-lg border bg-white p-5 shadow-sm">
              <Icon className="h-5 w-5 text-emerald-700" />
              <h2 className="mt-4 font-semibold text-slate-950">{title}</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
