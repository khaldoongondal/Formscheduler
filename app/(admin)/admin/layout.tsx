import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { ScrollPositionRestorer } from "@/components/admin/scroll-position-restorer";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50">
      <ScrollPositionRestorer />
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-5">
            <Link href="/admin/funnels" className="flex items-center gap-2 font-semibold text-slate-950">
              <CalendarDays className="h-5 w-5 text-emerald-700" />
              Leadder Scheduler
            </Link>
            <nav className="hidden items-center gap-2 md:flex">
              <Button asChild variant="ghost" size="sm">
                <Link href="/admin/funnels">Funnels</Link>
              </Button>
            </nav>
          </div>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  );
}
