import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, LogOut, PlugZap, Rows3, Split, Users } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { getPlatformOwner } from "@/lib/auth/owner-server";
import { ScrollPositionRestorer } from "@/components/admin/scroll-position-restorer";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

const navItems = [
  { href: "/admin/funnels", label: "Funnels", Icon: Rows3 },
  { href: "/admin/split-tests", label: "Split Tests", Icon: Split },
  { href: "/admin/ghl-connections", label: "GHL Connections", Icon: PlugZap }
];

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Never throws: non-owners simply do not see the owner link.
  const owner = await getPlatformOwner();
  const items = owner
    ? [...navItems, { href: "/admin/clients", label: "Client Management", Icon: Users }]
    : navItems;

  return (
    <main className="min-h-screen bg-slate-50">
      <ScrollPositionRestorer />
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/admin/funnels" className="flex items-center gap-2.5 font-semibold text-slate-950">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <CalendarDays className="h-5 w-5" />
            </span>
            <span className="text-lg tracking-tight">FormBook</span>
            <span className="hidden text-xs font-normal text-slate-500 sm:inline">by Gondal Tech</span>
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="ghost" size="sm" className="text-slate-500 hover:text-slate-900">
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </form>
        </div>
        <nav className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto px-6">
          {items.map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:border-primary/40 hover:text-slate-950"
            >
              <Icon className="h-4 w-4 text-primary" />
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-8">{children}</div>
    </main>
  );
}
