import type { Metadata, Viewport } from "next";
import { APP_NAME, APP_TAGLINE } from "@/lib/app";
import { clash, instrumentSerif, satoshi } from "@/lib/fonts";
import { THEME_SCRIPT } from "@/lib/theme";
import { themePref } from "@/lib/theme-server";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0c" },
  ],
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const pref = await themePref();
  return (
    // An explicit choice is rendered by the server; "system" is resolved by THEME_SCRIPT before paint.
    // suppressHydrationWarning: the script sets data-theme on <html> before React hydrates.
    <html lang="en" data-theme-pref={pref} data-theme={pref === "system" ? undefined : pref} suppressHydrationWarning className={`${satoshi.variable} ${clash.variable} ${instrumentSerif.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
