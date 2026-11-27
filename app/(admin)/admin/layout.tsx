import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/login/actions";
import { getPlatformOwner } from "@/lib/auth/owner-server";
import { PRODUCT_ICONS } from "@/lib/marketing/site";
import { ScrollPositionRestorer } from "@/components/admin/scroll-position-restorer";
import { WorkspaceNavigation } from "@/components/admin/workspace-navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { Button } from "@/components/ui/button";
import "./workspace.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { icons: PRODUCT_ICONS };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Never throws: non-owners simply do not see the owner link.
  const owner = await getPlatformOwner();
  return (
    <div className="jardin-ui workspace-shell">
      <ScrollPositionRestorer />
      <a href="#workspace-main" className="workspace-skip">Skip to content</a>
      <header className="workspace-masthead">
        <div className="workspace-masthead-inner">
          <Link href="/admin/funnels" className="workspace-brand" aria-label="Formbook workspace home">
            <BrandLogo className="workspace-logo" />
          </Link>
          <WorkspaceNavigation isOwner={Boolean(owner)} />
          <form action={signOut} className="workspace-account">
            <Button type="submit" variant="ghost" size="sm">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </Button>
          </form>
        </div>
      </header>
      <main id="workspace-main" tabIndex={-1} className="workspace-body">{children}</main>
    </div>
  );
}
