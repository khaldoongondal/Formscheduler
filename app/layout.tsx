import type { Metadata } from "next";
import type { ReactNode } from "react";
import { siteUrl } from "@/lib/marketing/site";
import "./globals.css";

// Neutral defaults only. Every route inherits these, including customer form
// pages (/book, /embed, /t), so the FormBook description, Open Graph and
// Twitter cards, og:url and share image live on the home page alone
// (app/(home)). Customer form pages set their own title from the form name.
export const metadata: Metadata = {
  metadataBase: siteUrl(process.env.NEXT_PUBLIC_APP_URL),
  title: { default: "FormBook", template: "%s | FormBook" }
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
