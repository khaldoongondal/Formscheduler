import type { Metadata } from "next";
import type { ReactNode } from "react";
import { PRODUCT_ICONS } from "@/lib/marketing/site";

export const metadata: Metadata = { icons: PRODUCT_ICONS };

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
