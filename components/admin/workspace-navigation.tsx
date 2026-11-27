"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { ChevronDown, CreditCard, Menu, PanelsTopLeft, Radio, Split, Unplug, Users } from "lucide-react";

const sections = [
  { href: "/admin/funnels", label: "Funnels", Icon: PanelsTopLeft },
  { href: "/admin/split-tests", label: "Split tests", Icon: Split },
  { href: "/admin/pixels", label: "Meta pixels", Icon: Radio },
  { href: "/admin/connections", label: "Connections", Icon: Unplug },
  { href: "/admin/plan", label: "Plan", Icon: CreditCard }
];
const clients = { href: "/admin/clients", label: "Client management", Icon: Users };

export function WorkspaceNavigation({ isOwner }: { isOwner: boolean }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDetailsElement>(null);
  const items = isOwner ? [...sections, clients] : sections;
  const current = items.find(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
  const links = items.map(({ href, label, Icon }) => (
    <Link key={href} href={href} className="workspace-nav-link"
      aria-current={current?.href === href ? pathname === href ? "page" : "location" : undefined}
      onClick={() => { if (menu.current) menu.current.open = false; }}>
      <Icon aria-hidden="true" size={16} strokeWidth={1.7} />
      <span>{label}</span>
    </Link>
  ));

  return (
    <div className="workspace-navigation">
      <nav aria-label="Workspace" className="workspace-desktop-nav">{links}</nav>
      <details key={pathname} className="workspace-mobile-nav" ref={menu}
        onKeyDown={(event) => {
          if (event.key === "Escape" && menu.current?.open) {
            menu.current.open = false;
            menu.current.querySelector("summary")?.focus();
          }
        }}>
        <summary>
          <Menu size={16} aria-hidden="true" />
          Workspace menu
          <span className="workspace-current">{current?.label}</span>
          <ChevronDown className="workspace-chevron" size={15} aria-hidden="true" />
        </summary>
        <nav aria-label="Workspace">{links}</nav>
      </details>
    </div>
  );
}
